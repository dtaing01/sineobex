import { readFile } from 'node:fs/promises';
import { lockTeam, takeRevision, type InstallSql } from '@sineobex/forms';
import postgres, { type ReservedSql, type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockTeamWrites } from '../../services/api/src/sync/locks.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser, refusal } from './helpers.ts';

// takeRevision and lockTeam (phase 5 design 4.2) against 0023's team_preset_state and 0003's audit
// chain. Every preset and note type write takes its revision from takeRevision, under the team
// lock held to commit, so revisions commit in the order they are taken, one step each, with no gap:
// what a phone's pull relies on (6.1). lockTeam is the API's lockTeamWrites, which a package cannot
// import, so this file holds the two together, and both to append_audit's key. Made-up teams only.

const DENIED = '42501';

describe('the team revision', () => {
  let db: ScratchDatabase;
  let app: Sql;
  let user: string;

  /** A writer of `teamId` that has begun and not committed, as the app role in the team's scope. */
  async function openWriter(teamId: string) {
    const conn: ReservedSql = await app.reserve();
    await conn`begin`;
    await conn`set local lock_timeout = '10s'`;
    await conn`select set_config('app.team_id', ${teamId}, true), set_config('app.user_id', ${user}, true),
                      set_config('app.scope', '', true)`;
    const [row] = await conn<{ pid: number }[]>`select pg_backend_pid() as pid`;
    let open = true;
    // Ends the transaction once: a second call, as from a finally after a commit, does nothing.
    const end = async (how: 'commit' | 'rollback') => {
      if (!open) return;
      open = false;
      try {
        await (how === 'commit' ? conn`commit` : conn`rollback`);
      } finally {
        conn.release();
      }
    };
    return { conn, pid: row!.pid, commit: () => end('commit'), rollback: () => end('rollback') };
  }

  const revisionOf = async (teamId: string) => {
    const [row] = await db.owner<{ revision: string; epoch: string }[]>`
      select revision, epoch from sineobex.team_preset_state where team_id = ${teamId}`;
    return row ? { revision: Number(row.revision), epoch: row.epoch } : null;
  };
  /** Whether another session could take the team's lock now: false while someone holds it. */
  const lockFree = async (teamId: string) => {
    const [row] = await db.owner<{ free: boolean }[]>`
      select pg_try_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${teamId}::uuid::text, 0)) as free`;
    return row!.free;
  };
  const advisoryLocksOf = async (pid: number) => {
    const [row] = await db.owner<{ n: number }[]>`
      select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = ${pid}`;
    return row!.n;
  };
  /** Waits until some backend waits for an advisory lock: a writer, at the team's lock. */
  async function someoneWaitsForTheLock() {
    for (let i = 0; i < 500; i++) {
      const [row] = await db.owner<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
      if (row!.n > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('no writer waited for the team lock');
  }
  const asTeam = <T>(teamId: string, run: (tx: InstallSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: user }, (tx) => run(tx));

  beforeAll(async () => {
    db = await createScratchDatabase();
    app = postgres(db.appUrl, { max: 12, onnotice: () => {} });
    user = await makeUser(db.owner, 'revision-admin@example.com');
  });
  afterAll(async () => {
    await app.end({ timeout: 5 });
    await db.drop();
  });

  describe('the lock', () => {
    it('is append_audit’s lock on the team’s chain, and lockTeamWrites’, and nothing else', async () => {
      const team = await makeTeam(db.owner, 'Revision Lock Team');
      const other = await makeTeam(db.owner, 'Revision Lock Other Team');
      const takers: [string, (conn: ReservedSql) => Promise<unknown>][] = [
        ['lockTeam', (conn) => lockTeam(conn, team)],
        ['lockTeamWrites', (conn) => lockTeamWrites(conn as never, team)],
        [
          'append_audit',
          (conn) =>
            conn`select sineobex.append_audit(${team}, ${user}, 'program_admin', 'attending', 'demo.locked')`,
        ],
      ];
      for (const [name, take] of takers) {
        const writer = await openWriter(team);
        try {
          await take(writer.conn);
          expect(await lockFree(team), `${name} holds the team's lock`).toBe(false);
          expect(await lockFree(other), `${name} leaves another team's alone`).toBe(true);
          expect(await advisoryLocksOf(writer.pid), `${name} holds one advisory lock`).toBe(1);
        } finally {
          await writer.rollback();
        }
        expect(await lockFree(team), `${name}'s lock goes with its transaction`).toBe(true);
      }
    });

    it('is lockTeamWrites’ statement, word for word', async () => {
      const statement = /`(select pg_advisory_xact_lock\(.*?\))`/;
      const source = async (path: string) => {
        const match = statement.exec(await readFile(new URL(path, import.meta.url), 'utf8'));
        expect(match, path).not.toBeNull();
        return match![1];
      };
      const api = await source('../../services/api/src/sync/locks.ts');
      expect(await source('../../packages/forms/src/revision.ts')).toBe(api);
      expect(api).toBe(
        "select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${teamId}::uuid::text, 0))",
      );
    });

    it('takes the lock alone: no revision, and no row for a team that has none', async () => {
      const team = await makeTeam(db.owner, 'Revision Lock Only Team');
      await asTeam(team, (tx) => lockTeam(tx, team));
      expect(await revisionOf(team)).toBeNull();
    });
  });

  describe('takeRevision', () => {
    it('takes revision 1 at a team’s first write, then one more each time, under one epoch', async () => {
      const team = await makeTeam(db.owner, 'Revision First Team');
      expect(await revisionOf(team)).toBeNull();
      expect(await asTeam(team, (tx) => takeRevision(tx, team))).toBe(1);
      const first = await revisionOf(team);
      expect(first!.revision).toBe(1);
      expect(first!.epoch).toMatch(/^[0-9a-f-]{36}$/);
      expect(await asTeam(team, (tx) => takeRevision(tx, team))).toBe(2);
      expect(await asTeam(team, (tx) => takeRevision(tx, team))).toBe(3);
      expect(await revisionOf(team)).toEqual({ revision: 3, epoch: first!.epoch });
    });

    it('moves a team already at a revision one step on', async () => {
      const team = await makeTeam(db.owner, 'Revision Later Team');
      await db.owner`insert into sineobex.team_preset_state (team_id, revision) values (${team}, 41)`;
      expect(await asTeam(team, (tx) => takeRevision(tx, team))).toBe(42);
    });

    it('is the request’s own team’s only, or any team’s in platform scope', async () => {
      const team = await makeTeam(db.owner, 'Revision Scope Team');
      const other = await makeTeam(db.owner, 'Revision Scope Other Team');
      // A row the other team has not made yet, and one it has.
      expect(await refusal(asTeam(team, (tx) => takeRevision(tx, other)))).toEqual({ code: DENIED });
      await db.owner`insert into sineobex.team_preset_state (team_id, revision) values (${other}, 5)`;
      expect(await refusal(asTeam(team, (tx) => takeRevision(tx, other)))).toEqual({ code: DENIED });
      expect((await revisionOf(other))!.revision).toBe(5);
      // Team creation installs in platform scope.
      expect(await asApp(db.appUrl, { userId: user, platform: true }, (tx) => takeRevision(tx, other))).toBe(
        6,
      );
    });

    it('leaves no gap when a writer rolls back: the next writer takes the same step', async () => {
      const team = await makeTeam(db.owner, 'Revision Rollback Team');
      await asTeam(team, (tx) => takeRevision(tx, team));
      const writer = await openWriter(team);
      expect(await takeRevision(writer.conn, team)).toBe(2);
      await writer.rollback();
      expect((await revisionOf(team))!.revision).toBe(1);
      expect(await asTeam(team, (tx) => takeRevision(tx, team))).toBe(2);
    });

    it('makes a second writer wait until the first commits, then gives it the next step', async () => {
      const team = await makeTeam(db.owner, 'Revision Two Writers Team');
      await asTeam(team, (tx) => takeRevision(tx, team));
      const first = await openWriter(team);
      try {
        expect(await takeRevision(first.conn, team)).toBe(2);
        const second = asTeam(team, (tx) => takeRevision(tx, team));
        await someoneWaitsForTheLock();
        // Nothing past the first writer's step is taken, and its step is not seen, until it commits.
        expect((await revisionOf(team))!.revision).toBe(1);
        // The lock is held to commit: the first writer's later statements still hold it.
        await first.conn`select 1`;
        expect(await lockFree(team)).toBe(false);
        await first.commit();
        expect(await second).toBe(3);
      } finally {
        await first.rollback().catch(() => {});
      }
      expect((await revisionOf(team))!.revision).toBe(3);
    });

    it('under many writers at once: one step each, no gap, committed in the order taken', async () => {
      const team = await makeTeam(db.owner, 'Revision Many Writers Team');
      const start = (await asTeam(team, (tx) => takeRevision(tx, team))) as number;
      const writers = 8;
      const taken = await Promise.all(
        Array.from({ length: writers }, () =>
          asTeam(team, async (tx) => {
            const revision = await takeRevision(tx, team);
            const now = async () =>
              (
                await tx<
                  { ms: number }[]
                >`select (extract(epoch from clock_timestamp()) * 1000)::float8 as ms`
              )[0]!.ms;
            const took = await now();
            // Hold the lock a moment, as a write with an audit event and a few rows does.
            await tx`select pg_sleep(0.02)`;
            return { revision, took, done: await now() };
          }),
        ),
      );
      const byRevision = [...taken].sort((a, b) => a.revision - b.revision);
      expect(byRevision.map((t) => t.revision)).toEqual(
        Array.from({ length: writers }, (_, i) => start + 1 + i),
      );
      expect((await revisionOf(team))!.revision).toBe(start + writers);
      // Each writer took its step only after the one before it had finished its transaction.
      for (let i = 1; i < byRevision.length; i++) {
        expect(byRevision[i]!.took, `step ${byRevision[i]!.revision}`).toBeGreaterThanOrEqual(
          byRevision[i - 1]!.done,
        );
      }
    });

    it('waits for a patient-side writer holding lockTeamWrites, and for an audited write', async () => {
      const team = await makeTeam(db.owner, 'Revision Shared Lock Team');
      for (const take of [
        (conn: ReservedSql) => lockTeamWrites(conn as never, team),
        (conn: ReservedSql) =>
          conn`select sineobex.append_audit(${team}, ${user}, 'program_admin', 'attending', 'demo.audited')`,
      ]) {
        const before = (await revisionOf(team))?.revision ?? 0;
        const holder = await openWriter(team);
        try {
          await take(holder.conn);
          const writer = asTeam(team, (tx) => takeRevision(tx, team));
          await someoneWaitsForTheLock();
          expect((await revisionOf(team))?.revision ?? 0).toBe(before);
          await holder.commit();
          expect(await writer).toBe(before + 1);
        } finally {
          await holder.rollback().catch(() => {});
        }
      }
    });
  });
});
