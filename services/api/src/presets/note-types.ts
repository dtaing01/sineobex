import {
  canonicalJson,
  copyPart,
  editNoteTypesApplied,
  isNoteTypeTitle,
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
  type NoteType,
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
    // Every note type the team holds, a removed one too: it keeps its mapsTo and comes back as it is,
    // so a part it maps to is still in use (in_use), and an option operation still reaches the fields
    // that share its list (rule 5). Left out, a hide or a retire made while the quick encounter is
    // removed would leave it, once restored, mapping to what wound care no longer has.
    const current = Object.fromEntries(w.team.all.map((n) => [n.key, n.definition]));
    const platform = platformNewest();
    // Every version of each note type an option operation may reach, so a code it makes is above
    // every one they have used (rule 3), and the version rules check each against all of its own;
    // the others at their current version alone, which is all an operation reads of them.
    const reachable = mayReach({ key: held.key, versions, team: current, platform });
    const loaded = await versionsFor(w.tx, w.teamId, reachable);
    const team = Object.fromEntries(
      w.team.all.map((n) => [
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

/** What a blank note type's timeline group may be (forms 2.2): where the timeline files its notes. */
export const NOTE_TYPE_GROUPS = [
  'clinical',
  'psych',
  'social',
  'outreach',
  'harm_reduction',
  'wound',
] as const;

/** A key the team makes: `t_` and 12 hex characters, made by the server, which fits 0017's key (4.3). */
function newKey(team: TeamNoteTypes): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const key = `t_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    // Read under the lock, so a key no head holds is free until this write commits.
    if (!team.get(key)) return key;
  }
}

// PLAN-OPEN (BM-82): what does a blank note type start with? One section, Notes, holding one text
// field, Notes, since a definition has no empty lists (forms 2.2); the admin adds or copies sections.
/** A blank note type's version 1: one section, Notes, holding one text field, Notes. */
function blankNoteType(input: {
  key: string;
  title: string;
  kinds: NoteType['kinds'];
  group: NoteType['group'];
}): ResolvedNoteType {
  return {
    key: input.key,
    version: 1,
    title: input.title,
    // As a set, in one order: Medical exactly when it is ['medical'] (D56).
    kinds: (['medical', 'non_medical'] as const).filter((k) => input.kinds.includes(k)),
    group: input.group,
    sensitivity: 'none',
    sections: [
      {
        id: 'notes',
        title: 'Notes',
        fields: [{ id: 'notes', kind: 'text', label: 'Notes', lines: 'many', maxLength: 4000 }],
      },
    ],
  };
}

/** What may never be copied into a new note type: the quick encounter, and the auto one (5.4). */
const notCopyable = () =>
  invalid(
    'not_copyable',
    'The Quick encounter and the Red flags note type can’t be copied. Add a blank note type instead.',
  );

/** A title is sent as it is kept: one that starts or ends with white space is refused, never trimmed. */
function titleOf(raw: string): string {
  if (isNoteTypeTitle(raw) && raw === raw.trim()) return raw;
  throw new ApiError(422, 'validation_failed', 'Some fields are missing or invalid.', {
    fields: [{ path: 'title', problem: 'invalid' }],
  });
}

/**
 * Adds a note type of the team's own (5.4): a copy of the current version of one it holds, with its
 * kinds, group, sensitivity and marks, or a blank one with a title, kinds and a timeline group. Its
 * key is a new `t_` key and its version 1, named as its own row (4.3), the team's own
 * (`origin = 'team'`). The quick encounter and the auto note type cannot be copied.
 */
export function createNoteType(
  scope: PresetWriteScope,
  input: { title: string; reason: string } & (
    { copyOf: string } | { kinds: NoteType['kinds']; group: NoteType['group'] }
  ),
): Promise<{ key: string; version: 1 }> {
  const title = titleOf(input.title);
  return noteTypeWrite(scope, input.reason, async (w) => {
    const key = newKey(w.team);
    let definition: ResolvedNoteType;
    if ('copyOf' in input) {
      const source = noteTypeOf(w.team, input.copyOf);
      if (source.definition.quick === true || source.definition.auto !== undefined) throw notCopyable();
      definition = { ...copyPart(source.definition), key, version: 1, title };
    } else definition = blankNoteType({ key, title, kinds: input.kinds, group: input.group });
    const problems = problemsOf(w.team, new Map([[key, definition]]), definition, [], []);
    if (problems.length > 0) throw refusedVersions(problems);
    if (await titleHeld(w, title, [])) throw refusal('name_taken');
    return {
      changes: {
        versions: [{ key, definition, origin: 'team', presetVersion: null }],
        made: [{ key, title, platformLatest: null, customized: true }],
        changed: [],
        events: [{ key, act: 'created', version: 1 }],
        audits: () => [noteTypeAudit('note_type.created', key, { version: 1 })],
      },
      answer: () => ({ key, version: 1 as const }),
    };
  });
}

/**
 * Removes a note type at the version it is at (5.1): no phone offers it for a new note once it has
 * synced, and every version still reads, so a note begun on it finishes. Refused for the auto note
 * type, which a Medical note is never finished without (lifecycle 3.3), and while an active field
 * supply map names it.
 */
export function archiveNoteType(
  scope: PresetWriteScope,
  input: { key: string; baseVersion: number; reason: string },
): Promise<{ revision: number }> {
  return noteTypeWrite(scope, input.reason, async (w) => {
    const held = noteTypeOf(w.team, input.key);
    if (held.definition.auto !== undefined) throw refusal('not_removable');
    if (held.state === 'archived') throw refusal('archived');
    if (input.baseVersion !== held.currentVersion) throw refusal('stale', { held });
    const referenced = referencedBy(w.team, held.key);
    if (Object.keys(referenced).length > 0) throw refusal('referenced', { referencedBy: referenced });
    return {
      changes: stateChange(held, 'archived'),
      answer: (revision) => ({ revision }),
    };
  });
}

/** Restores a removed note type at the version it is at, unless another active one took its title. */
export function restoreNoteType(
  scope: PresetWriteScope,
  input: { key: string; reason: string },
): Promise<{ revision: number }> {
  return noteTypeWrite(scope, input.reason, async (w) => {
    const held = noteTypeOf(w.team, input.key);
    if (held.state !== 'archived') throw refusal('not_archived');
    if (await titleHeld(w, held.title, [held.key])) throw refusal('name_taken');
    return {
      changes: stateChange(held, 'active'),
      answer: (revision) => ({ revision }),
    };
  });
}

/** A remove or a restore: the head's state, made the team's own, with its event and audit at its version. */
function stateChange(held: HeldNoteType, state: 'active' | 'archived'): Changes {
  const act = state === 'archived' ? 'archived' : 'restored';
  return {
    versions: [],
    made: [],
    changed: [{ key: held.key, state, customized: true }],
    events: [{ key: held.key, act, version: held.currentVersion }],
    audits: () => [noteTypeAudit(`note_type.${act}`, held.key, { version: held.currentVersion })],
  };
}

/**
 * Takes the platform update on offer to a note type (5.1). In place, its next version is the
 * platform's definition named as that version (4.3), the platform's again (`customized` false), its
 * head named by the platform's title. As a new note type, the platform's definition becomes version
 * 1 of a new `t_` key, and the old one is removed if it was active; a field fixed at creation (kinds,
 * group, sensitivity, quick, auto) may change only that way, since the old one keeps its meaning.
 * Either version is the platform's (`origin = 'preset'`, its platform version), while the event
 * names the person and the reason. Only the platform version the person reviewed is taken: any
 * phone's list runs the installer, which may offer a newer one meanwhile.
 */
export function takeNoteTypeUpdate(
  scope: PresetWriteScope,
  input: { key: string; baseVersion: number; platformVersion: number; asNew: boolean; reason: string },
): Promise<{ key: string; version: number; revision: number }> {
  return noteTypeWrite(scope, input.reason, async (w) => {
    const held = noteTypeOf(w.team, input.key);
    const update = noteTypeUpdateOf(held);
    const offered = update?.preset.version ?? null;
    // The person's page was loaded at this version and offered this platform version: a newer one
    // on offer since is a change they have not seen, so the take is stale, as a newer copy makes it.
    const stale =
      input.baseVersion !== held.currentVersion || (offered !== null && offered !== input.platformVersion);
    if (!input.asNew && held.state === 'archived') throw refusal('archived');
    if (input.asNew && held.definition.auto !== undefined) throw refusal('not_removable');
    if (stale) throw refusal('stale', { held, platformVersion: offered });
    if (update === null) throw refusal('no_update');
    if (!input.asNew && update.changesFixed.length > 0)
      throw refusal('fixed_field', { fields: update.changesFixed });
    if (input.asNew && held.state === 'active') {
      const referenced = referencedBy(w.team, held.key);
      if (Object.keys(referenced).length > 0) throw refusal('referenced', { referencedBy: referenced });
    }
    // As new, the old one is removed by the same act, so its title is not counted.
    if (await titleHeld(w, update.preset.definition.title, [held.key])) throw refusal('name_taken');
    const { preset } = update;
    if (!input.asNew) {
      const { definition } = update;
      const versions = await versionsOf(w, held);
      // The platform's labels are its own meaning for its paths, checked against its own earlier
      // versions when it was released, as the team's rewordings were declared as renames: only a
      // path given another kind or unit is refused, never a label the platform words its own way.
      const problems = problemsOf(w.team, new Map([[held.key, definition]]), definition, versions, []).filter(
        (p) => p.rule !== 'versions.label_changed',
      );
      if (problems.length > 0) throw refusedVersions(problems);
      const { version } = definition;
      return {
        changes: {
          versions: [{ key: held.key, definition, origin: 'preset', presetVersion: preset.version }],
          made: [],
          changed: [{ key: held.key, title: definition.title, version, customized: false }],
          events: [{ key: held.key, act: 'update_taken', version }],
          audits: () => [noteTypeAudit('note_type.platform_update_taken', held.key, { version })],
        },
        answer: (revision) => ({ key: held.key, version, revision }),
      };
    }
    const key = newKey(w.team);
    const definition: ResolvedNoteType = { ...copyPart(preset.definition), key, version: 1 };
    const problems = problemsOf(w.team, new Map([[key, definition]]), definition, [], []);
    if (problems.length > 0) throw refusedVersions(problems);
    const wasActive = held.state === 'active';
    return {
      changes: {
        versions: [{ key, definition, origin: 'preset', presetVersion: preset.version }],
        made: [{ key, title: definition.title, platformLatest: preset.version, customized: false }],
        changed: wasActive ? [{ key: held.key, state: 'archived', customized: true }] : [],
        events: [
          ...(wasActive ? [{ key: held.key, act: 'archived' as const, version: held.currentVersion }] : []),
          { key, act: 'update_taken', version: 1 },
        ],
        audits: () => [
          ...(wasActive
            ? [noteTypeAudit('note_type.archived', held.key, { version: held.currentVersion })]
            : []),
          noteTypeAudit('note_type.platform_update_taken', key, { version: 1, replaces: held.key }),
        ],
      },
      answer: (revision) => ({ key, version: 1, revision }),
    };
  });
}

// ------------------------------------------------------------------------------------------------
// The history
// ------------------------------------------------------------------------------------------------

/** Every act a note type's history keeps (0023's acts; a note type is never reordered). */
export const NOTE_TYPE_ACTS = [
  'created',
  'updated',
  'archived',
  'restored',
  'update_taken',
  'installed',
  'platform_updated',
] as const;

export interface NoteTypeEvent {
  act: (typeof NOTE_TYPE_ACTS)[number];
  version: number;
  /** Whose version it is: the team's own, or the platform's, installed or taken by a person. */
  source: 'team' | 'platform';
  by: { userId: string; displayName: string } | null;
  at: string;
  reason: string | null;
}

/**
 * Every act on one of the team's note types, oldest first, each with the version it made or stood
 * on, who and why (design 8.1's history, as a preset's: the reason is kept only in
 * team_preset_events, and shown only here). By version before time, as a preset's history is
 * ordered: an installer run by a pull that began before an admin's later version can be dated
 * before it. A key the team holds no head of is 404. Reading it is not audited (PL-13).
 */
export async function noteTypeHistory(tx: Tx, teamId: string, key: string): Promise<NoteTypeEvent[]> {
  const [head] = await tx`select 1 from sineobex.note_types where team_id = ${teamId} and key = ${key}`;
  if (!head) throw notFound('note type');
  const rows = await tx<
    {
      act: NoteTypeEvent['act'];
      version: number;
      origin: 'team' | 'preset' | null;
      byId: string | null;
      byName: string | null;
      at: Date;
      reason: string | null;
    }[]
  >`
    select e.act, e.version, v.origin, e.created_by as by_id, u.display_name as by_name,
           e.created_at as at, e.reason
    from sineobex.team_preset_events e
    left join sineobex.note_type_versions v
      on v.team_id = e.team_id and v.key = e.note_type_key and v.version = e.version
    left join sineobex.users u on u.id = e.created_by
    where e.team_id = ${teamId} and e.note_type_key = ${key}
    order by e.version, e.created_at, e.id`;
  return rows.map((r) => {
    // Every act names a version its note type holds (this file, the installer).
    if (r.origin === null) throw new Error('a note type event’s version is missing');
    return {
      act: r.act,
      version: r.version,
      source: r.origin === 'team' ? 'team' : 'platform',
      by: r.byId === null ? null : { userId: r.byId, displayName: r.byName ?? '' },
      at: r.at.toISOString(),
      reason: r.reason,
    };
  });
}
