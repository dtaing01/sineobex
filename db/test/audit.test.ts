import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser } from './helpers.ts';

describe('audit chain', () => {
  let db: ScratchDatabase;
  let teamA: string;
  let teamB: string;
  let user: string;

  beforeAll(async () => {
    db = await createScratchDatabase();
    teamA = await makeTeam(db.owner, 'Team A');
    teamB = await makeTeam(db.owner, 'Team B');
    user = await makeUser(db.owner, 'brooke@example.com');
  });
  afterAll(async () => {
    await db.drop();
  });

  async function append(teamId: string, action: string, details: object = {}) {
    return asApp(db.appUrl, { teamId, userId: user }, async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        select sineobex.append_audit(${teamId}, ${user}, 'program_admin', 'attending', ${action},
          'patient', 'p-1', null, null, '203.0.113.7'::inet, 'req-1', null, null, ${tx.json(details as never)}) as id`;
      return r!.id;
    });
  }

  async function verify(chain: string) {
    return asApp(db.appUrl, { teamId: chain }, async (tx) => {
      const [r] = await tx<
        { ok: boolean; checked: string; firstBadSeq: string | null; problem: string | null }[]
      >`
        select ok, checked, first_bad_seq as "firstBadSeq", problem from sineobex.verify_audit_chain(${chain})`;
      return r!;
    });
  }

  it('numbers entries per team and verifies cleanly', async () => {
    for (let i = 0; i < 5; i++) await append(teamA, 'patient.viewed', { i });
    await append(teamB, 'patient.viewed');
    const rows = await db.owner<{ seq: string; chainKey: string }[]>`
      select seq, chain_key as "chainKey" from sineobex.audit_events order by id`;
    expect(rows.filter((r) => r.chainKey === teamA).map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5]);
    expect(rows.filter((r) => r.chainKey === teamB).map((r) => Number(r.seq))).toEqual([1]);
    expect(await verify(teamA)).toMatchObject({ ok: true, checked: '5' });
  });

  it('detects an edited entry, even by the database owner', async () => {
    await db.owner.unsafe('alter table sineobex.audit_events disable trigger audit_events_append_only');
    await db.owner`update sineobex.audit_events set details = '{"i": 99}' where chain_key = ${teamA} and seq = 3`;
    await db.owner.unsafe('alter table sineobex.audit_events enable trigger audit_events_append_only');
    expect(await verify(teamA)).toMatchObject({ ok: false, firstBadSeq: '3', problem: 'hash mismatch' });
    // Put it back so later tests start from a valid chain.
    await db.owner.unsafe('alter table sineobex.audit_events disable trigger audit_events_append_only');
    await db.owner`update sineobex.audit_events set details = '{"i": 2}' where chain_key = ${teamA} and seq = 3`;
    await db.owner.unsafe('alter table sineobex.audit_events enable trigger audit_events_append_only');
    expect(await verify(teamA)).toMatchObject({ ok: true });
  });

  it('detects a deleted entry and a truncated tail', async () => {
    await db.owner.unsafe('alter table sineobex.audit_events disable trigger audit_events_append_only');
    await db.owner`delete from sineobex.audit_events where chain_key = ${teamA} and seq = 5`;
    expect(await verify(teamA)).toMatchObject({
      ok: false,
      problem: 'chain head does not match the last entry',
    });
    await db.owner`delete from sineobex.audit_events where chain_key = ${teamA} and seq = 2`;
    expect(await verify(teamA)).toMatchObject({ ok: false, firstBadSeq: '2', problem: 'missing entry' });
    await db.owner.unsafe('alter table sineobex.audit_events enable trigger audit_events_append_only');
  });

  it('blocks updates, deletes and truncation through the normal path', async () => {
    await expect(db.owner`update sineobex.audit_events set action = 'x.y'`).rejects.toThrow(/append-only/);
    await expect(db.owner`delete from sineobex.audit_events`).rejects.toThrow(/append-only/);
    await expect(db.owner`truncate sineobex.audit_events`).rejects.toThrow(/append-only/);
  });

  it('lets the application append only through append_audit, and only to its own team', async () => {
    await expect(
      asApp(
        db.appUrl,
        { teamId: teamA },
        (tx) => tx`
        insert into sineobex.audit_events (chain_key, seq, action, hash, occurred_at)
        values (${teamA}, 999, 'x.y', '\\x00', now())`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp(
        db.appUrl,
        { teamId: teamA, userId: user },
        (tx) => tx`
        select sineobex.append_audit(${teamB}, ${user}, 'r', 'c', 'patient.viewed')`,
      ),
    ).rejects.toThrow(/another team/);
    await expect(
      asApp(db.appUrl, { teamId: teamA }, (tx) => tx`select * from sineobex.verify_audit_chain(${teamB})`),
    ).rejects.toThrow(/another team/);
  });

  it('shows a team only its own entries', async () => {
    const seen = await asApp(
      db.appUrl,
      { teamId: teamB },
      (tx) => tx`select team_id from sineobex.audit_events`,
    );
    expect(seen.every((r) => r.team_id === teamB)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });
});
