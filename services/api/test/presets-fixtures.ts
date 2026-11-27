import { takeRevision, type InstallSql } from '@sineobex/forms';
import { installTeamPresets, PLATFORM, type PlatformEntry, type PresetKind } from '@sineobex/presets';
import type { TransactionSql } from 'postgres';
import { expect } from 'vitest';
import type { Permission } from '../src/auth/permissions.ts';
import type { Harness } from './harness.ts';
import { memberWith } from './patient-fixtures.ts';
import { addMember, call, type Json } from './sync-fixtures.ts';

/**
 * Shared helpers for the phase 5 preset tests of the API (design 13.4, P1-tests: presets-pull,
 * presets-routes, presets-revision, presets-audit and presets-refs; P6-server and P4-tests read
 * them too). The request and answer shapes the routes are held to are written at the top of
 * presets-routes.test.ts (the admin routes) and presets-pull.test.ts (the phone's pull). Rows are
 * read as the database's owner, so a test sees what was written whatever the policies say. Every
 * team, person and preset here is made up, each preset's name starting "Demo:".
 */

export type { Json };
export type Body = Record<string, unknown>;
export interface Answer {
  status: number;
  body: Json;
}

/** A member of a test team, by email: each call mints a token signed in at the harness clock. */
export interface Person {
  userId: string;
  email: string;
  displayName: string;
}

export interface PresetsTeam {
  teamId: string;
  /** The team's Program Admin, the one standard role that holds team.manage_presets. */
  admin: Person;
  /** A Healthcare Staff member: patients.edit and the problem list, no team.manage_presets. */
  staff: Person;
  /** The team's ID of each platform preset its creation installed, by origin key. */
  ids: Record<string, string>;
}

/** A reason of the length every write asks for (3 to 300 characters), made up. */
export const REASON = 'Demo: the team asked for this change';

/** A flag of an order, as a reorder sends it: its ID and the version the admin's list showed it at. */
export interface ListedFlag {
  id: string;
  baseVersion: number;
}

const owners = new WeakMap<Harness, string>();
let made = 0;

async function userIdOf(h: Harness, email: string): Promise<string> {
  const [row] = await h.scratch.owner<{ id: string }[]>`select id from sineobex.users where email = ${email}`;
  return row!.id;
}

/** The harness's platform owner, made the first time a team is. */
async function ownerToken(h: Harness): Promise<string> {
  let email = owners.get(h);
  if (!email) {
    email = 'presets-owner@example.com';
    await h.seedOwner(email, 'Presets Owner (demo)');
    owners.set(h, email);
  }
  return h.tokenFor(email);
}

/**
 * A team made as the owner console makes one, so it holds every platform note type and preset
 * (phase 5 design 5.2), with its Program Admin and a Healthcare Staff member, both of whom accepted
 * the acknowledgements. `label` keeps each team's people apart within one harness.
 */
export async function presetsTeam(h: Harness, label: string): Promise<PresetsTeam> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const owner = await ownerToken(h);
  const created = await call(h, '/v1/owner/teams', {
    method: 'POST',
    token: owner,
    json: { name: `Demo ${label} team` },
  });
  expect(created.status).toBe(201);
  const teamId = created.body.id as string;
  const adminEmail = `${slug}-admin@example.com`;
  const appointed = await call(h, `/v1/owner/teams/${teamId}/program-admins`, {
    method: 'POST',
    token: owner,
    json: { email: adminEmail, displayName: `${label} Admin (demo)` },
  });
  expect(appointed.status).toBe(201);
  const adminId = await userIdOf(h, adminEmail);
  await h.acknowledge(adminId);
  const admin = { userId: adminId, email: adminEmail, displayName: `${label} Admin (demo)` };
  const staffEmail = `${slug}-staff@example.com`;
  const staff = await addMember(
    h,
    { teamId, adminToken: await h.tokenFor(adminEmail) },
    staffEmail,
    `${label} Staff (demo)`,
  );
  return {
    teamId,
    admin,
    staff: { userId: staff.id, email: staffEmail, displayName: `${label} Staff (demo)` },
    ids: await platformIds(h, teamId),
  };
}

/** The team's ID of each platform preset it holds, by origin key. */
export async function platformIds(h: Harness, teamId: string): Promise<Record<string, string>> {
  const rows = await h.scratch.owner<{ originKey: string; id: string }[]>`
    select origin_key as "originKey", id from sineobex.team_presets
    where team_id = ${teamId} and origin_key is not null`;
  return Object.fromEntries(rows.map((r) => [r.originKey, r.id]));
}

/** The team's ID of a platform preset; a test that names one the team lacks is wrong. */
export function idOf(team: PresetsTeam, originKey: string): string {
  const id = team.ids[originKey];
  if (!id) throw new Error(`the team holds no copy of ${originKey}`);
  return id;
}

/** A token for `who`, signed in `minutesAgo` before the harness clock. */
export const tokenOf = (h: Harness, who: Person, minutesAgo = 0) =>
  h.tokenFor(who.email, { authTime: new Date(h.clock.now.getTime() - minutesAgo * 60_000) });

/**
 * A member of the team whose role holds exactly `permissions` (memberWith's custom role), as a
 * Person, so the routes can be called as them.
 */
export async function memberOf(
  h: Harness,
  teamId: string,
  permissions: readonly Permission[],
  label: string,
): Promise<Person> {
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++made}@example.com`;
  const displayName = `${label} (demo)`;
  const m = await memberWith(h, teamId, permissions, { email, displayName });
  return { userId: m.userId, email, displayName };
}

/** Older than the 15 minutes an admin write asks for (RECENT_AUTH_MINUTES). */
export const STALE_MINUTES = 16;

/**
 * The preset routes in a team, called as `who` with a token minted for each call, or with `token`
 * when one is given: a stale sign-in, another team's member.
 */
export function presetsApi(h: Harness, teamId: string, who: Person, options: { token?: string } = {}) {
  const send = async (method: 'GET' | 'POST' | 'PUT', path: string, json?: unknown): Promise<Answer> =>
    call(h, path, {
      method,
      token: options.token ?? (await tokenOf(h, who)),
      teamId,
      ...(json === undefined ? {} : { json }),
    });
  const at = (kind: string, id?: string, act?: string) =>
    `/v1/admin/presets/${kind}${id === undefined ? '' : `/${id}`}${act === undefined ? '' : `/${act}`}`;
  return {
    send,
    list: (kind: string) => send('GET', at(kind)),
    create: (kind: string, body: unknown, reason: unknown = REASON) =>
      send('POST', at(kind), { body, reason }),
    edit: (kind: string, id: string, baseVersion: number, body: unknown, reason: unknown = REASON) =>
      send('PUT', at(kind, id), { baseVersion, body, reason }),
    archive: (kind: string, id: string, baseVersion: number, reason: unknown = REASON) =>
      send('POST', at(kind, id, 'archive'), { baseVersion, reason }),
    restore: (kind: string, id: string, reason: unknown = REASON) =>
      send('POST', at(kind, id, 'restore'), { reason }),
    takeUpdate: async (
      kind: string,
      id: string,
      baseVersion: number,
      asNew: boolean,
      reason: unknown = REASON,
      platformVersion?: number,
      baseState?: 'active' | 'archived',
    ) =>
      send('POST', at(kind, id, 'take-update'), {
        baseVersion,
        // Unless a case names another, the person reviewed the version on offer when they send, and
        // the copy in the state it is in.
        platformVersion: platformVersion ?? (await offeredTo(h, id)),
        baseState: baseState ?? (await presetStateOf(h, id)),
        reason,
        asNew,
      }),
    history: (kind: string, id: string) => send('GET', at(kind, id, 'history')),
    /**
     * The tier's active flags by rank, each at the version the list shows it: what an admin's order
     * is made from, read as Team setup's page reads it, through the list.
     */
    flagList: async (tier: 'primary' | 'secondary'): Promise<ListedFlag[]> => {
      const r = await send('GET', at('flag'));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const rows = r.body as unknown as ListRow[];
      return rows
        .filter((row) => row.state === 'active' && row.body.tier === tier)
        .sort((x, y) => x.body.rank - y.body.rank || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
        .map((row) => ({ id: row.id, baseVersion: row.version }));
    },
    reorder: (tier: string, flags: readonly ListedFlag[], reason: unknown = REASON) =>
      send('POST', '/v1/admin/preset-order/flag', { tier, flags, reason }),
    pull: (query: { since?: number | string; epoch?: string } = {}) => {
      const q = new URLSearchParams();
      if (query.since !== undefined) q.set('since', String(query.since));
      if (query.epoch !== undefined) q.set('epoch', query.epoch);
      const s = q.toString();
      return send('GET', `/v1/presets${s === '' ? '' : `?${s}`}`);
    },
  };
}
export type PresetsApi = ReturnType<typeof presetsApi>;

/** The parts of a flag's list row an order is made from. */
interface ListRow {
  id: string;
  state: 'active' | 'archived';
  version: number;
  body: { tier: string; rank: number };
}

/**
 * The platform version on offer to a preset, as its head records it (platform_latest): what the
 * list showed a person who takes it. 1 for a preset of the team's own, or an ID that names none.
 */
async function offeredTo(h: Harness, id: string): Promise<number> {
  const [row] = await h.scratch.owner<{ latest: number | null }[]>`
    select platform_latest as latest from sineobex.team_presets where id::text = lower(${id})`;
  return row?.latest ?? 1;
}

/**
 * The state a preset is in, as its head records it: what the list showed a person who takes its
 * update. Active for an ID that names none.
 */
async function presetStateOf(h: Harness, id: string): Promise<'active' | 'archived'> {
  const [row] = await h.scratch.owner<{ state: 'active' | 'archived' }[]>`
    select state from sineobex.team_presets where id::text = lower(${id})`;
  return row?.state ?? 'active';
}

/** A preset made through the create route, which must answer 201. */
export async function createdPreset(
  api: PresetsApi,
  kind: PresetKind,
  body: Body,
  reason = REASON,
): Promise<{ id: string; version: number; revision: number }> {
  const r = await api.create(kind, body, reason);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as unknown as { id: string; version: number; revision: number };
}

/** A unique made-up name, as an admin would type it. */
export const demoName = (what: string) => `Demo: ${what} ${++made}`;

/**
 * A valid body of each kind, made of the team's platform presets, with a new name each time.
 * `labItem` is an item in Labs, which records a result; `item` one in Supplies.
 */
export function bodies(team: PresetsTeam) {
  const id = (key: string) => idOf(team, key);
  return {
    order_category: (o: Body = {}): Body => ({
      name: demoName('category'),
      behaviour: 'supply',
      sort: 50,
      ...o,
    }),
    item: (o: Body = {}): Body => ({
      name: demoName('item'),
      categoryId: id('order_category.supplies'),
      unit: 'each',
      medical: false,
      captureLot: false,
      result: null,
      ...o,
    }),
    labItem: (o: Body = {}): Body => ({
      name: demoName('lab test'),
      categoryId: id('order_category.labs'),
      unit: 'test',
      medical: true,
      captureLot: false,
      result: { type: 'number', unit: 'mg/dL' },
      ...o,
    }),
    bundle: (o: Body = {}): Body => ({
      name: demoName('bundle'),
      medical: false,
      prompt: '',
      lines: [{ itemId: id('item.gauze'), qty: 2, core: true }],
      ...o,
    }),
    flag: (o: Body = {}): Body => ({
      name: demoName('flag'),
      tier: 'secondary',
      criteria: '',
      color: 'green',
      rank: 50,
      sensitive: false,
      ...o,
    }),
    field_supply_map: (o: Body = {}): Body => ({
      name: demoName('map'),
      noteTypeKey: 'outreach',
      path: 'outreach.support',
      when: { includes: 'hygiene' },
      lines: [{ itemId: id('item.hygiene_kit'), qty: 1 }],
      ...o,
    }),
    condition_supply_map: (o: Body = {}): Body => ({
      name: demoName('condition map'),
      codes: ['L30.9'],
      lines: [{ itemId: id('item.hydrocortisone_cream'), qtyPerPatient: 1 }],
      ...o,
    }),
    bag: (o: Body = {}): Body => ({
      name: demoName('bag'),
      minimums: [{ itemId: id('item.gauze'), min: 10 }],
      ...o,
    }),
    settings: (o: Body = {}): Body => ({
      name: 'Team settings',
      bagMinimumsOn: false,
      newBagMinimums: [],
      problemCheckDays: 90,
      ...o,
    }),
  };
}

// ------------------------------------------------------------------------------------------------
// What the database holds
// ------------------------------------------------------------------------------------------------

export interface Head {
  id: string;
  teamId: string;
  kind: PresetKind;
  name: string;
  state: 'active' | 'archived';
  currentVersion: number;
  originKey: string | null;
  originVersion: number | null;
  platformLatest: number | null;
  customized: boolean;
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

const HEAD_COLUMNS = (sql: Harness['scratch']['owner']) => sql`
  id, team_id as "teamId", kind, name, state, current_version as "currentVersion",
  origin_key as "originKey", origin_version as "originVersion", platform_latest as "platformLatest",
  customized, revision::int as revision, created_by as "createdBy", updated_by as "updatedBy",
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as "updatedAt"`;

export async function headOf(h: Harness, id: string): Promise<Head | undefined> {
  const sql = h.scratch.owner;
  const [row] = await sql<Head[]>`select ${HEAD_COLUMNS(sql)} from sineobex.team_presets where id = ${id}`;
  return row;
}

/** Every head of the team, by ID. */
export async function headsOf(h: Harness, teamId: string): Promise<Head[]> {
  const sql = h.scratch.owner;
  return [
    ...(await sql<Head[]>`
      select ${HEAD_COLUMNS(sql)} from sineobex.team_presets where team_id = ${teamId} order by id`),
  ];
}

export interface VersionRow {
  version: number;
  body: Body;
  source: 'team' | 'platform';
  createdBy: string | null;
}

/** A preset's versions, oldest first. */
export async function versionsOf(h: Harness, presetId: string): Promise<VersionRow[]> {
  return [
    ...(await h.scratch.owner<VersionRow[]>`
      select version, body, source, created_by as "createdBy" from sineobex.team_preset_versions
      where preset_id = ${presetId} order by version`),
  ];
}

export interface EventRow {
  act: string;
  version: number;
  reason: string | null;
  createdBy: string | null;
}

/** A preset's events, in the order they were written. */
export async function eventsOf(h: Harness, presetId: string): Promise<EventRow[]> {
  return [
    ...(await h.scratch.owner<EventRow[]>`
      select act, version, reason, created_by as "createdBy" from sineobex.team_preset_events
      where preset_id = ${presetId} order by created_at, xmin::text::bigint`),
  ];
}

/**
 * The IDs a body names (design 4.4): an item's category, the items of a bundle's, a map's and a
 * condition map's lines, a bag's minimums and the settings' template for a new bag.
 */
export function idsNamedBy(body: Body): string[] {
  const named: string[] = [];
  if (typeof body.categoryId === 'string') named.push(body.categoryId);
  for (const field of ['lines', 'minimums', 'newBagMinimums'])
    for (const line of (body[field] as { itemId?: unknown }[] | undefined) ?? [])
      if (typeof line.itemId === 'string') named.push(line.itemId);
  return named;
}

/**
 * What points at each preset, worked out from the bodies themselves: the active presets whose
 * current body names it, counted by their kind, each preset once however many of its lines name
 * it. What a list row's referencedBy and a referenced refusal must answer.
 */
export async function referencesOf(
  h: Harness,
  teamId: string,
): Promise<Map<string, Partial<Record<PresetKind, number>>>> {
  const rows = await h.scratch.owner<{ kind: PresetKind; body: Body }[]>`
    select p.kind, v.body from sineobex.team_presets p
    join sineobex.team_preset_versions v
      on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    where p.team_id = ${teamId} and p.state = 'active'`;
  const counts = new Map<string, Partial<Record<PresetKind, number>>>();
  for (const { kind, body } of rows)
    for (const id of new Set(idsNamedBy(body))) {
      const byKind = counts.get(id) ?? {};
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      counts.set(id, byKind);
    }
  return counts;
}

/** The team's revision and epoch; null for a team that has taken no revision yet. */
export async function stateOf(
  h: Harness,
  teamId: string,
): Promise<{ revision: number; epoch: string } | null> {
  const [row] = await h.scratch.owner<{ revision: number; epoch: string }[]>`
    select revision::int as revision, epoch::text as epoch from sineobex.team_preset_state where team_id = ${teamId}`;
  return row ?? null;
}

export const revisionOf = async (h: Harness, teamId: string) => (await stateOf(h, teamId))?.revision ?? 0;

/** Everything a preset write could leave behind in the team: what a refusal must leave as it was. */
export interface Footprint {
  heads: Head[];
  versions: number;
  events: number;
  revision: number;
  /** Every event in the team's audit chain. */
  audit: number;
}

export async function footprint(h: Harness, teamId: string): Promise<Footprint> {
  const [counts] = await h.scratch.owner<{ versions: number; events: number; audit: number }[]>`
    select (select count(*)::int from sineobex.team_preset_versions where team_id = ${teamId}) as versions,
           (select count(*)::int from sineobex.team_preset_events where team_id = ${teamId}) as events,
           (select count(*)::int from sineobex.audit_events where team_id = ${teamId}) as audit`;
  return { heads: await headsOf(h, teamId), ...counts!, revision: await revisionOf(h, teamId) };
}

/** A refusal wrote nothing: no head changed, no version, no event, no audit row, the same revision. */
export async function expectNothingWritten(h: Harness, teamId: string, before: Footprint) {
  expect(await footprint(h, teamId)).toEqual(before);
}

/** The newest audit event's ID, so a test can look only at what came after. */
export async function auditMark(h: Harness): Promise<string> {
  const [row] = await h.scratch.owner<{ last: string }[]>`
    select coalesce(max(id), 0)::text as last from sineobex.audit_events`;
  return row!.last;
}

export interface AuditRow {
  id: string;
  teamId: string | null;
  action: string;
  actorUserId: string | null;
  entity: string | null;
  entityId: string | null;
  patientId: string | null;
  details: Record<string, unknown>;
  xid: string;
}

/** The audit events after `mark`, oldest first, with the transaction that wrote each. */
export async function auditAfter(h: Harness, mark: string): Promise<AuditRow[]> {
  return [
    ...(await h.scratch.owner<AuditRow[]>`
      select id::text, team_id as "teamId", action, actor_user_id as "actorUserId", entity,
             entity_id as "entityId", patient_id as "patientId", details, xmin::text as xid
      from sineobex.audit_events where id > ${mark}::bigint order by id`),
  ];
}

/** The transaction that last wrote a preset's head. */
export async function headXid(h: Harness, id: string): Promise<string> {
  const [row] = await h.scratch.owner<{ xid: string }[]>`
    select xmin::text as xid from sineobex.team_presets where id = ${id}`;
  return row!.xid;
}

/** An error answer's code and details. */
export const errorOf = (r: Answer) => r.body.error as { code: string; message: string; details?: Json };

// ------------------------------------------------------------------------------------------------
// Platform updates
// ------------------------------------------------------------------------------------------------

/**
 * The next platform version of a preset, its body changed by `change`: what a later release of
 * data/platform.json would hold. Bodies name other entries by origin key, as the file does.
 */
export function nextVersion(originKey: string, change: (body: Body) => Body): PlatformEntry {
  const newest = PLATFORM.filter((e) => e.originKey === originKey).sort(
    (a, b) => b.platformVersion - a.platformVersion,
  )[0];
  if (!newest) throw new Error(`the platform has no ${originKey}`);
  return {
    ...newest,
    platformVersion: newest.platformVersion + 1,
    body: change(structuredClone(newest.body)),
  };
}

/**
 * Puts these versions in the platform the API serves, as a release would, until the answer is
 * called. Only for a file that holds the platform as its own copy (vi.mock of the data file), so no
 * other test file sees them.
 */
export function releasePlatform(entries: readonly PlatformEntry[]): () => void {
  const platform = PLATFORM as PlatformEntry[];
  platform.push(...entries);
  return () => {
    for (const e of entries) platform.splice(platform.indexOf(e), 1);
  };
}

/** The preset installer, run for the team as a release's first pull would run it, in one transaction. */
export async function runInstaller(h: Harness, teamId: string) {
  return h.scratch.owner.begin((tx) => installTeamPresets(tx as unknown as InstallSql, teamId));
}

// ------------------------------------------------------------------------------------------------
// Writes straight to the database, as a writer that is not one of the routes under test
// ------------------------------------------------------------------------------------------------

/**
 * A write as every writer makes one (design 4.2), as the owner, straight to the database: in one
 * transaction, the team's next revision from takeRevision, then `run`, which stamps every head it
 * writes with it. For a test of a reader (the pull), so it does not lean on the admin routes.
 */
export async function asWriter<T>(
  h: Harness,
  teamId: string,
  run: (tx: TransactionSql, revision: number) => Promise<T>,
) {
  return (await h.scratch.owner.begin(async (tx) => {
    const revision = await takeRevision(tx as unknown as InstallSql, teamId);
    return run(tx, revision);
  })) as T;
}

/** A team's own preset at version 1, written straight to the database by `by` with a reason. */
export async function insertPreset(h: Harness, teamId: string, kind: string, body: Body, by: string) {
  return asWriter(h, teamId, async (tx, revision) => {
    const [head] = await tx<{ id: string }[]>`
      insert into sineobex.team_presets (team_id, kind, name, current_version, revision, created_by, updated_by)
      values (${teamId}, ${kind}, ${String(body.name)}, 1, ${revision}, ${by}, ${by}) returning id`;
    await tx`
      insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source, created_by)
      values (${teamId}, ${head!.id}, 1, ${tx.json(body as never)}, 'team', ${by})`;
    await tx`
      insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
      values (${teamId}, ${head!.id}, 'created', 1, ${REASON}, ${by})`;
    return { id: head!.id, revision };
  });
}

/** A preset's next version, written straight to the database by `by` with a reason. */
export async function editDirect(h: Harness, teamId: string, id: string, body: Body, by: string) {
  return asWriter(h, teamId, async (tx, revision) => {
    const [head] = await tx<{ version: number }[]>`
      update sineobex.team_presets
      set current_version = current_version + 1, name = ${String(body.name)}, customized = true,
          revision = ${revision}, updated_by = ${by}
      where id = ${id} returning current_version as version`;
    await tx`
      insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source, created_by)
      values (${teamId}, ${id}, ${head!.version}, ${tx.json(body as never)}, 'team', ${by})`;
    await tx`
      insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
      values (${teamId}, ${id}, 'updated', ${head!.version}, ${REASON}, ${by})`;
    return { version: head!.version, revision };
  });
}

/** A preset archived straight in the database by `by` with a reason. */
export async function archiveDirect(h: Harness, teamId: string, id: string, by: string) {
  return asWriter(h, teamId, async (tx, revision) => {
    const [head] = await tx<{ version: number }[]>`
      update sineobex.team_presets
      set state = 'archived', customized = true, revision = ${revision}, updated_by = ${by}
      where id = ${id} returning current_version as version`;
    await tx`
      insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
      values (${teamId}, ${id}, 'archived', ${head!.version}, ${REASON}, ${by})`;
    return { revision };
  });
}

// ------------------------------------------------------------------------------------------------
// The team lock
// ------------------------------------------------------------------------------------------------

/**
 * Runs `request` while another connection holds the team's write lock (lockTeamWrites' advisory
 * lock), waits until the request waits on it, and answers whether it did, the tables of the
 * sineobex schema the waiting request held a lock on by then (none, if the team lock was its
 * transaction's first statement), and its answer once the lock is let go. `meanwhile` runs in the
 * lock holder's transaction before it commits: a writer that took the lock first.
 */
export async function whileLocked<T>(
  h: Harness,
  teamId: string,
  request: () => Promise<T>,
  meanwhile?: (sql: Awaited<ReturnType<Harness['scratch']['owner']['reserve']>>) => Promise<unknown>,
): Promise<{ waited: boolean; relations: string[]; answer: T }> {
  const holder = await h.scratch.owner.reserve();
  try {
    await holder`begin`;
    await holder`set local lock_timeout = '10s'`;
    await holder`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${teamId}::uuid::text, 0))`;
    // A request that never waits settles first, and the poll stops with it.
    let settled = false;
    const answer = request().finally(() => {
      settled = true;
    });
    let waiting: { pid: number } | undefined;
    for (let i = 0; i < 500 && !waiting && !settled; i++) {
      [waiting] = await h.scratch.owner<{ pid: number }[]>`
        select pid from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
      if (!waiting) await new Promise((r) => setTimeout(r, 10));
    }
    let relations: string[] = [];
    if (waiting) {
      const held = await h.scratch.owner<{ relation: string }[]>`
        select distinct c.relname as relation from pg_locks l
        join pg_class c on c.oid = l.relation
        join pg_namespace n on n.oid = c.relnamespace
        where l.pid = ${waiting.pid} and n.nspname = 'sineobex'
        order by 1`;
      relations = held.map((r) => r.relation);
    }
    if (meanwhile) await meanwhile(holder);
    await holder`commit`;
    return { waited: waiting !== undefined, relations, answer: await answer };
  } finally {
    await holder`rollback`.catch(() => {});
    holder.release();
  }
}
