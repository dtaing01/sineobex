/**
 * The preset installer (phase 5 design 5.2, D133): gives a team every platform preset
 * (data/platform.json, 4.6) it lacks, and each newer platform version of one it holds, as
 * platformUpdateEffect decides for both installers: install, update in place, offer, or skip. A
 * copy the team edited or archived is never overwritten (PRD main 387), nor one whose field fixed
 * at creation the new version would change: the update is offered, and only platform_latest moves.
 *
 * It runs in a transaction its caller already holds (team creation, the seed, and from P1 the
 * presets pull), so it takes that transaction and never opens one: this package imports no
 * database library, and the API is bundled for an edge runtime. The transaction's context must let
 * it write the team's rows: the team's own scope, or platform scope (0023's policy has both arms).
 * It writes no audit event: the caller audits preset.platform_installed in the same transaction.
 * packages/presets/test/install.test.ts holds the plan and the order of work, and
 * db/test/install-team-presets.test.ts holds it to migration 0023.
 */
import { lockTeam, platformUpdateEffect, takeRevision } from '@sineobex/forms';
import type { InstallSql, PlatformUpdateInput, ResolvedNoteType } from '@sineobex/forms';
import PLATFORM_FILE from '../data/platform.json' with { type: 'json' };
import { changedFixedFields } from './rules.ts';
import type { ItemBody, OrderCategoryBody, PresetBody, PresetKind } from './schemas.ts';
import { validatePreset, type PresetProblem, type PresetRef } from './validate.ts';

/** One entry of data/platform.json: its body names another entry by origin key wherever it holds an id. */
export type PlatformEntry = {
  originKey: string;
  platformVersion: number;
  kind: PresetKind;
  body: Record<string, unknown>;
};

/**
 * The platform's presets, in the order a team is given them: an entry names only entries before it.
 * One origin key may be there at several versions, numbered from 1; the newest is what a team gets
 * (packages/presets/test/platform-data.test.ts holds both).
 */
export const PLATFORM: readonly PlatformEntry[] = PLATFORM_FILE as unknown as readonly PlatformEntry[];

/** A team's preset as the installer reads it: its head, and its current version's body. */
export type HeldPreset = {
  id: string;
  kind: PresetKind;
  state: 'active' | 'archived';
  originKey: string | null;
  originVersion: number | null;
  platformLatest: number | null;
  customized: boolean;
  currentVersion: number;
  body: PresetBody;
};

/**
 * Why an entry is not written: what validatePreset refuses, the copy being of another kind, or a
 * name another of the team's active presets of the kind holds, which the database's unique name
 * would refuse.
 */
export type PlanProblem = PresetProblem | { path: 'name'; code: 'name_taken' };

export type PlanStep = { originKey: string; kind: PresetKind; platformVersion: number } & (
  | { effect: 'install'; id: string; body: PresetBody }
  | { effect: 'update'; id: string; version: number; body: PresetBody }
  | { effect: 'offer'; id: string }
  | { effect: 'skipped'; problems: PlanProblem[] }
);

/** A run's entries by effect, counted by kind; `skipped` is what the plan would not write. */
export type TeamPresetsInstalled = Record<
  'install' | 'update' | 'offer' | 'skipped',
  Partial<Record<PresetKind, number>>
>;

/**
 * For each origin key, its newest platform version, in the order the file first names the key:
 * install, update or offer as platformUpdateEffect says (a fixed field changed is read against the
 * held body), with the body's origin keys put as the team's ids: a held preset's, or the new id of
 * one installed earlier in the plan. An install or an update that validatePreset refuses against
 * the team's presets as the plan leaves them, whose name another active preset of its kind holds,
 * or whose held copy is of another kind, is `skipped` with its problems. An offer is a step only
 * while platform_latest is below the platform version, so it is made once; a skip is no step.
 * Pure: newId is called once for each install, and for nothing else.
 */
export function planTeamPresets(input: {
  held: readonly HeldPreset[];
  platform: readonly PlatformEntry[];
  /** The current definition of each of the team's active note types a map may name. */
  definitions: Readonly<Record<string, ResolvedNoteType>>;
  newId: () => string;
}): PlanStep[] {
  const copies = copiesByOrigin(input.held);
  const ids = new Map([...copies].map(([key, copy]) => [key, copy.id]));

  // The team's presets as validatePreset reads them. A category's behaviour is read before its
  // items', so an item takes the behaviour of the category it names.
  const refs: Record<string, PresetRef> = {};
  const behaviourOf = (categoryId: string) => {
    const ref = Object.hasOwn(refs, categoryId) ? refs[categoryId] : undefined;
    return ref?.kind === 'order_category' ? ref.behaviour : undefined;
  };
  const refOf = (kind: PresetKind, state: HeldPreset['state'], body: PresetBody): PresetRef => {
    const behaviour =
      kind === 'order_category'
        ? (body as OrderCategoryBody).behaviour
        : kind === 'item'
          ? behaviourOf((body as ItemBody).categoryId)
          : undefined;
    return behaviour === undefined ? { kind, state } : { kind, state, behaviour };
  };
  for (const h of input.held) if (h.kind === 'order_category') refs[h.id] = refOf(h.kind, h.state, h.body);
  for (const h of input.held) if (h.kind !== 'order_category') refs[h.id] = refOf(h.kind, h.state, h.body);

  // Every name an active preset holds, by kind, as it is now, and every name the plan gives. A name
  // a held preset leaves on an update stays taken for this run: the statements write many rows at
  // once, in no order the plan can rely on, so a name is free only once no row holds it.
  const taken = new Set(input.held.filter((h) => h.state === 'active').map((h) => nameKey(h.kind, h.body)));

  const steps: PlanStep[] = [];
  for (const entry of newestOf(input.platform)) {
    const copy = copies.get(entry.originKey);
    const step = { originKey: entry.originKey, kind: entry.kind, platformVersion: entry.platformVersion };
    // A copy keeps its kind (0023), and the data never changes one's (platform-data.test.ts): a body
    // of another kind is never written under its head.
    if (copy && copy.kind !== entry.kind) {
      steps.push({ ...step, effect: 'skipped', problems: [{ path: 'kind', code: 'wrong_kind' }] });
      continue;
    }
    const body = withIds(entry.kind, entry.body, ids) as PresetBody;
    const effect = platformUpdateEffect(
      effectInput(
        entry,
        copy,
        copy !== undefined && changedFixedFields(entry.kind, copy.body, body).length > 0,
      ),
    );
    if (effect === 'skip') continue;
    if (effect === 'offer') {
      if ((copy!.platformLatest ?? 0) < entry.platformVersion) steps.push({ ...step, effect, id: copy!.id });
      continue;
    }
    const problems: PlanProblem[] = validatePreset({
      kind: entry.kind,
      body,
      refs,
      definitions: input.definitions,
      id: copy?.id ?? null,
    });
    const name = nameKey(entry.kind, body);
    const renamed = copy === undefined || name !== nameKey(copy.kind, copy.body);
    if (problems.length === 0 && renamed && taken.has(name))
      problems.push({ path: 'name', code: 'name_taken' });
    if (problems.length > 0) {
      steps.push({ ...step, effect: 'skipped', problems });
      continue;
    }
    taken.add(name);
    if (effect === 'install') {
      const id = input.newId();
      ids.set(entry.originKey, id);
      refs[id] = refOf(entry.kind, 'active', body);
      steps.push({ ...step, effect, id, body });
    } else {
      refs[copy!.id] = refOf(entry.kind, 'active', body);
      steps.push({ ...step, effect, id: copy!.id, version: copy!.currentVersion + 1, body });
    }
  }
  return steps;
}

/**
 * Gives the team what planTeamPresets plans, in the caller's transaction, and answers its counts.
 * With nothing to write it reads and returns: no lock and no revision, so the pull of a team that is
 * up to date waits on nobody. Otherwise it takes the team lock, which every preset writer takes, and
 * works its plan out again under it: another installer at the same moment, or an admin's write, may
 * have committed since the first read, and a second plan sees it and writes nothing twice. Then one
 * revision for the run (takeRevision), stamped on every head it changes, and each install and update
 * with its version and its team_preset_events row, with no reason and no author.
 */
export async function installTeamPresets(
  sql: InstallSql,
  teamId: string,
  options: { platform?: readonly PlatformEntry[]; newId?: () => string } = {},
): Promise<TeamPresetsInstalled> {
  const platform = options.platform ?? PLATFORM;
  const newId = options.newId ?? (() => crypto.randomUUID());
  if (platform.length === 0) return countsOf([]);

  const plan = async () => {
    const held = await heldBy(sql, teamId);
    const definitions = await definitionsOf(sql, teamId, noteTypesToCheck(held, platform));
    return planTeamPresets({ held, platform, definitions, newId });
  };
  let steps = await plan();
  if (!steps.some(writes)) return countsOf(steps);
  await lockTeam(sql, teamId);
  steps = await plan();
  if (!steps.some(writes)) return countsOf(steps);
  const revision = await takeRevision(sql, teamId);
  await write(sql, teamId, revision, steps);
  return countsOf(steps);
}

/** How many entries a run's counts hold for each effect, every kind together. */
export function totalsOf(installed: TeamPresetsInstalled): Record<keyof TeamPresetsInstalled, number> {
  const total = (byKind: Partial<Record<PresetKind, number>>) =>
    Object.values(byKind).reduce((sum, n) => sum + (n ?? 0), 0);
  return {
    install: total(installed.install),
    update: total(installed.update),
    offer: total(installed.offer),
    skipped: total(installed.skipped),
  };
}

const writes = (step: PlanStep) => step.effect !== 'skipped';

function countsOf(steps: readonly PlanStep[]): TeamPresetsInstalled {
  const counts: TeamPresetsInstalled = { install: {}, update: {}, offer: {}, skipped: {} };
  for (const { effect, kind } of steps) counts[effect][kind] = (counts[effect][kind] ?? 0) + 1;
  return counts;
}

/** The newest version of each origin key, in the order the platform first names the key. */
function newestOf(platform: readonly PlatformEntry[]): PlatformEntry[] {
  const newest = new Map<string, PlatformEntry>();
  for (const entry of platform)
    if ((newest.get(entry.originKey)?.platformVersion ?? 0) < entry.platformVersion)
      newest.set(entry.originKey, entry);
  return [...newest.values()];
}

/** The team's copies of platform entries, by origin key; a team's own preset has none. */
function copiesByOrigin(held: readonly HeldPreset[]): Map<string, HeldPreset> {
  return new Map(held.flatMap((h) => (h.originKey === null ? [] : [[h.originKey, h] as const])));
}

function effectInput(
  entry: PlatformEntry,
  copy: HeldPreset | undefined,
  changesFixed: boolean,
): PlatformUpdateInput {
  return {
    exists: copy !== undefined,
    state: copy?.state ?? null,
    customized: copy?.customized ?? false,
    originVersion: copy?.originVersion ?? null,
    platformVersion: entry.platformVersion,
    changesFixed,
  };
}

/** A name as the database's unique index compares it: within its kind, ignoring case. */
const nameKey = (kind: PresetKind, body: PresetBody) => `${kind}\u0000${body.name.toLowerCase()}`;

/** The body with each origin key it holds as an id put as the team's id, where the team has one. */
function withIds(
  kind: PresetKind,
  body: Record<string, unknown>,
  ids: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const id = (value: unknown) => (typeof value === 'string' ? (ids.get(value) ?? value) : value);
  const lines = (field: string) => ({
    [field]: (body[field] as Record<string, unknown>[]).map((line) => ({ ...line, itemId: id(line.itemId) })),
  });
  switch (kind) {
    case 'item':
      return { ...body, categoryId: id(body.categoryId) };
    case 'bundle':
    case 'field_supply_map':
    case 'condition_supply_map':
      return { ...body, ...lines('lines') };
    case 'bag':
      return { ...body, ...lines('minimums') };
    case 'settings':
      return { ...body, ...lines('newBagMinimums') };
    default:
      return { ...body };
  }
}

/**
 * The note types whose definitions the plan may check a map against: those the maps it may install
 * or update name. A map the team holds at the platform's version, or whose update can only be
 * offered, stores no body, so a team that is up to date reads no definition.
 */
function noteTypesToCheck(held: readonly HeldPreset[], platform: readonly PlatformEntry[]): string[] {
  const copies = copiesByOrigin(held);
  const keys = new Set<string>();
  for (const entry of newestOf(platform)) {
    if (entry.kind !== 'field_supply_map') continue;
    // With no fixed field changed, every update stays an update: a key too many is read, never one
    // too few.
    const effect = platformUpdateEffect(effectInput(entry, copies.get(entry.originKey), false));
    if (effect === 'install' || effect === 'update') keys.add(String(entry.body.noteTypeKey));
  }
  return [...keys];
}

// Every column is read under a name with no underscore, so a caller's column-name transform (the
// API's toCamel) changes nothing the installer reads.
async function heldBy(sql: InstallSql, teamId: string): Promise<HeldPreset[]> {
  const rows = await sql<HeldPreset[]>`
    select p.id, p.kind, p.state, p.origin_key as "originKey", p.origin_version as "originVersion",
           p.platform_latest as "platformLatest", p.customized, p.current_version as "currentVersion",
           v.body
    from sineobex.team_presets p
    join sineobex.team_preset_versions v
      on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    where p.team_id = ${teamId}::uuid`;
  return [...rows];
}

/**
 * Each named note type's current definition, where the team offers it: its head's current version,
 * or, for a key a team made after 0023 holds no head for yet, its newest version. An archived note
 * type is not offered, so no map is installed on it.
 */
async function definitionsOf(
  sql: InstallSql,
  teamId: string,
  keys: readonly string[],
): Promise<Record<string, ResolvedNoteType>> {
  if (keys.length === 0) return {};
  const rows = await sql<{ key: string; definition: ResolvedNoteType }[]>`
    select v.key, v.definition
    from sineobex.note_type_versions v
    left join sineobex.note_types h on h.team_id = v.team_id and h.key = v.key
    where v.team_id = ${teamId}::uuid
      and v.key in (select jsonb_array_elements_text(${JSON.stringify(keys)}::text::jsonb))
      and coalesce(h.state, 'active') = 'active'
      and v.version = coalesce(h.current_version,
        (select max(n.version) from sineobex.note_type_versions n where n.team_id = v.team_id and n.key = v.key))`;
  return Object.fromEntries(rows.map((row) => [row.key, row.definition]));
}

/**
 * The plan's writes, one statement for each kind of row. Rows travel as one JSON text cast to jsonb,
 * as installPresets sends them. A head is written with `on conflict do nothing`, and a version and
 * an event only beside a head that is there: under the lock the plan has seen every row, so nothing
 * conflicts, and if something ever did, the entry would be left out whole, never half written.
 */
async function write(sql: InstallSql, teamId: string, revision: number, steps: readonly PlanStep[]) {
  const installs = steps.filter((s) => s.effect === 'install');
  const updates = steps.filter((s) => s.effect === 'update');
  const offers = steps.filter((s) => s.effect === 'offer');
  const rows = (list: readonly object[]) => JSON.stringify(list);

  if (installs.length > 0)
    await sql`
      insert into sineobex.team_presets
        (team_id, id, kind, name, current_version, origin_key, origin_version, platform_latest, revision)
      select ${teamId}::uuid, h.id, h.kind, h.name, 1, h.origin, h.platform, h.platform, ${revision}::bigint
      from jsonb_to_recordset(${rows(
        installs.map((s) => ({
          id: s.id,
          kind: s.kind,
          name: s.body.name,
          origin: s.originKey,
          platform: s.platformVersion,
        })),
      )}::text::jsonb) as h (id uuid, kind text, name text, origin text, platform integer)
      on conflict do nothing`;
  // An update gives the copy back to the platform's version, by nobody; an offer moves only what the
  // team is told is on offer.
  if (updates.length > 0)
    await sql`
      update sineobex.team_presets as p
      set current_version = u.version, name = u.name, origin_version = u.platform,
          platform_latest = u.platform, revision = ${revision}::bigint, updated_by = null
      from jsonb_to_recordset(${rows(
        updates.map((s) => ({
          id: s.id,
          version: s.version,
          name: s.body.name,
          platform: s.platformVersion,
        })),
      )}::text::jsonb) as u (id uuid, version integer, name text, platform integer)
      where p.team_id = ${teamId}::uuid and p.id = u.id`;
  if (offers.length > 0)
    await sql`
      update sineobex.team_presets as p
      set platform_latest = o.platform, revision = ${revision}::bigint
      from jsonb_to_recordset(${rows(
        offers.map((s) => ({ id: s.id, platform: s.platformVersion })),
      )}::text::jsonb) as o (id uuid, platform integer)
      where p.team_id = ${teamId}::uuid and p.id = o.id`;

  const made = [
    ...installs.map((s) => ({ id: s.id, version: 1, act: 'installed', body: s.body })),
    ...updates.map((s) => ({ id: s.id, version: s.version, act: 'platform_updated', body: s.body })),
  ];
  if (made.length === 0) return;
  await sql`
    insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source)
    select p.team_id, p.id, v.version, v.body, 'platform'
    from jsonb_to_recordset(${rows(made)}::text::jsonb) as v (id uuid, version integer, body jsonb)
    join sineobex.team_presets p on p.team_id = ${teamId}::uuid and p.id = v.id`;
  await sql`
    insert into sineobex.team_preset_events (team_id, preset_id, act, version)
    select p.team_id, p.id, e.act, e.version
    from jsonb_to_recordset(${rows(
      made.map(({ id, version, act }) => ({ id, version, act })),
    )}::text::jsonb) as e (id uuid, act text, version integer)
    join sineobex.team_presets p on p.team_id = ${teamId}::uuid and p.id = e.id`;
}
