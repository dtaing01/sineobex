import { reorderRanks } from '@sineobex/presets';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { createTeam } from './patient-fixtures.ts';
import {
  bodies,
  createdPreset,
  errorOf,
  footprint,
  headOf,
  headsOf,
  idOf,
  insertPreset,
  memberOf,
  presetsApi,
  presetsTeam,
  revisionOf,
  stateOf,
  versionsOf,
  whileLocked,
  type Answer,
  type Body,
  type Head,
  type PresetsApi,
  type PresetsTeam,
} from './presets-fixtures.ts';

// The team revision and the team lock under the admin routes and the pull (phase 5 design 4.2, 6.1;
// D129, D130), written before them (cards P1-store to P1-order). takeRevision is the one way to
// take a revision, under the team lock held to commit (db/test/preset-revision.test.ts holds the
// function itself); these tests hold the routes to it:
//   - every write takes the team lock (lockTeamWrites) as its transaction's first statement, so it
//     works out what it will do under the lock, and takes its revision under it;
//   - every write takes one revision, one step above the team's, and stamps every head it touches
//     with it; a refused write takes none, so the next write takes the next step, with no gap;
//   - two writers at once take one step each, the second waiting for the first to commit, and see
//     what it wrote: two edits from one base are an edit and a stale refusal, never two versions;
//   - a pull reads its rows and its revision in one statement, so a writer that commits between
//     two of the pull's reads is never skipped: what the pull did not hold, the next pull since its
//     revision answers.
// The request and answer shapes are presets-routes.test.ts's and presets-pull.test.ts's.

let h: Harness;
let team: PresetsTeam;
let api: PresetsApi;
let make: ReturnType<typeof bodies>;

beforeAll(async () => {
  h = await createHarness();
  team = await presetsTeam(h, 'Revision');
  api = presetsApi(h, team.teamId, team.admin);
  make = bodies(team);
});
afterAll(() => h?.close());

const currentBody = async (id: string) => {
  const head = await headOf(h, id);
  return (await versionsOf(h, id)).find((v) => v.version === head!.currentVersion)!.body;
};

/** The team's active flags of a tier, by rank. */
async function activeFlags(teamId: string, tier: 'primary' | 'secondary'): Promise<string[]> {
  const rows = await h.scratch.owner<{ id: string }[]>`
    select p.id from sineobex.team_presets p
    join sineobex.team_preset_versions v on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    where p.team_id = ${teamId} and p.kind = 'flag' and p.state = 'active' and v.body ->> 'tier' = ${tier}
    order by (v.body ->> 'rank')::int, p.name`;
  return rows.map((r) => r.id);
}

/** The heads a write changed: those whose row is not as it was before. */
function changedHeads(before: readonly Head[], after: readonly Head[]): Head[] {
  const was = new Map(before.map((x) => [x.id, JSON.stringify(x)]));
  return after.filter((x) => was.get(x.id) !== JSON.stringify(x));
}

/**
 * Runs every request while another connection holds the team's write lock, waits until each of
 * them waits on it, then lets it go: the requests reach the lock together, and the database
 * decides their order.
 */
async function togetherAtTheLock<T>(
  teamId: string,
  requests: (() => Promise<T>)[],
  at: Harness = h,
): Promise<T[]> {
  const holder = await at.scratch.owner.reserve();
  try {
    await holder`begin`;
    await holder`set local lock_timeout = '10s'`;
    await holder`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${teamId}::uuid::text, 0))`;
    const answers = requests.map((r) => r());
    let waiting = 0;
    for (let i = 0; i < 500 && waiting < requests.length; i++) {
      const [row] = await at.scratch.owner<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
      waiting = row!.n;
      if (waiting < requests.length) await new Promise((r) => setTimeout(r, 10));
    }
    expect(waiting, 'every request waited for the team lock').toBe(requests.length);
    await holder`commit`;
    return await Promise.all(answers);
  } finally {
    await holder`rollback`.catch(() => {});
    holder.release();
  }
}

describe('every preset write takes the team lock first (design 4.2, 7; D32)', () => {
  /** Each write route, on presets made for it, with the answer it gives once the lock is let go. */
  async function writes(): Promise<[string, () => Promise<Answer>, number][]> {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    const gone = await createdPreset(api, 'flag', make.flag());
    expect((await api.archive('flag', gone.id, 1)).status).toBe(200);
    const doomed = await createdPreset(api, 'flag', make.flag());
    const tier = await activeFlags(team.teamId, 'primary');
    return [
      ['create', () => api.create('flag', make.flag()), 201],
      ['edit', () => api.edit('flag', id, 1, { ...body, criteria: 'Demo: edited under the lock' }), 200],
      ['archive', () => api.archive('flag', doomed.id, 1), 200],
      ['restore', () => api.restore('flag', gone.id), 200],
      // Refused once it holds the lock: what it refuses is worked out under it, too.
      ['take-update', () => api.takeUpdate('flag', idOf(team, 'flag.high'), 1, false), 409],
      ['reorder', () => api.reorder('primary', [...tier].reverse()), 200],
    ];
  }

  it('each waits for the team lock before it reads or writes any table, then does its work', async () => {
    for (const [name, write, status] of await writes()) {
      const { waited, relations, answer } = await whileLocked(h, team.teamId, write);
      expect(waited, `${name} waits for the team lock`).toBe(true);
      expect(relations, `${name} touched no table before the team lock`).toEqual([]);
      expect(answer.status, `${name}: ${JSON.stringify(answer.body)}`).toBe(status);
    }
  });

  it('two edits from one base: the second waits for the first and is refused as stale, never a second version 2', async () => {
    const body = make.bundle();
    const { id } = await createdPreset(api, 'bundle', body);
    const r0 = await revisionOf(h, team.teamId);
    const answers = await togetherAtTheLock(team.teamId, [
      () => api.edit('bundle', id, 1, { ...body, prompt: 'Demo: the first edit.' }),
      () => api.edit('bundle', id, 1, { ...body, prompt: 'Demo: the second edit.' }),
    ]);
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses, JSON.stringify(answers.map((a) => a.body))).toEqual([200, 409]);
    const loser = answers.find((a) => a.status === 409)!;
    expect(errorOf(loser).code).toBe('stale');
    expect(errorOf(loser).details?.currentVersion).toBe(2);
    expect((await versionsOf(h, id)).map((v) => v.version)).toEqual([1, 2]);
    expect(await revisionOf(h, team.teamId)).toBe(r0 + 1);
  });

  it('a create and an archive of what it points at, at once: one is taken and the other refused, never both', async () => {
    const category = await createdPreset(api, 'order_category', make.order_category());
    const answers = await togetherAtTheLock(team.teamId, [
      () => api.create('item', make.item({ categoryId: category.id })),
      () => api.archive('order_category', category.id, 1),
    ]);
    const [create, archive] = answers;
    const outcome = [create!.status, archive!.status];
    expect([
      [201, 409],
      [409, 200],
    ]).toContainEqual(outcome);
    if (create!.status === 201) expect(errorOf(archive!).code).toBe('referenced');
    else expect(errorOf(create!).code).toBe('reference_archived');
    // Whichever went first, no active item is in an archived category.
    const dangling = await h.scratch.owner<{ id: string }[]>`
      select p.id from sineobex.team_presets p
      join sineobex.team_preset_versions v on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
      join sineobex.team_presets c on c.team_id = p.team_id and c.id = (v.body ->> 'categoryId')::uuid
      where p.team_id = ${team.teamId} and p.kind = 'item' and p.state = 'active' and c.state = 'archived'`;
    expect(dangling).toEqual([]);
  });
});

describe('the team lock first, whatever isolation the database defaults to (design 4.2; D32)', () => {
  // A write decides under the team lock on what it reads there, which holds only while each of its
  // statements sees what committed before it began: read committed. A database or its role may
  // default to another level (a parameter group, say), under which the snapshot is taken at the
  // scope's first statement, before the lock, and the second of two writers acts on what it read
  // before the first committed. So every transaction begins read committed itself (db/database.ts).
  let rr: Harness;
  let rrTeam: PresetsTeam;

  beforeAll(async () => {
    rr = await createHarness();
    // Before the API's pool opens its first connection, so each one it opens takes the default.
    const login = new URL(rr.scratch.appUrl).username;
    await rr.scratch.owner.unsafe(
      `alter role ${login} in database ${rr.scratch.name} set default_transaction_isolation = 'repeatable read'`,
    );
    rrTeam = await presetsTeam(rr, 'Revision Repeatable Read');
  });
  afterAll(() => rr?.close());

  it('runs every scope transaction read committed, where the API’s role defaults to repeatable read', async () => {
    // The default took: a connection of the API's role opens a transaction at repeatable read.
    const raw = postgres(rr.scratch.appUrl, { max: 1, onnotice: () => {} });
    try {
      const [plain] = await raw.begin(
        (t) => t<{ level: string }[]>`select current_setting('transaction_isolation') as level`,
      );
      expect(plain!.level).toBe('repeatable read');
    } finally {
      await raw.end();
    }
    const [scoped] = await rr.db.tx(
      { teamId: rrTeam.teamId, userId: rrTeam.admin.userId },
      (t) => t<{ level: string }[]>`select current_setting('transaction_isolation') as level`,
    );
    expect(scoped!.level).toBe('read committed');
  });

  it('a create and an archive of what it points at, at once: still one taken and the other refused', async () => {
    const a = presetsApi(rr, rrTeam.teamId, rrTeam.admin);
    const m = bodies(rrTeam);
    const category = await createdPreset(a, 'order_category', m.order_category());
    const [create, archive] = await togetherAtTheLock(
      rrTeam.teamId,
      [
        () => a.create('item', m.item({ categoryId: category.id })),
        () => a.archive('order_category', category.id, 1),
      ],
      rr,
    );
    expect(
      [
        [201, 409],
        [409, 200],
      ],
      JSON.stringify([create!.body, archive!.body]),
    ).toContainEqual([create!.status, archive!.status]);
  });
});

describe('one revision for each write (design 4.2, 6.1)', () => {
  it('two writers at once take one step each, with no gap, each head carrying its own', async () => {
    const r0 = await revisionOf(h, team.teamId);
    const answers = await togetherAtTheLock(team.teamId, [
      () => api.create('flag', make.flag()),
      () => api.create('flag', make.flag()),
    ]);
    expect(answers.map((a) => a.status)).toEqual([201, 201]);
    const taken = answers.map((a) => a.body.revision as number).sort();
    expect(taken).toEqual([r0 + 1, r0 + 2]);
    for (const a of answers) expect((await headOf(h, a.body.id as string))!.revision).toBe(a.body.revision);
    expect(await revisionOf(h, team.teamId)).toBe(r0 + 2);
  });

  it('every write moves the revision one step and stamps each head it touches, and only those, with it', async () => {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    const gone = await createdPreset(api, 'flag', make.flag());
    const tier = await activeFlags(team.teamId, 'secondary');
    // Every flag of the tier whose rank the reversed order changes, as reorderRanks answers it.
    const ranked = await Promise.all(
      tier.map(async (id) => ({ id, rank: (await currentBody(id)).rank as number })),
    );
    const moved = reorderRanks(ranked, [...tier].reverse());
    if ('refuse' in moved) throw new Error('the tier’s own flags are refused');
    const steps: [string, () => Promise<Answer>, number][] = [
      ['create', () => api.create('bag', make.bag()), 1],
      ['edit', () => api.edit('flag', id, 1, { ...body, rank: 81 }), 1],
      ['archive', () => api.archive('flag', gone.id, 1), 1],
      ['restore', () => api.restore('flag', gone.id), 1],
      ['reorder', () => api.reorder('secondary', [...tier].reverse()), moved.length],
    ];
    for (const [name, write, touches] of steps) {
      const before = await footprint(h, team.teamId);
      const r = await write();
      expect(r.status, `${name}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
      const after = await footprint(h, team.teamId);
      expect(after.revision, name).toBe(before.revision + 1);
      const changed = changedHeads(before.heads, after.heads);
      expect(changed.length, name).toBe(touches);
      for (const head of changed) expect(head.revision, `${name} stamps ${head.id}`).toBe(after.revision);
      if (r.body.revision !== undefined) expect(r.body.revision, name).toBe(after.revision);
    }
  });

  it('a refused write takes no revision, so the next write takes the next step', async () => {
    const r0 = await revisionOf(h, team.teamId);
    const settings = idOf(team, 'settings.team');
    const head = await headOf(h, settings);
    expect((await api.archive('settings', settings, head!.currentVersion)).status).toBe(409);
    expect((await api.create('flag', make.flag({ color: 'nope' }))).status).toBe(422);
    expect(await revisionOf(h, team.teamId)).toBe(r0);
    const made = await createdPreset(api, 'flag', make.flag());
    expect(made.revision).toBe(r0 + 1);
  });

  it('a pull since any revision a write answered holds exactly what was written after it', async () => {
    const { epoch } = (await stateOf(h, team.teamId))!;
    const start = await revisionOf(h, team.teamId);
    const written: { revision: number; ids: string[] }[] = [];
    const record = async (r: Answer, ids: string[]) => {
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      written.push({ revision: await revisionOf(h, team.teamId), ids });
    };
    const body = make.flag();
    const a = await api.create('flag', body);
    await record(a, [a.body.id as string]);
    const b = await api.create('bag', make.bag());
    await record(b, [b.body.id as string]);
    await record(await api.edit('flag', a.body.id as string, 1, { ...body, rank: 82 }), [
      a.body.id as string,
    ]);
    await record(await api.archive('bag', b.body.id as string, 1), [b.body.id as string]);
    expect(written.map((w) => w.revision)).toEqual([start + 1, start + 2, start + 3, start + 4]);
    const staff = presetsApi(h, team.teamId, team.staff);
    for (let since = start; since <= start + 4; since++) {
      const r = await staff.pull({ since, epoch });
      expect(r.status).toBe(200);
      const expected = new Set(written.filter((w) => w.revision > since).flatMap((w) => w.ids));
      expect(new Set((r.body.presets as { id: string }[]).map((p) => p.id)), `since ${since}`).toEqual(
        expected,
      );
      expect(r.body.revision, `since ${since}`).toBe(expected.size === 0 ? since : start + 4);
    }
  });

  it('the installer at a pull and an admin write at once take one step each', async () => {
    // A team made with no presets: its first pull installs them, under the same lock as the write.
    const teamId = await createTeam(h, 'Demo Revision Bare Team');
    const admin = await memberOf(h, teamId, ['team.manage_presets'], 'Revision Bare Admin');
    const adminApi = presetsApi(h, teamId, admin);
    const [pulled, created] = await togetherAtTheLock(teamId, [
      () => adminApi.pull(),
      () =>
        adminApi.create('flag', {
          name: 'Demo: Raced flag',
          tier: 'secondary',
          criteria: '',
          color: 'grey',
          rank: 70,
          sensitive: false,
        }),
    ]);
    expect(pulled!.status, JSON.stringify(pulled!.body)).toBe(200);
    expect(created!.status, JSON.stringify(created!.body)).toBe(201);
    expect(await revisionOf(h, teamId)).toBe(2);
    const heads = await headsOf(h, teamId);
    const own = heads.find((x) => x.id === created!.body.id)!;
    expect(own.revision).toBe(created!.body.revision);
    const installed = heads.filter((x) => x.originKey !== null);
    expect(installed.length).toBeGreaterThan(0);
    expect(new Set(installed.map((x) => x.revision))).toEqual(new Set([own.revision === 1 ? 2 : 1]));
  });
});

describe('a pull and the writers that commit while it reads (design 6.1; D130)', () => {
  // A policy on team_presets, for this file's own database only, holds each statement of the app
  // role that reads a head at a gate of its own, once the statement has its snapshot: the n-th
  // such statement of a transaction waits on the advisory lock (4242, n), which the test holds,
  // and the test commits a writer at each gate before it lets the pull through. A pull that read
  // its rows in one statement and its revision in a later one would answer a revision above a head
  // it did not send, and the phone would never ask for that head again.
  const GATE = 4242;
  const GATES = 12;

  beforeAll(async () => {
    await h.scratch.owner.unsafe(`
      create function sineobex.test_pull_gate() returns boolean language plpgsql volatile as $$
      declare
        at text := statement_timestamp()::text;
        n int;
      begin
        if current_setting('test.gate_at', true) is distinct from at then
          n := coalesce(nullif(current_setting('test.gate_n', true), '')::int, 0) + 1;
          perform set_config('test.gate_at', at, true);
          perform set_config('test.gate_n', n::text, true);
          perform pg_advisory_xact_lock_shared(${GATE}, n);
        end if;
        return true;
      end $$;
      grant execute on function sineobex.test_pull_gate() to public`);
  });

  /** Holds every gate, runs `pull`, and commits a writer at each gate it reaches. */
  async function pullWithWritersAtEachGate(pull: () => Promise<Answer>, write: () => Promise<string>) {
    const gate = await h.scratch.owner.reserve();
    const written: string[] = [];
    try {
      for (let n = 1; n <= GATES; n++) await gate`select pg_advisory_lock(${GATE}, ${n})`;
      await h.scratch.owner.unsafe(`
        create policy test_pull_gate on sineobex.team_presets as restrictive for select
          using (sineobex.test_pull_gate())`);
      let settled = false;
      const answer = pull().finally(() => {
        settled = true;
      });
      for (let n = 1; n <= GATES && !settled; n++) {
        let waiting = false;
        for (let i = 0; i < 500 && !waiting && !settled; i++) {
          const rows = await h.scratch.owner`
            select 1 from pg_locks
            where locktype = 'advisory' and not granted and classid = ${GATE} and objid = ${n}`;
          waiting = rows.length > 0;
          if (!waiting && !settled) await new Promise((r) => setTimeout(r, 10));
        }
        if (!waiting) break;
        written.push(await write());
        await gate`select pg_advisory_unlock(${GATE}, ${n})`;
      }
      await gate`select pg_advisory_unlock_all()`;
      return { answer: await answer, written };
    } finally {
      await h.scratch.owner.unsafe(`drop policy if exists test_pull_gate on sineobex.team_presets`);
      await gate`select pg_advisory_unlock_all()`.catch(() => {});
      gate.release();
    }
  }

  it('never skips a writer that commits between two of its reads: the next pull since its revision holds it', async () => {
    const { epoch } = (await stateOf(h, team.teamId))!;
    const since = await revisionOf(h, team.teamId);
    const staff = presetsApi(h, team.teamId, team.staff);
    let n = 0;
    const { answer, written } = await pullWithWritersAtEachGate(
      () => staff.pull({ since, epoch }),
      async () =>
        (
          await insertPreset(
            h,
            team.teamId,
            'flag',
            {
              name: `Demo: written mid-pull ${++n}`,
              tier: 'secondary',
              criteria: '',
              color: 'grey',
              rank: 90 + n,
              sensitive: false,
            } as Body,
            team.admin.userId,
          )
        ).id,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    // The pull read the heads at least twice: the installer's plan, then its own read.
    expect(written.length).toBeGreaterThanOrEqual(2);
    const first = answer.body as { revision: number; presets: { id: string }[] };
    // What it answers is consistent: its revision is the greatest of the heads it holds.
    const heldRevisions = await Promise.all(
      first.presets.map(async (p) => (await headOf(h, p.id))!.revision),
    );
    expect(first.revision).toBe(heldRevisions.length === 0 ? since : Math.max(...heldRevisions));
    const next = await staff.pull({ since: first.revision, epoch });
    expect(next.status).toBe(200);
    const seen = new Set([...first.presets, ...(next.body.presets as { id: string }[])].map((p) => p.id));
    for (const id of written)
      expect(seen.has(id), `the head written mid-pull (${id}) reaches the phone`).toBe(true);
  });
});
