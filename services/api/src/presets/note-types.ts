import {
  canonicalJson,
  copyPart,
  editNoteTypesApplied,
  mayReach,
  PRESETS,
  sha256Hex,
  takeRevision,
  validate,
  versionProblems,
  type FileProblem,
  type NoteTypeEdit,
  type NoteTypeEditCode,
  type NoteTypeEditRefusal,
  type Preset,
  type Rename,
  type ResolvedNoteType,
} from '@sineobex/forms';
import type { AuditEvent } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { checkedRow, versionsFor } from '../forms/definitions.ts';
import { ApiError, invalid, notFound } from '../lib/errors.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import { PresetReason, type PresetWriteScope } from './store.ts';

/**
 * The one writer of a team's note types besides the installer (phase 5 design 4.3, 5.1, 5.4, 7, 9;
 * D129): every admin act on a note type goes through here, and the installer (packages/forms
 * install.ts) is the only other writer of a head. The definitions are phase 4's rows
 * (note_type_versions, 0017), never changed: an edit, a copy and an update taken are each a new
 * row, so a note is read on the version it began on (5.4 rule 4). Each write
 *  - is made in a scope that holds team.manage_presets and a recent sign-in (presetWriteScope), as
 *    every preset write is, and asks the sign-in again, so no caller can skip it;
 *  - takes the team lock (lockTeamWrites) as its transaction's first statement, which the installer
 *    takes too before it writes a key's next version, so the two never collide on 0017's key, and
 *    reads the team's note types under it, each definition checked as definitionFor checks it;
 *  - refuses before it writes anything, so a refusal leaves no row and takes no revision;
 *  - names every version it stores as its own row (4.3: its key and version the row's), and checks
 *    it with phase 4's validate and version rules, the size limit among them, before it stores it;
 *  - then takes one revision (takeRevision), stamped on every head it writes;
 *  - keeps its reason in team_preset_events, by the person, and audits in the same transaction,
 *    with the version and the operations' names only: never a reason, a title or a label (9).
 */

/** A note type's head with its current version's definition. */
export interface HeldNoteType {
  readonly key: string;
  readonly title: string;
  readonly state: 'active' | 'archived';
  readonly currentVersion: number;
  /** The newest platform version the installer has seen; above `lastTaken`, one is on offer. */
  readonly platformLatest: number | null;
  /** The team edited, archived or restored it: a platform version is then only offered. */
  readonly customized: boolean;
  /** The platform version its newest platform row was installed or taken from; null with none. */
  readonly lastTaken: number | null;
  /** Its current version's definition, checked as definitionFor checks it, and frozen. */
  readonly definition: ResolvedNoteType;
}

/** Every note type the team holds, archived ones too, and what names each. */
export interface TeamNoteTypes {
  readonly all: readonly HeldNoteType[];
  get(key: string): HeldNoteType | undefined;
  /** How many active field supply maps name each note type in their current body, by key. */
  readonly maps: ReadonlyMap<string, number>;
}

/**
 * Every head of the team with its current version's definition, and the active field supply maps
 * naming each (design 4.4): what the admin list shows, and what a write reads under the team lock,
 * so it holds until the write commits. Each definition is checked as definitionFor checks a version
 * (its hash, its own key and version), so an edit is never made from a row that is not what it says.
 */
export async function loadTeamNoteTypes(tx: Tx, teamId: string): Promise<TeamNoteTypes> {
  const rows = await tx<
    (Omit<HeldNoteType, 'definition'> & { hash: string | null; definition: ResolvedNoteType | null })[]
  >`
    select h.key, h.title, h.state, h.current_version, h.platform_latest, h.customized, v.hash,
           v.definition,
           (select n.preset_version from sineobex.note_type_versions n
            where n.team_id = h.team_id and n.key = h.key and n.origin = 'preset'
            order by n.version desc limit 1) as last_taken
    from sineobex.note_types h
    left join sineobex.note_type_versions v
      on v.team_id = h.team_id and v.key = h.key and v.version = h.current_version
    where h.team_id = ${teamId}`;
  const all: HeldNoteType[] = [];
  for (const { hash, definition, ...head } of rows) {
    // Every writer writes a head with its version (the installer, this module); 0023 cannot hold it.
    if (hash === null || definition === null) throw new Error('a note type’s current version is missing');
    const stored = await checkedRow(teamId, {
      key: head.key,
      version: head.currentVersion,
      hash,
      definition,
    });
    all.push({ ...head, definition: stored.definition });
  }
  const byKey = new Map(all.map((n) => [n.key, n]));
  const maps = await tx<{ key: string; n: number }[]>`
    select v.body ->> 'noteTypeKey' as key, count(*)::int as n
    from sineobex.team_presets p
    join sineobex.team_preset_versions v
      on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    where p.team_id = ${teamId} and p.kind = 'field_supply_map' and p.state = 'active'
    group by 1`;
  return {
    all,
    get: (key) => byKey.get(key),
    maps: new Map(maps.map((m) => [m.key, m.n])),
  };
}

/**
 * The active presets that name a note type, counted by their kind: the field supply maps whose
 * current body names it (design 4.4), the one kind that names a note type. A note type such a map
 * names cannot be removed (`referenced`, 5.4).
 */
export function referencedBy(team: TeamNoteTypes, key: string): { field_supply_map?: number } {
  const n = team.maps.get(key);
  return n === undefined ? {} : { field_supply_map: n };
}

/** What a platform version may not change in a team's note type (5.2, 5.4 rule 2), in this order. */
export const FIXED_NOTE_TYPE_FIELDS = ['kinds', 'group', 'sensitivity', 'quick', 'auto'] as const;
export type FixedNoteTypeField = (typeof FIXED_NOTE_TYPE_FIELDS)[number];

const fixedValue: Record<FixedNoteTypeField, (d: ResolvedNoteType) => unknown> = {
  // As a set: Medical is a property of the note through its type (D56), whatever the order.
  kinds: (d) => canonicalJson([...d.kinds].sort()),
  group: (d) => d.group,
  sensitivity: (d) => d.sensitivity,
  quick: (d) => d.quick === true,
  auto: (d) => d.auto ?? null,
};

/** The fixed fields `after` changes from `before`. */
export function changedFixed(before: ResolvedNoteType, after: ResolvedNoteType): FixedNoteTypeField[] {
  return FIXED_NOTE_TYPE_FIELDS.filter((field) => fixedValue[field](before) !== fixedValue[field](after));
}

/** The platform version on offer to a note type, as taking it in place would write it. */
export interface NoteTypeUpdate {
  /** The platform's version, as the release holds it. */
  readonly preset: Preset;
  /** Its definition named as the note type's next version (4.3): what a take in place stores. */
  readonly definition: ResolvedNoteType;
  /** The fixed fields it would change; with any, it is taken only as a new note type (5.1). */
  readonly changesFixed: FixedNoteTypeField[];
}

/**
 * The update on offer to a note type (5.1, 5.2): the platform's version at platform_latest, once that
 * is above the platform version last taken; null when none is, or when the release no longer holds
 * that version. Read from the release at each call, so what is offered is what the installer saw.
 */
export function noteTypeUpdateOf(held: HeldNoteType): NoteTypeUpdate | null {
  if (held.platformLatest === null || held.platformLatest <= (held.lastTaken ?? 0)) return null;
  const preset = PRESETS.find((p) => p.key === held.key && p.version === held.platformLatest);
  if (!preset) return null;
  return {
    preset,
    definition: { ...copyPart(preset.definition), version: held.currentVersion + 1 },
    changesFixed: changedFixed(held.definition, preset.definition),
  };
}

// ------------------------------------------------------------------------------------------------
// The reason
// ------------------------------------------------------------------------------------------------

/** The reason as it is kept (PresetReason, as every preset write keeps it), or the request's refusal. */
function reasonOf(raw: string): string {
  const parsed = PresetReason.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new ApiError(422, 'validation_failed', 'Some fields are missing or invalid.', {
    fields: [{ path: 'reason', problem: parsed.error.issues[0]?.code ?? 'invalid' }],
  });
}

// ------------------------------------------------------------------------------------------------
// One write
// ------------------------------------------------------------------------------------------------

/** A version a write stores: the team's own (`origin = 'team'`), or a platform version taken. */
interface NewVersion {
  key: string;
  definition: ResolvedNoteType;
  origin: 'team' | 'preset';
  /** The platform version a taken one is; null for the team's own. */
  presetVersion: number | null;
}

/** What one write changes, worked out before anything is written; `commit` writes it all at once. */
interface Changes {
  /** Versions, each named as its own row already (its definition's key and version). */
  versions: NewVersion[];
  /** New heads: a note type added, or an update taken as a new one. */
  made: { key: string; title: string; platformLatest: number | null; customized: boolean }[];
  /** Heads changed; a column left out keeps its value. */
  changed: {
    key: string;
    title?: string;
    state?: 'active' | 'archived';
    version?: number;
    customized?: boolean;
  }[];
  /** One act on each note type the write changes, with the write's reason and person. */
  events: {
    key: string;
    act: 'created' | 'updated' | 'archived' | 'restored' | 'update_taken';
    version: number;
  }[];
  /** The audit events, given the revision the write took. */
  audits: (revision: number) => AuditEvent[];
}

interface Write {
  tx: Tx;
  teamId: string;
  userId: string;
  team: TeamNoteTypes;
}

/**
 * Runs one write: a recent sign-in again, so no caller can skip it; the team lock as the
 * transaction's first statement; the team's note types read under it; then `act`, which works out
 * the write, refusing by throwing, and answers what to write and what to answer.
 */
function noteTypeWrite<T>(
  scope: PresetWriteScope,
  reason: string,
  act: (w: Write) => Promise<{ changes: Changes; answer: (revision: number) => T }>,
): Promise<T> {
  scope.requireRecentAuth();
  const kept = reasonOf(reason);
  const { teamId } = scope.team;
  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, teamId);
    const w: Write = {
      tx,
      teamId,
      userId: scope.principal.userId,
      team: await loadTeamNoteTypes(tx, teamId),
    };
    const { changes, answer } = await act(w);
    const revision = await commit(w, changes, kept);
    for (const event of changes.audits(revision)) await audit(event);
    return answer(revision);
  });
}

/**
 * Takes the write's one revision and writes everything it changes, each kind of row in one
 * statement: the versions, each with the hash of its canonical definition, as definitionFor checks
 * it; the heads changed, then the new ones, each stamped with the revision; then the events. Rows
 * travel as one JSON text cast to jsonb, as the installer sends them.
 */
async function commit(w: Write, changes: Changes, reason: string): Promise<number> {
  const { tx, teamId, userId } = w;
  const rows = (list: readonly object[]) => JSON.stringify(list);
  const revision = await takeRevision(tx, teamId);
  if (changes.versions.length > 0) {
    const versions = await Promise.all(
      changes.versions.map(async (v) => ({
        key: v.key,
        version: v.definition.version,
        definition: v.definition,
        hash: await sha256Hex(canonicalJson(v.definition)),
        origin: v.origin,
        platform: v.presetVersion,
      })),
    );
    await tx`
      insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin, preset_version)
      select ${teamId}::uuid, v.key, v.version, v.definition, v.hash, v.origin, v.platform
      from jsonb_to_recordset(${rows(versions)}::text::jsonb)
        as v (key text, version integer, definition jsonb, hash text, origin text, platform integer)`;
  }
  if (changes.changed.length > 0) {
    const updated = await tx<{ key: string }[]>`
      update sineobex.note_types as t
      set title = coalesce(u.title, t.title), state = coalesce(u.state, t.state),
          current_version = coalesce(u.version, t.current_version),
          customized = coalesce(u.customized, t.customized),
          revision = ${revision}::bigint, updated_by = ${userId}::uuid
      from jsonb_to_recordset(${rows(
        changes.changed.map((c) => ({
          key: c.key,
          title: c.title ?? null,
          state: c.state ?? null,
          version: c.version ?? null,
          customized: c.customized ?? null,
        })),
      )}::text::jsonb) as u (key text, title text, state text, version integer, customized boolean)
      where t.team_id = ${teamId}::uuid and t.key = u.key
      returning t.key`;
    // Read under the lock, so every head is there; one missing is a fault, never half a write.
    if (updated.length !== changes.changed.length)
      throw new Error('a note type write changed fewer heads than it worked out; undo the transaction');
  }
  if (changes.made.length > 0)
    await tx`
      insert into sineobex.note_types
        (team_id, key, title, state, current_version, platform_latest, customized, revision, updated_by)
      select ${teamId}::uuid, h.key, h.title, 'active', 1, h.platform_latest, h.customized,
             ${revision}::bigint, ${userId}::uuid
      from jsonb_to_recordset(${rows(
        changes.made.map((m) => ({
          key: m.key,
          title: m.title,
          platform_latest: m.platformLatest,
          customized: m.customized,
        })),
      )}::text::jsonb) as h (key text, title text, platform_latest integer, customized boolean)`;
  await tx`
    insert into sineobex.team_preset_events (team_id, note_type_key, act, version, reason, created_by)
    select ${teamId}::uuid, e.key, e.act, e.version, ${reason}, ${userId}::uuid
    from jsonb_to_recordset(${rows(changes.events)}::text::jsonb) as e (key text, act text, version integer)`;
  return revision;
}

// ------------------------------------------------------------------------------------------------
// What each act reads, and how it is refused
// ------------------------------------------------------------------------------------------------

/** The note type an act names: one the team holds a head of; anything else is 404. */
function noteTypeOf(team: TeamNoteTypes, key: string): HeldNoteType {
  const held = team.get(key);
  if (!held) throw notFound('note type');
  return held;
}

/** Why an act on a note type is refused, as 5.1 names it for presets. */
type NoteTypeRefusal =
  | 'archived'
  | 'not_archived'
  | 'stale'
  | 'no_change'
  | 'fixed_field'
  | 'name_taken'
  | 'referenced'
  | 'not_removable'
  | 'no_update';

const MESSAGES: Record<NoteTypeRefusal, string> = {
  archived: 'This note type is removed. Restore it first.',
  not_archived: 'This note type isn’t removed.',
  stale: 'Someone else changed this while you were editing. Reload to see their version.',
  no_change: 'Nothing was changed.',
  fixed_field: 'This update changes something that can’t be changed here. Add it as a new note type instead.',
  name_taken: 'Another note type already has that name.',
  referenced: 'Field supplies use this note type. Take it out of those first.',
  not_removable: 'This note type can’t be removed: a Medical note is never finished without it.',
  no_update: 'No update is on offer for this note type.',
};

/**
 * A refusal with what the person needs to fix it: the current version when stale (and, for a take,
 * the platform version on offer now), the fields when a fixed one changed, the counts when
 * referenced. Every one is 409 but an edit that changes nothing, which is 422, as for presets.
 */
function refusal(
  code: NoteTypeRefusal,
  context: {
    held?: HeldNoteType;
    fields?: string[];
    referencedBy?: Record<string, number>;
    platformVersion?: number | null;
  } = {},
): ApiError {
  const details: Record<string, unknown> | undefined =
    code === 'stale'
      ? {
          currentVersion: context.held?.currentVersion,
          ...(context.platformVersion === undefined ? {} : { platformVersion: context.platformVersion }),
        }
      : code === 'fixed_field'
        ? { fields: context.fields ?? [] }
        : code === 'referenced'
          ? { referencedBy: context.referencedBy ?? {} }
          : undefined;
  return new ApiError(code === 'no_change' ? 422 : 409, code, MESSAGES[code], details);
}

const EDIT_MESSAGES: Record<NoteTypeEditCode, string> = {
  protected: 'This part can’t be changed.',
  in_use: 'Something else uses this part, here or in another note type. Change that first.',
  not_found: 'This names a part the note type doesn’t have. Reload it and try again.',
  title_invalid: 'A note type’s name is 1 to 80 characters.',
  label_invalid: 'A label needs words: it can’t be empty or only spaces.',
  last_option: 'A choice keeps one option at least.',
  last_field: 'A section or a group keeps one field at least.',
  last_section: 'A note type keeps one section at least.',
  too_many_fields: 'This note type has as many fields of the team’s own as it can hold.',
  too_many_sections: 'This note type has as many sections of the team’s own as it can hold.',
  not_copyable:
    'This section comes from a note type for other visits or other readers, so it can’t be copied here.',
  id_taken: 'This note type has used a part of that section before, so it can’t be copied here.',
  invalid: 'Some fields are missing or invalid.',
};

/**
 * An operation's refusal (5.4), answered with its index among the operations sent, the note type
 * whose field refused it when that is another one (rule 5), and what the validator found for a copy.
 */
function editRefusal(opIndex: number, refusal: NoteTypeEditRefusal): ApiError {
  return invalid(refusal.code, EDIT_MESSAGES[refusal.code], {
    opIndex,
    ...(refusal.noteTypeKey === undefined ? {} : { noteTypeKey: refusal.noteTypeKey }),
    ...(refusal.problems === undefined ? {} : { problems: refusal.problems }),
  });
}

/** What phase 4's validator and version rules found in the versions a write would store. */
const refusedVersions = (problems: readonly FileProblem[]) =>
  invalid('invalid', 'Some fields are missing or invalid.', { problems });

/**
 * Whether another active note type of the team holds the title, as lower() folds it in the
 * database, which JavaScript cannot repeat for every script. `except` are the note types the act
 * gives the title to or removes.
 */
async function titleHeld(w: Write, title: string, except: readonly string[]): Promise<boolean> {
  const [row] = await w.tx<{ taken: boolean }[]>`
    select exists (
      select 1 from sineobex.note_types
      where team_id = ${w.teamId}::uuid and state = 'active' and lower(title) = lower(${title})
        and key <> all(${except as string[]}::text[])) as taken`;
  return row!.taken;
}

/** The platform's note types, each at its newest released version, by key: what a copy reads. */
function platformNewest(): Record<string, ResolvedNoteType> {
  const newest = new Map<string, Preset>();
  for (const preset of PRESETS)
    if ((newest.get(preset.key)?.version ?? 0) < preset.version) newest.set(preset.key, preset);
  return Object.fromEntries([...newest].map(([key, p]) => [key, p.definition]));
}

/**
 * Every version of the note type, oldest first, each read as definitionFor reads it: the newest is
 * the head's current one, since every writer moves the head with the version it writes.
 */
async function versionsOf(w: Write, held: HeldNoteType): Promise<ResolvedNoteType[]> {
  const versions = ((await versionsFor(w.tx, w.teamId, [held.key])).get(held.key) ?? []).map(
    (v) => v.definition,
  );
  if (versions.at(-1)?.version !== held.currentVersion)
    throw new Error('a note type’s head is not at its newest version');
  return versions;
}

/**
 * What phase 4 checks in a version before it is stored (5.4): its validator, another note type
 * looked up at the version this write gives it, else at the team's current one, removed ones
 * included, since a removed note type's versions still read; the version rules against every
 * earlier version, with the renames the operations declared, which are never stored (forms 2.6);
 * and the size limit, which the validator measures as the hash is taken (MAX_DEFINITION_BYTES).
 */
function problemsOf(
  team: TeamNoteTypes,
  stored: ReadonlyMap<string, ResolvedNoteType>,
  next: ResolvedNoteType,
  earlier: readonly ResolvedNoteType[],
  renames: readonly Rename[],
): FileProblem[] {
  const lookup = (key: string) => stored.get(key) ?? team.get(key)?.definition;
  return [...validate(next, { noteType: lookup }), ...versionProblems(earlier, next, { renames })];
}

/** The audit event of a note type act: the version it made or stood on, never a title or a reason. */
const noteTypeAudit = (action: string, key: string, details: Record<string, unknown>): AuditEvent => ({
  action,
  entity: 'note_type',
  entityId: key,
  details,
});

/** The distinct names of the operations applied, in the order first sent, and how many there were. */
function operationsOf(ops: readonly NoteTypeEdit[]): { operations: string[]; count: number } {
  return { operations: [...new Set(ops.map((o) => o.op))], count: ops.length };
}

// ------------------------------------------------------------------------------------------------
// The acts (design 5.1, 5.4)
// ------------------------------------------------------------------------------------------------

/**
 * Publishes a team's edit of one of its note types (5.4): the operations applied in order to its
 * newest version, by packages/forms' editNoteTypes, which refuses an operation with its code and
 * carries each option operation along mapsTo to the fields of the team's other note types that share
 * its list (rule 5), naming the note type whose field refused it. Each note type it changes gets its
 * next version in this one transaction, named as its own row (4.3), checked with phase 4's validate,
 * version rules and size limit, stored as the team's own (`origin = 'team'`, `customized`), with its
 * own event and audit event. An edit from a version that is not the current one is stale, and a
 * removed note type is refused.
 */
export function publishNoteType(
  scope: PresetWriteScope,
  input: { key: string; baseVersion: number; ops: readonly NoteTypeEdit[]; reason: string },
): Promise<{ version: number; alsoPublished: string[] }> {
  return noteTypeWrite(scope, input.reason, async (w) => {
    const held = noteTypeOf(w.team, input.key);
    if (held.state === 'archived') throw refusal('archived');
    if (input.baseVersion !== held.currentVersion) throw refusal('stale', { held });
    const versions = await versionsOf(w, held);
    const active = w.team.all.filter((n) => n.state === 'active');
    const current = Object.fromEntries(active.map((n) => [n.key, n.definition]));
    const platform = platformNewest();
    // Every version of each note type an option operation may reach, so a code it makes is above
    // every one they have used (rule 3), and the version rules check each against all of its own;
    // the others at their current version alone, which is all an operation reads of them.
    const reachable = mayReach({ key: held.key, versions, team: current, platform });
    const loaded = await versionsFor(w.tx, w.teamId, reachable);
    const team = Object.fromEntries(
      active.map((n) => [
        n.key,
        n.key === held.key ? versions : (loaded.get(n.key)?.map((v) => v.definition) ?? [n.definition]),
      ]),
    );
    for (const key of reachable)
      if (team[key]!.at(-1)?.version !== w.team.get(key)!.currentVersion)
        throw new Error('a note type’s head is not at its newest version');
    const outcome = editNoteTypesApplied({ key: held.key, edits: input.ops, team, platform });
    if (!outcome.ok) throw editRefusal(outcome.opIndex, outcome.refusal);
    const [own, ...also] = outcome.published;
    if (own?.key !== held.key || also.some((p) => !reachable.includes(p.key)))
      throw new Error('a publish changed a note type it did not read every version of');
    // A publish that only renumbers the current version would send every phone a new one for nothing.
    if (
      also.length === 0 &&
      canonicalJson({ ...own.definition, version: held.currentVersion }) === canonicalJson(held.definition)
    )
      throw refusal('no_change');
    const stored = new Map(outcome.published.map((p) => [p.key, p.definition]));
    const problems = outcome.published.flatMap((p) =>
      problemsOf(w.team, stored, p.definition, team[p.key]!, p.renames),
    );
    if (problems.length > 0) throw refusedVersions(problems);
    if (own.definition.title !== held.title && (await titleHeld(w, own.definition.title, [held.key])))
      throw refusal('name_taken');
    return {
      changes: {
        versions: outcome.published.map((p) => ({
          key: p.key,
          definition: p.definition,
          origin: 'team' as const,
          presetVersion: null,
        })),
        made: [],
        changed: outcome.published.map((p) => ({
          key: p.key,
          title: p.definition.title,
          version: p.definition.version,
          customized: true,
        })),
        events: outcome.published.map((p) => ({
          key: p.key,
          act: 'updated' as const,
          version: p.definition.version,
        })),
        // One for each note type published, naming the operations applied to it.
        audits: () =>
          outcome.published.map((p) =>
            noteTypeAudit('note_type.published', p.key, {
              version: p.definition.version,
              ...operationsOf(p.applied.map((i) => input.ops[i]!)),
            }),
          ),
      },
      answer: () => ({ version: own.definition.version, alsoPublished: also.map((p) => p.key) }),
    };
  });
}
