import { z } from '@hono/zod-openapi';
import { takeRevision } from '@sineobex/forms';
import {
  BODY_SCHEMAS,
  changedFixedFields,
  definitionsOf,
  heldBy,
  installTeamPresets,
  PLATFORM,
  presetRefs,
  presetWriteEffect,
  reorderRanks,
  totalsOf,
  validatePreset,
  withIds,
  type HeldPreset,
  type PlatformEntry,
  type PresetAct,
  type PresetBody,
  type PresetHeadAfter,
  type PresetKind,
  type PresetProblem,
  type PresetRef,
  type PresetRefusal,
  type PresetWriteInput,
  type TeamPresetsInstalled,
} from '@sineobex/presets';
import type { Context } from 'hono';
import { teamScope, type AuditEvent, type AuditFn, type TeamScope } from '../auth/context.ts';
import type { Permission } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { ApiError, conflict, invalid, notFound } from '../lib/errors.ts';
import type { Logger } from '../lib/log.ts';
import { canonicalJson } from '../sync/canonical.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import type { AppEnv, Deps } from '../types.ts';

/**
 * The one writer of a team's presets (phase 5 design 4.2, 5.1, 7, 9; D129, D131, D132): every admin
 * write goes through here, and so does the platform installer that team creation and the phone's
 * pull run. Nothing else writes a preset. Each write
 *  - is made in a scope that holds team.manage_presets and a sign-in within RECENT_AUTH_MINUTES
 *    (presetWriteScope), whose stale-sign-in refusal is logged nowhere (D98);
 *  - takes the team lock (lockTeamWrites) as its transaction's first statement, so what it reads
 *    and decides holds until it commits, and works out what it will do under it: the body as its
 *    kind's schema parses it, validatePreset against the team's presets, the name as the database
 *    folds it, and presetWriteEffect for what the act does or refuses (5.1 is its authority);
 *  - refuses before it writes anything, so a refusal leaves no row and takes no revision;
 *  - then takes one revision (takeRevision) and stamps every head it touches with it, which is
 *    what the phone's pull reads (6.1) and what 0023's guard holds every head to;
 *  - keeps its reason in team_preset_events, by the person, and audits in the same transaction,
 *    with field names and counts only: never a reason, a name or a body's text (9).
 */

const MANAGE_PRESETS: Permission = 'team.manage_presets';

declare const mayWritePresets: unique symbol;
/** A team scope whose person holds team.manage_presets and signed in recently: what every write asks. */
export type PresetWriteScope = TeamScope & { readonly [mayWritePresets]: true };

/**
 * The scope of every preset write: team.manage_presets, logged as access.denied when it is
 * missing, then a sign-in within RECENT_AUTH_MINUTES (PRD main 600: "sign-in again for exports and
 * admin actions"), in that order, as every admin write built so far asks them.
 */
export async function presetWriteScope(c: Context<AppEnv>, deps: Deps): Promise<PresetWriteScope> {
  return (await teamScope(c, deps, { permissions: [MANAGE_PRESETS], recentAuth: true })) as PresetWriteScope;
}

/** The scope of the admin reads (the lists and a history): the permission, and no recent sign-in. */
export function presetReadScope(c: Context<AppEnv>, deps: Deps): Promise<TeamScope> {
  return teamScope(c, deps, { permissions: [MANAGE_PRESETS] });
}

// ------------------------------------------------------------------------------------------------
// The reason, and the body as it is sent
// ------------------------------------------------------------------------------------------------

// Half of a surrogate pair without its other half, read as UTF-16 code units (no `u` flag).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Whether a text can be stored: PostgreSQL's text holds no NUL, and UTF-8 no half of a pair. */
export function storable(text: string): boolean {
  // A lone surrogate would be stored as U+FFFD, a text the person never typed; a NUL is refused by
  // the database with an error that is no refusal of the request's.
  return !text.includes('\u0000') && !LONE_SURROGATE.test(text);
}

// PLAN-OPEN (PL-14): does every preset and note type write need a reason? Yes, every write by a
// person: 3 to 300 characters, kept with the act in team_preset_events and shown in the history,
// never in the audit log nor in a log line.
/**
 * The reason every write takes, as it is kept: trimmed, then 3 to 300 characters counted in code
 * points, as 0023's check counts them, and a text the database can store.
 */
export const PresetReason = z
  .string()
  .trim()
  .min(3)
  .max(300)
  .refine(storable, { message: 'unstorable' })
  .openapi({
    description: 'Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log.',
  });

/** The reason as it is kept, or the request's own refusal of it, whichever route sent it. */
function reasonOf(raw: string): string {
  const parsed = PresetReason.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new ApiError(422, 'validation_failed', 'Some fields are missing or invalid.', {
    fields: [{ path: 'reason', problem: parsed.error.issues[0]?.code ?? 'invalid' }],
  });
}

/** The first text in a sent value that cannot be stored, by its path; null when there is none. */
function unstorableAt(value: unknown, path: (string | number)[] = []): string | null {
  if (typeof value === 'string') return storable(value) ? null : path.join('.');
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const at = unstorableAt(v, [...path, i]);
      if (at !== null) return at;
    }
  } else if (value !== null && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      const at = storable(k) ? unstorableAt(v, [...path, k]) : [...path, k].join('.');
      if (at !== null) return at;
    }
  return null;
}

const refusedBody = (problems: readonly { path: string; code: string }[]) =>
  invalid('invalid', 'Some fields are missing or invalid.', { problems });

/**
 * A body as its kind's schema parses it, defaults filled in: what is stored, compared and checked.
 * A body the schema refuses, or holding a text no database can store, is 422 invalid with the path
 * of each problem; an issue's code is the schema's own word for it, never what was sent.
 */
export function parsePresetBody(kind: PresetKind, raw: unknown): PresetBody {
  const at = unstorableAt(raw);
  if (at !== null) throw refusedBody([{ path: at, code: 'unstorable' }]);
  const parsed = BODY_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success)
    throw refusedBody(
      parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code === 'custom' ? i.message : i.code,
      })),
    );
  return parsed.data as PresetBody;
}

// ------------------------------------------------------------------------------------------------
// The team's presets, read under the lock
// ------------------------------------------------------------------------------------------------

/** Every preset of the team, its refs as validatePreset reads them, and its platform copies. */
export interface TeamPresets {
  readonly all: readonly HeldPreset[];
  readonly refs: Readonly<Record<string, PresetRef>>;
  get(id: string): HeldPreset | undefined;
  /** The team's ID of each platform preset it holds, by origin key: how a platform body names them. */
  readonly idsByOrigin: ReadonlyMap<string, string>;
}

/**
 * Every head of the team with its current body, as the installer reads them (heldBy), and their
 * refs as its plan builds them (presetRefs), so a write and an install check a body alike. A write
 * reads them under the team lock, so they hold until it commits.
 */
export async function loadTeamPresets(tx: Tx, teamId: string): Promise<TeamPresets> {
  const all = await heldBy(tx, teamId);
  const byId = new Map(all.map((p) => [p.id, p]));
  return {
    all,
    refs: presetRefs(all),
    get: (id) => byId.get(id),
    idsByOrigin: new Map(all.flatMap((p) => (p.originKey === null ? [] : [[p.originKey, p.id] as const]))),
  };
}

/**
 * The IDs a body names (design 4.4): an item's category, the items of a bundle's, a map's and a
 * condition map's lines, a bag's minimums and the settings' template for a new bag, as withIds
 * reads them.
 */
function namedBy(kind: PresetKind, body: PresetBody): string[] {
  const items = (lines: unknown) => (lines as { itemId: string }[]).map((l) => l.itemId);
  const b = body as Record<string, unknown>;
  switch (kind) {
    case 'item':
      return [b.categoryId as string];
    case 'bundle':
    case 'field_supply_map':
    case 'condition_supply_map':
      return items(b.lines);
    case 'bag':
      return items(b.minimums);
    case 'settings':
      return items(b.newBagMinimums);
    default:
      return [];
  }
}

/**
 * The active presets whose current body names this one, counted by their kind, each once however
 * many of its lines name it; only the kinds that do. An archived preset names nothing that matters:
 * it is offered for no new work.
 */
export function referencedBy(team: TeamPresets, id: string): Partial<Record<PresetKind, number>> {
  const counts: Partial<Record<PresetKind, number>> = {};
  for (const p of team.all)
    if (p.state === 'active' && p.body !== null && namedBy(p.kind, p.body).includes(id))
      counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  return counts;
}

/** The platform version on offer to a copy, its body naming the team's presets, and what it fixes. */
export interface PlatformUpdate {
  entry: PlatformEntry;
  body: PresetBody;
  /** The fields fixed at creation it would change: such an update is taken only as a new preset. */
  changesFixed: string[];
}

/**
 * The update on offer to a platform copy: the platform's version at platform_latest, once that is
 * above the version the copy was last taken from; null when none is, or the platform no longer
 * holds that version, or the copy's body cannot be read to compare it with.
 */
export function platformUpdateOf(team: TeamPresets, preset: HeldPreset): PlatformUpdate | null {
  if (preset.originKey === null || preset.body === null) return null;
  if ((preset.platformLatest ?? 0) <= (preset.originVersion ?? 0)) return null;
  const entry = PLATFORM.find(
    (e) => e.originKey === preset.originKey && e.platformVersion === preset.platformLatest,
  );
  if (!entry || entry.kind !== preset.kind) return null;
  const body = withIds(entry.kind, entry.body, team.idsByOrigin) as PresetBody;
  return { entry, body, changesFixed: changedFixedFields(preset.kind, preset.body, body) };
}

// ------------------------------------------------------------------------------------------------
// One write
// ------------------------------------------------------------------------------------------------

/** What one write changes, worked out before anything is written; `commit` writes it all at once. */
interface Changes {
  /** New heads, made by the person, each as presetWriteEffect answers its head after the act. */
  made: {
    id: string;
    kind: PresetKind;
    name: string;
    head: PresetHeadAfter;
    originKey: string | null;
    originVersion: number | null;
    platformLatest: number | null;
  }[];
  /** Heads changed; a column left out keeps its value. */
  changed: {
    id: string;
    name?: string;
    state?: 'active' | 'archived';
    version?: number;
    customized?: boolean;
    /** The copy is no longer the platform's: taken as a new preset, the new one is. */
    dropOrigin?: true;
    originVersion?: number;
  }[];
  /** A person's version is the team's, by them; a platform version is by nobody (0023). */
  versions: { id: string; version: number; body: PresetBody; source: 'team' | 'platform' }[];
  /** One act on each preset the write changes, with the write's reason and person. */
  events: { id: string; act: string; version: number }[];
  /** The audit events, given the revision the write took. */
  audits: (revision: number) => AuditEvent[];
}

interface Write {
  tx: Tx;
  teamId: string;
  userId: string;
  team: TeamPresets;
}

/**
 * Runs one write: a recent sign-in again, so no caller can skip it; the team lock as the
 * transaction's first statement; the team's presets read under it; then `act`, which works out
 * the write, refusing by throwing, and answers what to write and what to answer. Only a write
 * that will happen takes a revision.
 */
async function presetWrite<T>(
  scope: PresetWriteScope,
  reason: string,
  act: (w: Write) => Promise<{ changes: Changes | null; answer: (revision: number) => T }>,
): Promise<T> {
  scope.requireRecentAuth();
  const kept = reasonOf(reason);
  const { teamId } = scope.team;
  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, teamId);
    const w: Write = { tx, teamId, userId: scope.principal.userId, team: await loadTeamPresets(tx, teamId) };
    const { changes, answer } = await act(w);
    // A write that changes nothing (an order as it is) takes no revision and writes nothing.
    if (changes === null) return answer(0);
    const revision = await commit(w, changes, kept);
    for (const event of changes.audits(revision)) await audit(event);
    return answer(revision);
  });
}

/**
 * Takes the write's one revision and writes everything it changes, each kind of row in one
 * statement: heads changed first, so a name or an origin key the write frees is free before a new
 * head takes it, then new heads, versions and events. Rows travel as one JSON text cast to jsonb,
 * as the installer sends them.
 */
async function commit(w: Write, changes: Changes, reason: string): Promise<number> {
  const { tx, teamId, userId } = w;
  const rows = (list: readonly object[]) => JSON.stringify(list);
  const revision = await takeRevision(tx, teamId);
  await mapRefusals(async () => {
    if (changes.changed.length > 0) {
      const updated = await tx<{ id: string }[]>`
        update sineobex.team_presets as p
        set name = coalesce(u.name, p.name), state = coalesce(u.state, p.state),
            current_version = coalesce(u.version, p.current_version),
            customized = coalesce(u.customized, p.customized),
            origin_key = case when u.drop_origin then null else p.origin_key end,
            origin_version = coalesce(u.origin_version, p.origin_version),
            revision = ${revision}::bigint, updated_by = ${userId}::uuid
        from jsonb_to_recordset(${rows(
          changes.changed.map((c) => ({
            id: c.id,
            name: c.name ?? null,
            state: c.state ?? null,
            version: c.version ?? null,
            customized: c.customized ?? null,
            drop_origin: c.dropOrigin ?? null,
            origin_version: c.originVersion ?? null,
          })),
        )}::text::jsonb) as u (id uuid, name text, state text, version integer, customized boolean,
                               drop_origin boolean, origin_version integer)
        where p.team_id = ${teamId}::uuid and p.id = u.id
        returning p.id`;
      // Read under the lock, so every head is there; one missing is a fault, never half a write.
      if (updated.length !== changes.changed.length)
        throw new Error('a preset write changed fewer heads than it worked out; undo the transaction');
    }
    // A new head's state, version and `customized` are presetWriteEffect's, never a column's
    // default, so the store and the seed, the other writer of a team's own presets, cannot drift.
    if (changes.made.length > 0)
      await tx`
        insert into sineobex.team_presets
          (team_id, id, kind, name, state, current_version, customized, origin_key, origin_version,
           platform_latest, revision, created_by, updated_by)
        select ${teamId}::uuid, h.id, h.kind, h.name, h.state, h.version, h.customized, h.origin_key,
               h.origin_version, h.platform_latest, ${revision}::bigint, ${userId}::uuid, ${userId}::uuid
        from jsonb_to_recordset(${rows(
          changes.made.map((m) => ({
            id: m.id,
            kind: m.kind,
            name: m.name,
            state: m.head.stateAfter,
            version: m.head.versionAfter,
            customized: m.head.customizedAfter,
            origin_key: m.originKey,
            origin_version: m.originVersion,
            platform_latest: m.platformLatest,
          })),
        )}::text::jsonb) as h (id uuid, kind text, name text, state text, version integer,
                               customized boolean, origin_key text, origin_version integer,
                               platform_latest integer)`;
    if (changes.versions.length > 0)
      await tx`
        insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source, created_by)
        select ${teamId}::uuid, v.id, v.version, v.body, v.source,
               case when v.source = 'team' then ${userId}::uuid end
        from jsonb_to_recordset(${rows(changes.versions)}::text::jsonb)
          as v (id uuid, version integer, body jsonb, source text)`;
    await tx`
      insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
      select ${teamId}::uuid, e.id, e.act, e.version, ${reason}, ${userId}::uuid
      from jsonb_to_recordset(${rows(changes.events)}::text::jsonb) as e (id uuid, act text, version integer)`;
  });
  return revision;
}

/**
 * The refusals the database answers that a person can reach, answered as the write's own: under
 * the lock the name was asked of the database already, so its unique name answers only a writer
 * that skipped the lock; a body's size is measured as the database writes it out (0023), which
 * nothing here repeats. Either way the transaction is undone with the refusal.
 */
async function mapRefusals(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    const e = err as { code?: unknown; constraint_name?: unknown } | null;
    if (e?.code === '23505' && e.constraint_name === 'team_presets_active_name') throw nameTaken();
    if (e?.code === '23514' && e.constraint_name === 'team_preset_versions_body_size')
      throw refusedBody([{ path: '', code: 'too_large' }]);
    throw err;
  }
}

// ------------------------------------------------------------------------------------------------
// What each act reads, and how it is refused
// ------------------------------------------------------------------------------------------------

/** The preset an act names: one of the team's, of the kind in the address; anything else is 404. */
function presetOf(team: TeamPresets, kind: PresetKind, id: string): HeldPreset {
  const preset = team.get(id);
  if (!preset || preset.kind !== kind) throw notFound('preset');
  return preset;
}

/** A preset's current body: every writer writes a head with its version, so one missing is a fault. */
function bodyOf(preset: HeldPreset): PresetBody {
  if (preset.body === null) throw new Error('a preset’s current version is missing');
  return preset.body;
}

/**
 * Whether another active preset of the kind holds the name, as the database's unique name folds it
 * (lower(), team_presets_active_name), which JavaScript cannot repeat for every script. `except`
 * are the presets the act gives the name to or archives.
 */
async function nameHeld(w: Write, kind: PresetKind, name: string, except: readonly string[]) {
  const [row] = await w.tx<{ taken: boolean }[]>`
    select exists (
      select 1 from sineobex.team_presets
      where team_id = ${w.teamId}::uuid and kind = ${kind} and state = 'active'
        and lower(name) = lower(${name}) and id <> all(${except as string[]}::uuid[])) as taken`;
  return row!.taken;
}

/** What validatePreset finds of a body against the team, split into archived references and the rest. */
async function problemsOf(w: Write, kind: PresetKind, body: PresetBody, id: string | null) {
  const keys = kind === 'field_supply_map' ? [(body as { noteTypeKey: string }).noteTypeKey] : [];
  const definitions = await definitionsOf(w.tx, w.teamId, keys);
  const problems = validatePreset({ kind, body, refs: w.team.refs, definitions, id });
  return {
    problems,
    archived: problems.filter((p) => p.code === 'reference_archived'),
    others: problems.filter((p) => p.code !== 'reference_archived'),
  };
}

/** An act's input to presetWriteEffect, every field the act does not read at its neutral value. */
const effectInput = (
  input: Partial<PresetWriteInput> & Pick<PresetWriteInput, 'act' | 'kind'>,
): PresetWriteInput => ({
  state: null,
  baseVersion: null,
  currentVersion: null,
  changedFixed: false,
  sameBody: false,
  referencedBy: {},
  archivedRefs: 0,
  nameTaken: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  ...input,
});

const nameTaken = () => conflict('name_taken', 'Another preset of this kind already has that name.');

const MESSAGES: Record<PresetRefusal, string> = {
  archived: 'This preset is archived. Restore it first.',
  not_archived: 'This preset isn’t archived.',
  stale: 'Someone changed this preset since you opened it. Reload it and try again.',
  no_change: 'Nothing was changed.',
  fixed_field: 'Some fields can’t change once a preset is made. Archive it and add a new one instead.',
  name_taken: 'Another preset of this kind already has that name.',
  reference_archived: 'It names a preset that is archived.',
  referenced: 'Other presets name this one. Change them first.',
  not_removable: 'The team’s settings can’t be archived or replaced.',
  no_update: 'No update is on offer for this preset.',
};

/**
 * A refusal presetWriteEffect answered, with what the person needs to fix it: the current version
 * when stale, the fields when a fixed one changed, the counts when referenced, the paths when an
 * archived preset is named. Every refusal is 409 but what the sent body alone gets wrong: an edit's
 * fixed field and an edit that changes nothing are 422.
 */
function refusal(
  code: PresetRefusal,
  context: {
    preset?: HeldPreset;
    fields?: string[];
    referencedBy?: Partial<Record<PresetKind, number>>;
    archived?: PresetProblem[];
    act?: PresetAct;
    /** A take-update's: the platform version on offer now, null when none is. */
    platformVersion?: number | null;
  } = {},
): ApiError {
  const details: Record<string, unknown> | undefined =
    code === 'stale'
      ? {
          currentVersion: context.preset?.currentVersion,
          ...(context.platformVersion === undefined ? {} : { platformVersion: context.platformVersion }),
        }
      : code === 'fixed_field'
        ? { fields: context.fields ?? [] }
        : code === 'referenced'
          ? { referencedBy: context.referencedBy ?? {} }
          : code === 'reference_archived'
            ? { problems: context.archived ?? [] }
            : undefined;
  const status = context.act === 'edit' && (code === 'fixed_field' || code === 'no_change') ? 422 : 409;
  const message =
    code === 'fixed_field' && context.act === 'take_update'
      ? 'This update changes a field that can’t change. Take it as a new preset instead.'
      : MESSAGES[code];
  return new ApiError(status, code, message, details);
}

/** The top-level fields whose value differs, sorted: an audit event names them, never their values. */
function changedFields(before: PresetBody, after: PresetBody): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const same = (x: unknown, y: unknown) =>
    x === undefined || y === undefined ? x === y : canonicalJson(x) === canonicalJson(y);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k])).sort();
}

const fieldsOf = (body: PresetBody) => Object.keys(body).sort();

/** A preset event's audit: its kind, the version it made or stood on, the revision, field names. */
const presetAudit = (
  action: string,
  preset: { id: string; kind: PresetKind },
  version: number,
  revision: number,
  fields: string[],
  extra: Record<string, unknown> = {},
): AuditEvent => ({
  action,
  entity: 'preset',
  entityId: preset.id,
  details: { kind: preset.kind, version, revision, fields, ...extra },
});

// ------------------------------------------------------------------------------------------------
// The acts (design 5.1)
// ------------------------------------------------------------------------------------------------

/** Adds a preset of the team's own: version 1, as its schema parses the body. */
export function createPreset(
  scope: PresetWriteScope,
  input: { kind: PresetKind; body: unknown; reason: string },
): Promise<{ id: string; version: 1; revision: number }> {
  const { kind } = input;
  return presetWrite(scope, input.reason, async (w) => {
    const body = parsePresetBody(kind, input.body);
    const { archived, others } = await problemsOf(w, kind, body, null);
    if (others.length > 0) throw refusedBody([...others, ...archived]);
    const effect = presetWriteEffect(
      effectInput({
        act: 'create',
        kind,
        archivedRefs: archived.length,
        nameTaken: await nameHeld(w, kind, body.name, []),
      }),
    );
    if ('refuse' in effect) throw refusal(effect.refuse, { archived });
    const id = crypto.randomUUID();
    // 5.1 starts every preset at version 1, which the contract answers as such.
    const version = effect.versionAfter as 1;
    return {
      changes: {
        made: [
          {
            id,
            kind,
            name: body.name,
            head: effect,
            originKey: null,
            originVersion: null,
            platformLatest: null,
          },
        ],
        changed: [],
        versions: [{ id, version, body, source: 'team' }],
        events: [{ id, act: 'created', version }],
        audits: (revision) => [
          presetAudit('preset.created', { id, kind }, version, revision, fieldsOf(body)),
        ],
      },
      answer: (revision) => ({ id, version, revision }),
    };
  });
}

/** Gives a preset its next version from the body sent, made the team's own (`customized`). */
export function editPreset(
  scope: PresetWriteScope,
  input: { kind: PresetKind; id: string; baseVersion: number; body: unknown; reason: string },
): Promise<{ version: number; revision: number }> {
  const { kind } = input;
  return presetWrite(scope, input.reason, async (w) => {
    const preset = presetOf(w.team, kind, input.id);
    const current = bodyOf(preset);
    const body = parsePresetBody(kind, input.body);
    const { archived, others } = await problemsOf(w, kind, body, preset.id);
    if (others.length > 0) throw refusedBody([...others, ...archived]);
    const fixed = changedFixedFields(kind, current, body);
    const effect = presetWriteEffect(
      effectInput({
        act: 'edit',
        kind,
        state: preset.state,
        baseVersion: input.baseVersion,
        currentVersion: preset.currentVersion,
        changedFixed: fixed.length > 0,
        // As stored and as parsed, whatever order its keys were sent in.
        sameBody: canonicalJson(current) === canonicalJson(body),
        archivedRefs: archived.length,
        // Its own name in another case is its own.
        nameTaken: await nameHeld(w, kind, body.name, [preset.id]),
      }),
    );
    if ('refuse' in effect) throw refusal(effect.refuse, { act: 'edit', preset, fields: fixed, archived });
    const version = effect.versionAfter;
    return {
      changes: {
        made: [],
        changed: [
          {
            id: preset.id,
            name: body.name,
            state: effect.stateAfter,
            version,
            customized: effect.customizedAfter,
          },
        ],
        versions: [{ id: preset.id, version, body, source: 'team' }],
        events: [{ id: preset.id, act: 'updated', version }],
        audits: (revision) => [
          presetAudit('preset.updated', preset, version, revision, changedFields(current, body)),
        ],
      },
      answer: (revision) => ({ version, revision }),
    };
  });
}

/** Archives a preset at the version it is at; refused while an active preset names it (D131). */
export function archivePreset(
  scope: PresetWriteScope,
  input: { kind: PresetKind; id: string; baseVersion: number; reason: string },
): Promise<{ revision: number }> {
  return presetWrite(scope, input.reason, async (w) => {
    const preset = presetOf(w.team, input.kind, input.id);
    const referenced = referencedBy(w.team, preset.id);
    const effect = presetWriteEffect(
      effectInput({
        act: 'archive',
        kind: preset.kind,
        state: preset.state,
        baseVersion: input.baseVersion,
        currentVersion: preset.currentVersion,
        referencedBy: referenced,
      }),
    );
    if ('refuse' in effect) throw refusal(effect.refuse, { preset, referencedBy: referenced });
    return {
      changes: stateChange(preset, effect, 'archived', 'preset.archived'),
      answer: (revision) => ({ revision }),
    };
  });
}

/** Restores an archived preset at the version it is at, made the team's own. */
export function restorePreset(
  scope: PresetWriteScope,
  input: { kind: PresetKind; id: string; reason: string },
): Promise<{ revision: number }> {
  return presetWrite(scope, input.reason, async (w) => {
    const preset = presetOf(w.team, input.kind, input.id);
    const { archived } = await problemsOf(w, preset.kind, bodyOf(preset), preset.id);
    const effect = presetWriteEffect(
      effectInput({
        act: 'restore',
        kind: preset.kind,
        state: preset.state,
        // It is restored at the version it is at, so the effect reads it from there.
        currentVersion: preset.currentVersion,
        archivedRefs: archived.length,
        nameTaken: await nameHeld(w, preset.kind, preset.name, [preset.id]),
      }),
    );
    if ('refuse' in effect) throw refusal(effect.refuse, { preset, archived });
    return {
      changes: stateChange(preset, effect, 'restored', 'preset.restored'),
      answer: (revision) => ({ revision }),
    };
  });
}

/** An archive or a restore: the head's state and `customized`, its event and audit at its version. */
function stateChange(
  preset: HeldPreset,
  effect: { stateAfter: 'active' | 'archived'; versionAfter: number; customizedAfter: boolean },
  act: 'archived' | 'restored',
  action: string,
): Changes {
  return {
    made: [],
    changed: [{ id: preset.id, state: effect.stateAfter, customized: effect.customizedAfter }],
    versions: [],
    events: [{ id: preset.id, act, version: effect.versionAfter }],
    audits: (revision) => [presetAudit(action, preset, effect.versionAfter, revision, [])],
  };
}

/**
 * Takes the platform update on offer to a copy (5.1). In place, the copy's next version is the
 * platform's body, the platform's again (`customized` false), and it is offered nothing more. As a
 * new preset, the platform's body becomes a new preset that takes the copy's origin key, and the old
 * copy is archived, if it was active, and is no longer the platform's; a field fixed at creation
 * may change that way, since the old preset keeps its meaning. Either way the version is the
 * platform's, by nobody (0023), while the event names the person and the reason. Only the
 * platform version the person reviewed is taken: any pull may offer a newer one meanwhile.
 */
export function takePlatformUpdate(
  scope: PresetWriteScope,
  input: {
    kind: PresetKind;
    id: string;
    baseVersion: number;
    /** The platform version the person was shown on offer (the list's `update`). */
    platformVersion: number;
    asNew: boolean;
    reason: string;
  },
): Promise<{ id: string; version: number; revision: number }> {
  const act: PresetAct = input.asNew ? 'take_update_as_new' : 'take_update';
  return presetWrite(scope, input.reason, async (w) => {
    const preset = presetOf(w.team, input.kind, input.id);
    const { kind } = preset;
    const update = platformUpdateOf(w.team, preset);
    const referenced = referencedBy(w.team, preset.id);
    const checked = update && (await problemsOf(w, kind, update.body, input.asNew ? null : preset.id));
    // The person's form was loaded at the copy's version and at the platform version it offered: a
    // newer one on offer since is a change they have not seen, so the take is stale, as a newer
    // copy would make it (5.1), and they are shown it before they take it.
    const reviewed = update === null || update.entry.platformVersion === input.platformVersion;
    const effect = presetWriteEffect(
      effectInput({
        act,
        kind,
        state: preset.state,
        baseVersion: reviewed ? input.baseVersion : null,
        currentVersion: preset.currentVersion,
        referencedBy: referenced,
        archivedRefs: checked?.archived.length ?? 0,
        // As new, the old preset is archived by the same act, so its name is not counted.
        nameTaken: update !== null && (await nameHeld(w, kind, update.body.name, [preset.id])),
        updateOnOffer: update !== null,
        updateChangesFixed: (update?.changesFixed.length ?? 0) > 0,
      }),
    );
    if ('refuse' in effect)
      throw refusal(effect.refuse, {
        act,
        preset,
        fields: update?.changesFixed,
        referencedBy: referenced,
        archived: checked?.archived,
        platformVersion: update?.entry.platformVersion ?? null,
      });
    // An update the team's presets refuse for anything else is not written either.
    if (checked!.others.length > 0) throw refusedBody(checked!.problems);
    const { body, entry } = update!;
    if (!input.asNew) {
      const version = effect.versionAfter;
      return {
        changes: {
          made: [],
          changed: [
            {
              id: preset.id,
              name: body.name,
              version,
              customized: effect.customizedAfter,
              originVersion: entry.platformVersion,
            },
          ],
          versions: [{ id: preset.id, version, body, source: 'platform' }],
          events: [{ id: preset.id, act: 'update_taken', version }],
          audits: (revision) => [
            presetAudit(
              'preset.platform_update_taken',
              preset,
              version,
              revision,
              changedFields(bodyOf(preset), body),
            ),
          ],
        },
        answer: (revision) => ({ id: preset.id, version, revision }),
      };
    }
    const id = crypto.randomUUID();
    const created = effect.created!;
    const wasActive = preset.state === 'active';
    return {
      changes: {
        made: [
          {
            id,
            kind,
            name: body.name,
            head: created,
            originKey: preset.originKey,
            originVersion: entry.platformVersion,
            platformLatest: entry.platformVersion,
          },
        ],
        changed: [
          { id: preset.id, state: effect.stateAfter, customized: effect.customizedAfter, dropOrigin: true },
        ],
        versions: [{ id, version: created.versionAfter, body, source: 'platform' }],
        events: [
          ...(wasActive ? [{ id: preset.id, act: 'archived', version: effect.versionAfter }] : []),
          { id, act: 'update_taken', version: created.versionAfter },
        ],
        audits: (revision) => [
          ...(wasActive ? [presetAudit('preset.archived', preset, effect.versionAfter, revision, [])] : []),
          presetAudit(
            'preset.platform_update_taken',
            { id, kind },
            created.versionAfter,
            revision,
            fieldsOf(body),
            {
              replaces: preset.id,
            },
          ),
        ],
      },
      answer: (revision) => ({ id, version: created.versionAfter, revision }),
    };
  });
}

/**
 * Puts a tier's active flags in the order sent: each flag whose rank the order changes gets its
 * next version, the team's own, so a platform version of it is only offered and never puts the
 * platform's rank back (5.1). An order that moves none writes nothing, an audit event included.
 */
export function reorderFlags(
  scope: PresetWriteScope,
  input: { tier: 'primary' | 'secondary'; ids: readonly string[]; reason: string },
): Promise<{ changed: number }> {
  return presetWrite(scope, input.reason, async (w) => {
    const flags = w.team.all.filter(
      (p) =>
        p.kind === 'flag' &&
        p.state === 'active' &&
        (p.body as { tier?: unknown } | null)?.tier === input.tier,
    );
    const moved = reorderRanks(
      flags.map((f) => ({ id: f.id, rank: (bodyOf(f) as { rank: number }).rank })),
      input.ids,
    );
    if ('refuse' in moved)
      throw invalid('ids_mismatch', 'The list of flags has changed. Reload it and try again.');
    if (moved.length === 0) return { changes: null, answer: () => ({ changed: 0 }) };
    const changes: Changes = {
      made: [],
      changed: [],
      versions: [],
      events: [],
      audits: () => [
        {
          action: 'preset.reordered',
          entity: 'preset',
          details: { tier: input.tier, changed: moved.length },
        },
      ],
    };
    for (const { id, rank } of moved) {
      const flag = w.team.get(id)!;
      const effect = presetWriteEffect(
        effectInput({ act: 'reorder', kind: 'flag', state: flag.state, currentVersion: flag.currentVersion }),
      );
      if ('refuse' in effect) throw refusal(effect.refuse, { preset: flag });
      const version = effect.versionAfter;
      changes.changed.push({ id, version, customized: effect.customizedAfter });
      changes.versions.push({ id, version, body: { ...bodyOf(flag), rank } as PresetBody, source: 'team' });
      changes.events.push({ id, act: 'reordered', version });
    }
    return { changes, answer: () => ({ changed: moved.length }) };
  });
}

// ------------------------------------------------------------------------------------------------
// The platform installer, as team creation and the phone's pull run it
// ------------------------------------------------------------------------------------------------

/**
 * Gives the team every platform preset it lacks and each update its copies may take
 * (installTeamPresets, design 5.2), in the caller's transaction and scope. When it wrote it is
 * audited as preset.platform_installed with its counts by kind, the person whose request ran it
 * the actor; an entry it skipped is logged by count, never by key or name, as the log's allowlist
 * holds none, and never thrown, which would fail every phone's pull. Team creation and the pull
 * both call this, so they cannot drift.
 */
export async function installPlatformPresets(
  tx: Tx,
  audit: AuditFn,
  context: { teamId: string; log: Logger; requestId: string },
): Promise<TeamPresetsInstalled> {
  const { teamId } = context;
  const installed = await installTeamPresets(tx, teamId);
  const totals = totalsOf(installed);
  if (totals.install + totals.update + totals.offer > 0)
    await audit({
      action: 'preset.platform_installed',
      entity: 'team',
      entityId: teamId,
      details: installed,
    });
  if (totals.skipped > 0)
    context.log.error('preset.platform_skipped', {
      requestId: context.requestId,
      teamId,
      count: totals.skipped,
    });
  return installed;
}
