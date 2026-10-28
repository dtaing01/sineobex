import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/auth/context.ts';
import type { Permission } from '../src/auth/permissions.ts';
import type { Tx } from '../src/db/database.ts';
import { rematchPatient, type RematchOptions, type RematchSource } from '../src/patients/duplicates.ts';
import { QUEUE_THRESHOLD } from '../src/patients/match-constants.ts';
import { lockTeamWrites } from '../src/sync/locks.ts';
import { createHarness, type Harness } from './harness.ts';
import {
  auditMark,
  createPatient,
  createTeam,
  expectAudit,
  expectAuditClean,
  logSpy,
  memberWith,
  mergeDirect,
  type Member,
  type NewPatient,
} from './patient-fixtures.ts';

// The duplicate queue (phase 3 design 8, 3.4): the server's re-run of matching, the queue and its
// side-by-side, decisions with a comment and a recent sign-in, and a merge that moves nothing,
// fills blanks, opens reviews for differences and retires no card. Everyone here is made up.

const ADMIN: Permission[] = [
  'patients.view',
  'patients.edit',
  'patients.review_duplicates',
  'patients.correct_identity',
  'patients.view_sensitive',
  'encounters.chart',
];

const spy = logSpy();
let h: Harness;
let teamId: string;
let admin: Member;

const DEL: NewPatient = {
  preferredName: 'Del',
  legalName: { given: 'Delbert', family: 'Smithfield' },
  aliases: ['Smitty'],
  birth: { precision: 'day', date: '1946-03-07' },
  visualDescriptor: 'Demo: tall, grey beard, red cap',
  usualArea: 'Demo: by the made-up Elm St underpass',
};
/** The done-when's intake: the same person, birth day and month swapped. */
const SMITTY: NewPatient = {
  preferredName: 'Smitty',
  legalName: { given: 'Del', family: null },
  birth: { precision: 'day', date: '1946-07-03' },
};
const NAMES = ['delbert', 'smithfield', 'smitty', 'kowalski', '1946-03-07'];

/** Runs the re-run as a push does: in a team transaction, team lock first, audited as `userId`. */
function rematch(patientId: string, source: RematchSource, options: RematchOptions = {}) {
  return h.db.tx({ teamId, userId: admin.userId }, async (tx: Tx) => {
    await lockTeamWrites(tx, teamId);
    const audit = async (e: AuditEvent) => {
      await tx`
        select sineobex.append_audit(${teamId}, ${admin.userId}, null, null, ${e.action}, ${e.entity ?? null},
          ${e.entityId ?? null}, ${e.patientId ?? null}, null, null, null, null, null,
          ${tx.json((e.details ?? {}) as never)})`;
    };
    return rematchPatient(tx, audit, patientId, source, options);
  });
}

interface PairRow {
  id: string;
  status: string;
  score: string;
  reasons: string[];
  sources: string[];
  creatorDismissed: boolean;
  note: string | null;
  lastFlaggedAt: Date;
}

async function pairOf(x: string, y: string): Promise<PairRow | undefined> {
  const [a, b] = [x, y].sort();
  const [row] = await h.scratch.owner<PairRow[]>`
    select id, status, score::text as score, reasons, sources, creator_dismissed as "creatorDismissed", note,
           last_flagged_at as "lastFlaggedAt"
    from sineobex.duplicate_pairs where team_id = ${teamId} and patient_a = ${a!} and patient_b = ${b!}`;
  return row;
}

async function keepSeparate(x: string, y: string): Promise<string> {
  const [a, b] = [x, y].sort();
  const [row] = await h.scratch.owner<{ id: string }[]>`
    insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, sources, status, decided_at, decided_by)
    values (${teamId}, ${a!}, ${b!}, 0.9, '{sync}', 'keep_separate', now(), ${admin.userId}) returning id`;
  return row!.id;
}

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  teamId = await createTeam(h);
  admin = await memberWith(h, teamId, ADMIN);
});

afterAll(async () => {
  spy.expectClean(NAMES);
  await h?.close();
});

describe('the re-run at sync (design 8.2)', () => {
  it('flags the done-when pair once, marks the creator’s "Not them", and audits IDs only', async () => {
    const p1 = (await createPatient(h, teamId, admin.userId, DEL)).id;
    const p2 = (await createPatient(h, teamId, admin.userId, SMITTY)).id;
    const mark = await auditMark(h);

    const first = await rematch(p2, 'sync', { shown: [p1], dismissed: [p1] });
    expect(first.flagged).toHaveLength(1);
    expect(first.flagged[0]).toMatchObject({ otherId: p1, created: true });
    expect(first.flagged[0]!.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
    // P1 was shown, so the receipt carries no possibleDuplicate.
    expect(first.possibleDuplicate).toBe(false);

    const pair = await pairOf(p1, p2);
    expect(pair).toMatchObject({ status: 'open', sources: ['sync'], creatorDismissed: true });
    expect(pair!.reasons).toEqual(expect.arrayContaining(['name', 'alias', 'dob_swapped']));
    const [flagged] = await expectAudit(h, 'duplicate.flagged', { after: mark, count: 1 });
    expect(flagged!.details).toMatchObject({ pairId: pair!.id, sources: ['sync'] });
    expect([...(flagged!.details.patientIds as string[])].sort()).toEqual([p1, p2].sort());

    // An edit later: the same pair, refreshed, its source added; no second event.
    h.clock.advance(60_000);
    const again = await rematch(p1, 'edit');
    expect(again.flagged).toEqual([
      expect.objectContaining({ pairId: pair!.id, otherId: p2, created: false }),
    ]);
    expect(again.possibleDuplicate).toBe(true);
    const refreshed = await pairOf(p1, p2);
    expect(refreshed).toMatchObject({
      id: pair!.id,
      status: 'open',
      sources: ['sync', 'edit'],
      creatorDismissed: true,
    });
    expect(refreshed!.lastFlaggedAt.getTime()).toBeGreaterThan(pair!.lastFlaggedAt.getTime());
    await expectAudit(h, 'duplicate.flagged', { after: mark, count: 1 });
    await expectAuditClean(h, NAMES, mark);
  });

  it('flags nothing, and never throws, for an unknown patient or one nobody resembles', async () => {
    expect(await rematch('00000000-0000-4000-8000-00000000dead', 'sync')).toEqual({
      flagged: [],
      possibleDuplicate: false,
    });
    const lone = (await createPatient(h, teamId, admin.userId, { preferredName: 'Quillon' })).id;
    expect(await rematch(lone, 'sync')).toEqual({ flagged: [], possibleDuplicate: false });
    const described = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: null,
        visualDescriptor: 'Demo: green coat',
      })
    ).id;
    expect(await rematch(described, 'sync')).toEqual({ flagged: [], possibleDuplicate: false });
  });

  it('keeps a not-sure pair in the queue with its note, and leaves decided pairs alone', async () => {
    const x = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Marisol',
        birth: { precision: 'year', year: 1971 },
      })
    ).id;
    const y = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Marisol',
        birth: { precision: 'year', year: 1971 },
      })
    ).id;
    await rematch(y, 'sync');
    const pair = await pairOf(x, y);
    expect(pair?.status).toBe('open');
    await h.scratch.owner`
      update sineobex.duplicate_pairs set status = 'not_sure', note = 'Demo: check the card'
      where id = ${pair!.id}`;
    await rematch(x, 'correction');
    expect(await pairOf(x, y)).toMatchObject({
      status: 'not_sure',
      note: 'Demo: check the card',
      sources: ['sync', 'correction'],
    });

    await h.scratch.owner`update sineobex.duplicate_pairs set status = 'merged' where id = ${pair!.id}`;
    const before = await pairOf(x, y);
    expect((await rematch(x, 'edit')).flagged).toEqual([]);
    expect(await pairOf(x, y)).toEqual(before);
  });

  it('never re-flags a pair kept separate, even after one side is merged into a third patient', async () => {
    const bobby = {
      preferredName: 'Bobby',
      legalName: { given: 'Robert', family: 'Kowalski' },
      birth: { precision: 'day', date: '1960-05-05' },
    } as const;
    const x = (await createPatient(h, teamId, admin.userId, bobby)).id;
    const y = (await createPatient(h, teamId, admin.userId, bobby)).id;
    const z = (await createPatient(h, teamId, admin.userId, bobby)).id;
    await keepSeparate(x, y);
    expect((await rematch(y, 'edit')).flagged.map((f) => f.otherId)).toEqual([z]);

    // y is now part of z's group: "x is not y" and "y is z" mean "x is not z".
    await mergeDirect(h, teamId, y, z, admin.userId);
    expect((await rematch(z, 'merge_rematch')).flagged.map((f) => f.otherId)).not.toContain(x);
    expect((await rematch(x, 'edit')).flagged.map((f) => f.otherId)).not.toContain(z);
    expect(await pairOf(x, z)).toBeUndefined();
  });

  it('matches a merged ID as its group, and never against its own group', async () => {
    const TAVISH: NewPatient = {
      preferredName: 'Tavish',
      aliases: ['Tav'],
      birth: { precision: 'year', year: 1988 },
    };
    const survivor = (await createPatient(h, teamId, admin.userId, TAVISH)).id;
    const merged = (await createPatient(h, teamId, admin.userId, TAVISH)).id;
    await mergeDirect(h, teamId, merged, survivor, admin.userId);
    const other = (await createPatient(h, teamId, admin.userId, TAVISH)).id;
    const result = await rematch(merged, 'edit');
    expect(result.flagged.map((f) => f.otherId)).toEqual([other]);
    expect(await pairOf(survivor, other)).toMatchObject({ status: 'open' });
  });
});
