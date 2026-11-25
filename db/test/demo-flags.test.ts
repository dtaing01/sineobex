import { fileURLToPath } from 'node:url';
import { currentFlags } from '@sineobex/presets';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The API's own rules: the seed writes its flag changes as sync applies a phone's, and these tests
// hold it to the rules sync applies and the reads the chart and the team index make, rather than to
// a second copy of them.
import { mayViewProblems, type Permission } from '../../services/api/src/auth/permissions.ts';
import type { TeamScope } from '../../services/api/src/auth/context.ts';
import { createDatabase, createSql, type Database, type Tx } from '../../services/api/src/db/database.ts';
import { loadChart } from '../../services/api/src/patients/charts.ts';
import { currentFlagsOf } from '../../services/api/src/patients/projection.ts';
import { FlagChangeCreate, valueProblem } from '../../services/api/src/sync/entities/values.ts';
import { flagHead, flagHidden } from '../../services/api/src/sync/read-rules.ts';
import { demoFlagChangeId } from '../seed/demo-flags.ts';
import { NEIGHBOUR_TEAM_ID } from '../seed/demo-patients.ts';
import { DEMO_TEAM_ID, seed } from '../seed/seed.ts';
import { migrate, setEnvironment } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';

// The demo flags of the seed (phase 5 design 13.4, card P5-seed; 9, "demo additions start Demo:"),
// written ahead of their code: each case fails until that card lands. Made-up patients and staff
// only.

interface Change {
  id: string;
  teamId: string;
  patientId: string;
  flagId: string;
  action: string;
  reason: string;
  effectiveAt: Date;
  deviceTime: Date | null;
  clockVerified: boolean;
  authorUserId: string;
  status: string;
  receivedAt: Date;
  originKey: string | null;
  kind: string;
}

const changesOf = (sql: Sql, teamId = DEMO_TEAM_ID) => sql<Change[]>`
  select f.id, f.team_id as "teamId", f.patient_id as "patientId", f.flag_id as "flagId", f.action, f.reason,
         f.effective_at as "effectiveAt", f.device_time as "deviceTime", f.clock_verified as "clockVerified",
         f.author_user_id as "authorUserId", f.status, f.received_at as "receivedAt",
         p.origin_key as "originKey", p.kind
  from sineobex.patient_flag_changes f
  join sineobex.team_presets p on p.team_id = f.team_id and p.id = f.flag_id
  where f.team_id = ${teamId} order by f.id`;

/** The author's permissions in the demo team, as their role holds them. */
async function permissionsOf(sql: Sql, userId: string): Promise<Set<Permission>> {
  const [row] = await sql<{ permissions: Permission[] }[]>`
    select r.permissions from sineobex.team_memberships m join sineobex.roles r on r.id = m.role_id
    where m.team_id = ${DEMO_TEAM_ID} and m.user_id = ${userId}`;
  return new Set(row?.permissions ?? []);
}

/**
 * [fn] inside a transaction in the demo team, as a request of [userId] runs in the API: its own
 * connection (the app role, row-level security, its column names) and its own transaction.
 */
let api: Database;
const inTeam = <T>(userId: string, fn: (tx: Tx) => Promise<T>) =>
  api.tx({ teamId: DEMO_TEAM_ID, userId }, fn);

/** The request scope the chart and the index read, for [userId] with [permissions]. */
const scopeOf = (userId: string, permissions: Set<Permission>) =>
  ({
    deps: { now: () => new Date(), config: { ID_LINK_BASE_URL: 'http://localhost:3100' } },
    principal: { userId },
    team: { teamId: DEMO_TEAM_ID, permissions },
    meta: {},
  }) as unknown as TeamScope;

/** Every row the flags wrote, as JSON, so two runs of the seed can be compared whole. */
const snapshotOf = (sql: Sql) =>
  sql`select to_jsonb(f) as row from sineobex.patient_flag_changes f order by to_jsonb(f)::text`;

describe('demo flags in the seed', () => {
  let db: ScratchDatabase;
  let afterFirst: unknown;
  let changes: Change[];

  beforeAll(async () => {
    db = await createScratchDatabase();
    const sql = createSql(db.appUrl, { max: 1 });
    api = { ...createDatabase(sql), close: () => sql.end() };
    await seed(db.owner);
    afterFirst = await snapshotOf(db.owner);
    await seed(db.owner);
    changes = await changesOf(db.owner);
  });
  afterAll(async () => {
    await api.close();
    await db.drop();
  });

  it('sets the platform’s High on one demo patient and its Frost risk on another', () => {
    expect(changes.map((c) => c.id)).toEqual([demoFlagChangeId(1), demoFlagChangeId(2)].sort());
    expect(changes.map((c) => [c.originKey, c.action, c.status]).sort()).toEqual([
      ['flag.frost_risk', 'set', 'active'],
      ['flag.high', 'set', 'active'],
    ]);
    expect(new Set(changes.map((c) => c.patientId)).size).toBe(2);
  });

  it('changes nothing when it runs again', async () => {
    expect(changes).toHaveLength(2);
    expect(await snapshotOf(db.owner)).toEqual(afterFirst);
  });

  it('puts no flag change in the neighbouring team', async () => {
    expect(changes).toHaveLength(2);
    expect(await changesOf(db.owner, NEIGHBOUR_TEAM_ID)).toEqual([]);
  });

  it('passes the entity’s own checks, as sync applies a phone’s change', async () => {
    expect(changes).toHaveLength(2);
    for (const c of changes) {
      const value = { patientId: c.patientId, flagId: c.flagId, action: c.action, reason: c.reason };
      expect(FlagChangeCreate.safeParse(value).success, c.id).toBe(true);
      expect(valueProblem('patient_flag_change', 'create', undefined, value, '2026-10-22')).toBeNull();
      // One of the team's flags (unknown_flag), and one its author holds patients.edit for and may
      // see (the entity's key and the flag rule).
      const flag = await inTeam(c.authorUserId, (tx) => flagHead(tx, DEMO_TEAM_ID, c.flagId));
      expect(flag, c.id).not.toBeNull();
      const permissions = await permissionsOf(db.owner, c.authorUserId);
      expect(permissions.has('patients.edit'), c.id).toBe(true);
      expect(flagHidden(permissions, flag)).toBe(false);
      // The change's time is the phone's own, its clock verified, never later than its receipt.
      expect(c.clockVerified).toBe(true);
      expect(c.deviceTime).toEqual(c.effectiveAt);
      expect(c.effectiveAt.getTime()).toBeLessThanOrEqual(c.receivedAt.getTime());
      expect(c.kind).toBe('flag');
    }
  });

  it('shows in each patient’s chart answer, its flags worked out by the API', async () => {
    expect(changes).toHaveLength(2);
    for (const c of changes) {
      const permissions = await permissionsOf(db.owner, c.authorUserId);
      const chart = await inTeam(c.authorUserId, (tx) =>
        loadChart(tx, scopeOf(c.authorUserId, permissions), c.patientId),
      );
      expect(chart, c.id).not.toBeNull();
      expect(chart!.flagChanges?.map((s) => s.id)).toContain(c.id);
      const shown =
        c.originKey === 'flag.high' ? chart!.flags?.primary?.flagId : chart!.flags?.secondary[0]?.flagId;
      expect(shown, c.id).toBe(c.flagId);
      expect(chart!.flags?.history.map((h) => h.changeId)).toContain(c.id);
    }
  });

  it('shows in the team index’s entry, by ID, as the index folds it', async () => {
    const author = changes[0]!.authorUserId;
    const permissions = await permissionsOf(db.owner, author);
    expect(mayViewProblems(permissions)).toBe(true);
    const flags = await inTeam(author, (tx) =>
      currentFlagsOf(
        tx,
        scopeOf(author, permissions),
        changes.map((c) => c.patientId),
      ),
    );
    for (const c of changes) {
      const entry = flags.get(c.patientId)!;
      const expected =
        c.originKey === 'flag.high'
          ? { primary: c.flagId, secondary: [] }
          : { primary: null, secondary: [c.flagId] };
      expect(entry, c.id).toEqual(expected);
      // The index's fold is the shared one.
      expect(
        currentFlags({
          changes: [
            { id: c.id, flagId: c.flagId, action: 'set', effectiveAt: c.effectiveAt, enteredInError: false },
          ],
          flags: {
            [c.flagId]: {
              tier: c.originKey === 'flag.high' ? 'primary' : 'secondary',
              rank: 10,
              name: 'Demo',
              sensitive: false,
              state: 'active',
            },
          },
          hidden: () => false,
        }),
      ).toEqual(expected);
    }
  });

  it('sets none in the preview, which has no seeded staff to have set them', async () => {
    // The test database's seed sets both (above); the preview's, none.
    expect(changes).toHaveLength(2);
    const preview = await createScratchDatabase({ migrate: false });
    try {
      await migrate(preview.owner);
      await setEnvironment(preview.owner, 'preview');
      await seed(preview.owner);
      expect(await changesOf(preview.owner)).toEqual([]);
      // The patients and the platform's flags are there all the same.
      const flags = await preview.owner<{ n: number }[]>`
        select count(*)::int as n from sineobex.team_presets
        where team_id = ${DEMO_TEAM_ID} and origin_key in ('flag.high', 'flag.frost_risk')`;
      expect(flags[0]?.n).toBe(2);
    } finally {
      await preview.drop();
    }
  });

  it('holds made-up text only, as the PHI guard reads a fixture', async () => {
    const guard = fileURLToPath(new URL('../../tools/phi-guard-rules.mjs', import.meta.url));
    const { scanFixture } = (await import(/* @vite-ignore */ guard)) as {
      scanFixture: (path: string, text: string) => string[];
    };
    expect(changes).toHaveLength(2);
    for (const c of changes) {
      expect(c.reason).toMatch(/^Demo: /);
      expect(scanFixture('db/seed/demo-flags.ts', c.reason)).toEqual([]);
    }
  });
});
