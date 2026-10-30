import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/auth/context.ts';
import type { Permission } from '../src/auth/permissions.ts';
import type { Tx } from '../src/db/database.ts';
import { rematchPatient, type RematchOptions, type RematchSource } from '../src/patients/duplicates.ts';
import { idLinkTokenHash, newIdLinkToken } from '../src/patients/id-links.ts';
import { QUEUE_THRESHOLD } from '../src/patients/match-constants.ts';
import type {
  DuplicateDecisionResultValue,
  DuplicatePageValue,
  DuplicatePairDetailValue,
  DuplicatePairSummaryValue,
  PatientChartValue,
} from '../src/patients/schemas.ts';
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
import type { Json } from './sync-fixtures.ts';

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
/** The same shape of pair, for the queue's tests, so no earlier test's patients join it. */
const IGNATIUS: NewPatient = {
  preferredName: 'Ignatius',
  legalName: { given: 'Ignatius', family: 'Demoworth' },
  aliases: ['Iggy'],
  birth: { precision: 'day', date: '1958-02-09' },
};
const IGGY: NewPatient = {
  preferredName: 'Iggy',
  legalName: { given: 'Ignatius', family: null },
  birth: { precision: 'day', date: '1958-09-02' },
};
const NAMES = [
  'delbert',
  'smithfield',
  'smitty',
  'kowalski',
  '1946-03-07',
  'demoworth',
  'iggy',
  '1958-02-09',
];

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

async function emailOf(userId: string): Promise<string> {
  const [user] = await h.scratch.owner<
    { email: string }[]
  >`select email from sineobex.users where id = ${userId}`;
  return user!.email;
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

// ------------------------------------------------------------------------------------------------
// The queue, the pair page and decisions, through the routes
// ------------------------------------------------------------------------------------------------

const CLINICIAN: Permission[] = ['patients.view', 'patients.edit', 'encounters.chart'];

const get = (path: string, token = admin.token) => h.request(path, { token, teamId });
const post = (path: string, json: unknown, token = admin.token) =>
  h.request(path, { method: 'POST', token, teamId, json });

/** An open pair as the re-run leaves it, at a fixed score. */
async function openPair(x: string, y: string, reasons: string[] = ['name']): Promise<string> {
  const [a, b] = [x, y].sort();
  const [row] = await h.scratch.owner<{ id: string }[]>`
    insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, reasons, sources)
    values (${teamId}, ${a!}, ${b!}, 0.85, ${reasons}, '{sync}') returning id`;
  return row!.id;
}

async function versions(pairId: string): Promise<{ a: number; b: number }> {
  const res = await get(`/v1/team/duplicates/${pairId}`);
  const body = (await res.json()) as DuplicatePairDetailValue;
  return { a: body.a.version, b: body.b.version };
}

const decide = async (pairId: string, body: Record<string, unknown>, token = admin.token) =>
  post(`/v1/team/duplicates/${pairId}/decision`, { versions: await versions(pairId), ...body }, token);

interface PatientState {
  status: string;
  canonicalId: string;
  version: number;
  preferredName: string | null;
  legalGivenName: string | null;
  legalFamilyName: string | null;
  birthPrecision: string | null;
  birthDate: string | null;
  birthYear: number | null;
  livingSituation: string | null;
  allergyScreen: string;
  fieldVersions: Record<string, number>;
}

async function patient(id: string): Promise<PatientState> {
  const [row] = await h.scratch.owner<PatientState[]>`
    select status, canonical_id as "canonicalId", version, preferred_name as "preferredName",
      legal_given_name as "legalGivenName", legal_family_name as "legalFamilyName",
      birth_precision as "birthPrecision", to_char(birth_date, 'YYYY-MM-DD') as "birthDate",
      birth_year as "birthYear", living_situation as "livingSituation", allergy_screen as "allergyScreen",
      field_versions as "fieldVersions"
    from sineobex.patients where id = ${id}`;
  return row!;
}

async function reviewsOn(id: string): Promise<{ field: string; needs: string; mergeId: string | null }[]> {
  return h.scratch.owner`
    select field, needs, merge_id as "mergeId" from sineobex.field_reviews
    where record_id = ${id} and status = 'open' order by field`;
}

async function issueLink(patientId: string): Promise<string> {
  const id = randomUUID();
  const token = newIdLinkToken();
  await h.scratch.owner`
    insert into sineobex.patient_id_links (id, team_id, patient_id, token, token_hash, status, reason, effective_at,
      clock_verified, made_offline, issued_by)
    values (${id}, ${teamId}, ${patientId}, ${token}, ${await idLinkTokenHash(token)}, 'active', 'first_card', now(),
      true, false, ${admin.userId})`;
  return id;
}

describe('the queue and the pair page (design 8.3, 3.4)', () => {
  let p1: string;
  let p2: string;
  let pairId: string;
  let clinician: Member;

  beforeAll(async () => {
    clinician = await memberWith(h, teamId, CLINICIAN);
    p1 = (await createPatient(h, teamId, admin.userId, IGNATIUS)).id;
    p2 = (await createPatient(h, teamId, admin.userId, IGGY)).id;
    await rematch(p2, 'sync', { shown: [p1], dismissed: [p1] });
    pairId = (await pairOf(p1, p2))!.id;
  });

  it('lists open pairs oldest first with both summaries, and audits the patients it showed', async () => {
    const mark = await auditMark(h);
    const res = await get('/v1/team/duplicates');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const page = (await res.json()) as DuplicatePageValue;
    const listed = page.pairs.find((p) => p.id === pairId)!;
    expect(listed).toMatchObject({
      status: 'open',
      band: 'likely',
      creatorDismissed: true,
      sources: ['sync'],
    });
    expect(listed.reasons).toContain('dob_swapped');
    expect(listed.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
    const sides = { [listed.a.patientId]: listed.a.summary, [listed.b.patientId]: listed.b.summary };
    expect(sides[p1]).toMatchObject({ preferredName: 'Ignatius', aliases: ['Iggy'], duplicateHint: true });
    expect(sides[p2]).toMatchObject({ preferredName: 'Iggy' });
    const flagged = page.pairs.map((p) => p.lastFlaggedAt);
    expect(flagged).toEqual([...flagged].sort());

    const [viewed] = await expectAudit(h, 'duplicates.viewed', { after: mark, count: 1 });
    expect(viewed!.details).toMatchObject({ status: 'open', count: page.pairs.length });
    expect(viewed!.details.patientIds).toEqual(expect.arrayContaining([p1, p2]));
    await expectAuditClean(h, NAMES, mark);
  });

  it('refuses the queue, the pair page and decisions without patients.review_duplicates, and logs it', async () => {
    const mark = await auditMark(h);
    expect((await get('/v1/team/duplicates', clinician.token)).status).toBe(403);
    expect((await get(`/v1/team/duplicates/${pairId}`, clinician.token)).status).toBe(403);
    const res = await post(
      `/v1/team/duplicates/${pairId}/decision`,
      { decision: 'keep_separate', comment: 'Different people', versions: { a: 1, b: 1 } },
      clinician.token,
    );
    expect(res.status).toBe(403);
    await expectAudit(h, 'access.denied', { after: mark, count: 3 });
  });

  it('shows both records side by side with Same or Differs, and audits one view per patient', async () => {
    const mark = await auditMark(h);
    const res = await get(`/v1/team/duplicates/${pairId}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as DuplicatePairDetailValue;
    const bySide = { [detail.pair.a.patientId]: detail.a, [detail.pair.b.patientId]: detail.b };
    expect(bySide[p1]!.chart.canonicalId).toBe(p1);
    expect(bySide[p1]!.chart.patient.fields.preferredName!.value).toBe('Ignatius');
    expect(bySide[p2]!.chart.aliases).toEqual([]);
    expect(bySide[p1]).toMatchObject({
      version: 1,
      recentEncounters: [],
      photoId: null,
      createdHow: 'unknown',
    });
    expect(bySide[p1]!.createdBy.userId).toBe(admin.userId);
    const compared = Object.fromEntries(detail.compared.map((c) => [c.field, c.same]));
    expect(compared).toMatchObject({
      preferredName: false,
      birth: false,
      allergyScreen: true,
      idCardChoice: true,
    });
    expect(detail.decisions).toEqual([]);

    const views = await expectAudit(h, 'duplicate.pair_viewed', { after: mark, count: 2 });
    expect(views.map((v) => v.patientId).sort()).toEqual([p1, p2].sort());
    for (const v of views) expect(v.details).toEqual({ pairId });
    expect((await get(`/v1/team/duplicates/${randomUUID()}`)).status).toBe(404);
  });

  it('refuses a decision without a comment, or without a recent sign-in', async () => {
    const v = await versions(pairId);
    for (const comment of [undefined, '', '  a ']) {
      const res = await post(`/v1/team/duplicates/${pairId}/decision`, {
        decision: 'keep_separate',
        comment,
        versions: v,
      });
      expect(res.status).toBe(422);
    }
    const stale = await h.tokenFor(await emailOf(admin.userId), {
      authTime: new Date(h.clock.now.getTime() - 20 * 60_000),
    });
    const res = await post(
      `/v1/team/duplicates/${pairId}/decision`,
      { decision: 'keep_separate', comment: 'Different people', versions: v },
      stale,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as Json).error?.code).toBe('reauth_required');
    expect((await pairOf(p1, p2))!.status).toBe('open');
  });

  it('answers 409 pair_changed with versions only when either record changed since it was loaded', async () => {
    const seen = await versions(pairId);
    await h.scratch.owner`update sineobex.patients set version = version + 1 where id = ${p2}`;
    const mark = await auditMark(h);
    const res = await post(`/v1/team/duplicates/${pairId}/decision`, {
      decision: 'keep_separate',
      comment: 'Different people',
      versions: seen,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Json;
    expect(body.error!.code).toBe('pair_changed');
    const [pa, pb] = [p1, p2].sort();
    expect(body.error!.details).toEqual({
      versions: { a: pa === p1 ? 1 : 2, b: pb === p1 ? 1 : 2 },
    });
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/ignatius|iggy|1958/);
    await expectAudit(h, 'duplicate.decided', { after: mark, count: 0 });
  });

  it('keeps a Not sure pair in the queue with its note, shown on both charts', async () => {
    const mark = await auditMark(h);
    const res = await decide(pairId, {
      decision: 'not_sure',
      comment: 'Could not tell from the charts',
      fieldNote: 'Check the ID card at the next visit',
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as DuplicateDecisionResultValue;
    expect(result.merge).toBeNull();
    expect(result.pair).toMatchObject({
      status: 'not_sure',
      note: 'Check the ID card at the next visit',
      decidedAt: null,
    });

    const decided = await expectAudit(h, 'duplicate.decided', { after: mark, count: 2 });
    expect(decided.map((d) => d.patientId).sort()).toEqual([p1, p2].sort());
    expect(decided[0]!.details).toMatchObject({ pairId, decision: 'not_sure' });
    expect(decided[0]!.details.commentSha256).toMatch(/^[0-9a-f]{64}$/);
    await expectAuditClean(h, ['could not tell', 'check the id card'], mark);

    for (const status of ['open', 'not_sure']) {
      const page = (await (await get(`/v1/team/duplicates?status=${status}`)).json()) as DuplicatePageValue;
      expect(page.pairs.map((p) => p.id)).toContain(pairId);
    }
    for (const id of [p1, p2]) {
      const chart = (await (await get(`/v1/patients/${id}`)).json()) as PatientChartValue;
      expect(chart.duplicate).toEqual({ status: 'not_sure', note: 'Check the ID card at the next visit' });
    }

    // Not sure again, without a note: the pair stays, its note with it, both decisions on the page.
    expect((await decide(pairId, { decision: 'not_sure', comment: 'Still unsure' })).status).toBe(200);
    expect((await pairOf(p1, p2))!.note).toBe('Check the ID card at the next visit');
    const detail = (await (await get(`/v1/team/duplicates/${pairId}`)).json()) as DuplicatePairDetailValue;
    expect(detail.decisions.map((d) => [d.decision, d.comment])).toEqual([
      ['not_sure', 'Could not tell from the charts'],
      ['not_sure', 'Still unsure'],
    ]);
  });

  it('keeps a pair separate for good: decided, listed as decided, and refused a second decision', async () => {
    const res = await decide(pairId, { decision: 'keep_separate', comment: 'Different people, met both' });
    expect(res.status).toBe(200);
    const result = (await res.json()) as DuplicateDecisionResultValue;
    expect(result.pair.status).toBe('keep_separate');
    expect(result.pair.decidedAt).not.toBeNull();
    const open = (await (await get('/v1/team/duplicates')).json()) as DuplicatePageValue;
    expect(open.pairs.map((p) => p.id)).not.toContain(pairId);
    const decided = (await (await get('/v1/team/duplicates?status=decided')).json()) as DuplicatePageValue;
    expect(decided.pairs.map((p) => p.id)).toContain(pairId);

    const again = await decide(pairId, { decision: 'not_sure', comment: 'Changed my mind' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as Json).error!.code).toBe('already_decided');
    expect((await rematch(p2, 'edit')).flagged).toEqual([]);
  });

  it('lets staff flag two charts they know are one person, without merging anything', async () => {
    const x = (await createPatient(h, teamId, admin.userId, { preferredName: 'Ozzie', aliases: ['Oz'] })).id;
    const y = (await createPatient(h, teamId, admin.userId, { preferredName: 'Oswald' })).id;
    const mark = await auditMark(h);
    const res = await post(
      '/v1/team/duplicates',
      { patientA: x, patientB: y, comment: 'Same man, he told me' },
      clinician.token,
    );
    expect(res.status).toBe(200);
    const pair = (await res.json()) as DuplicatePairSummaryValue;
    expect(pair).toMatchObject({ status: 'open', sources: ['staff_report'] });
    expect((await patient(x)).status).toBe('active');
    const [flagged] = await expectAudit(h, 'duplicate.flagged', { after: mark, count: 1 });
    expect(flagged!.details).toMatchObject({ pairId: pair.id, sources: ['staff_report'] });
    expect([...(flagged!.details.patientIds as string[])].sort()).toEqual([x, y].sort());
    await expectAuditClean(h, ['he told me', 'ozzie', 'oswald'], mark);

    // A pair kept separate is a reviewer's to re-open, not a flag's.
    expect(
      (
        await post(
          '/v1/team/duplicates',
          { patientA: p1, patientB: p2, comment: 'Same man again' },
          clinician.token,
        )
      ).status,
    ).toBe(409);
    expect(
      (await post('/v1/team/duplicates', { patientA: x, patientB: x, comment: 'Same man' })).status,
    ).toBe(422);
    const billing = await memberWith(h, teamId, ['patients.view']);
    expect(
      (await post('/v1/team/duplicates', { patientA: x, patientB: y, comment: 'Same' }, billing.token))
        .status,
    ).toBe(403);
  });
});

describe('merge (design 8.4)', () => {
  it('fills blanks, opens reviews for differences, clears "none known", retires no card, supersedes pairs', async () => {
    const survivor = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Gus',
        legalName: { given: 'Augustus', family: null },
        birth: { precision: 'estimated', year: 1950 },
        usualArea: 'Demo: by the pier',
        allergyScreen: 'none_known',
      })
    ).id;
    const merged = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Gussie',
        legalName: { given: 'Augustus', family: 'Demopell' },
        birth: { precision: 'day', date: '1952-04-01' },
        usualArea: 'Demo: by the library',
        livingSituation: { kind: 'vehicle' },
        idCardChoice: 'wants',
        allergies: [{ substance: 'latex', category: 'environment', severity: 'moderate' }],
      })
    ).id;
    const third = (await createPatient(h, teamId, admin.userId, { preferredName: 'Augie' })).id;
    const survivorLink = await issueLink(survivor);
    const mergedLink = await issueLink(merged);
    const pairId = await openPair(survivor, merged);
    const otherPair = await openPair(merged, third);
    const mark = await auditMark(h);

    const res = await decide(pairId, {
      decision: 'merge',
      survivorId: survivor,
      comment: 'Same man, ID card checked',
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as DuplicateDecisionResultValue;
    expect(result.pair.status).toBe('merged');
    expect(result.merge).toMatchObject({
      pairId,
      survivor: { patientId: survivor },
      merged: { patientId: merged, summary: { preferredName: 'Gussie' } },
      comment: 'Same man, ID card checked',
      undone: null,
      undoable: true,
    });

    // Moves nothing: the merged row points at the survivor, its allergy stays where it was stored.
    expect(await patient(merged)).toMatchObject({ status: 'merged', canonicalId: survivor });
    const [allergy] = await h.scratch.owner<{ patientId: string }[]>`
      select patient_id as "patientId" from sineobex.patient_allergies where patient_id = ${merged}`;
    expect(allergy!.patientId).toBe(merged);

    // Blanks filled (the estimate within range), "none known" cleared by the merged record's allergy.
    const s = await patient(survivor);
    expect(s).toMatchObject({
      preferredName: 'Gus',
      legalGivenName: 'Augustus',
      legalFamilyName: 'Demopell',
      birthPrecision: 'day',
      birthDate: '1952-04-01',
      livingSituation: 'vehicle',
      allergyScreen: 'not_asked',
    });
    const [m] = await h.scratch.owner<
      { id: string; filledFields: Record<string, number>; reviewsOpened: string[] }[]
    >`
      select id, filled_fields as "filledFields", reviews_opened as "reviewsOpened"
      from sineobex.patient_merges where pair_id = ${pairId}`;
    expect(m!.filledFields).toEqual({
      legalName: 2,
      birth: 2,
      livingSituation: 2,
      allergyScreen: 2,
      idCardChoice: 2,
    });
    const kinds = await h.scratch.owner<{ field: string; kind: string; approvedBy: string | null }[]>`
      select field, kind, approved_by as "approvedBy" from sineobex.field_history
      where record_id = ${survivor} and version = 2 order by field`;
    expect(kinds.find((k) => k.field === 'allergyScreen')!.kind).toBe('cleared_by_allergy');
    expect(kinds.find((k) => k.field === 'birth')).toMatchObject({
      kind: 'merge_fill',
      approvedBy: admin.userId,
    });

    // Differences: a review each, the merged value the alternate; nothing overwritten.
    expect(await reviewsOn(survivor)).toEqual([
      { field: 'preferredName', needs: 'patients.edit', mergeId: m!.id },
      { field: 'usualArea', needs: 'patients.edit', mergeId: m!.id },
    ]);
    expect(m!.reviewsOpened).toHaveLength(2);
    const alternates = await h.scratch.owner<{ field: string; value: unknown }[]>`
      select field, value from sineobex.field_history
      where record_id = ${survivor} and kind = 'kept_both' order by field`;
    expect(alternates).toEqual([
      { field: 'preferredName', value: 'Gussie' },
      { field: 'usualArea', value: 'Demo: by the library' },
    ]);

    // No card retired (D39): both stay active and both open the survivor's chart.
    const links = await h.scratch.owner<{ id: string; status: string }[]>`
      select id, status from sineobex.patient_id_links where id in (${survivorLink}, ${mergedLink})`;
    expect(links.map((l) => l.status)).toEqual(['active', 'active']);

    // The other pair naming the merged record is settled, restorably.
    const [other] = await h.scratch.owner<{ status: string; before: string; by: string }[]>`
      select status, status_before_superseded as before, superseded_by_merge as by
      from sineobex.duplicate_pairs where id = ${otherPair}`;
    expect(other).toEqual({ status: 'superseded', before: 'open', by: m!.id });

    const merges = await expectAudit(h, 'patient.merged', { after: mark, count: 2 });
    expect(merges.map((e) => e.patientId).sort()).toEqual([survivor, merged].sort());
    expect(merges[0]!.details).toEqual({ mergeId: m!.id, survivorId: survivor, mergedId: merged });
    await expectAudit(h, 'duplicate.decided', { after: mark, count: 2 });
    await expectAuditClean(h, ['gus', 'augustus', 'demopell', 'id card checked', '1952'], mark);
  });

  it('opens an identity review for an estimate refined outside its range, and fills nothing there', async () => {
    const survivor = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Wendell',
        birth: { precision: 'estimated', year: 1950 },
      })
    ).id;
    const merged = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Wendell',
        birth: { precision: 'day', date: '1960-02-02' },
      })
    ).id;
    const pairId = await openPair(survivor, merged);
    expect(
      (await decide(pairId, { decision: 'merge', survivorId: survivor, comment: 'Same person' })).status,
    ).toBe(200);
    expect(await patient(survivor)).toMatchObject({ birthPrecision: 'estimated', birthYear: 1950 });
    expect(await reviewsOn(survivor)).toEqual([
      expect.objectContaining({ field: 'birth', needs: 'patients.correct_identity' }),
    ]);
  });

  it('merges only the pair’s own records, and only while both are canonical', async () => {
    const x = (await createPatient(h, teamId, admin.userId, { preferredName: 'Lorcan' })).id;
    const y = (await createPatient(h, teamId, admin.userId, { preferredName: 'Lorcan' })).id;
    const z = (await createPatient(h, teamId, admin.userId, { preferredName: 'Lorcan' })).id;
    const pairId = await openPair(x, y);
    const wrong = await decide(pairId, { decision: 'merge', survivorId: z, comment: 'Same person' });
    expect(wrong.status).toBe(422);
    const seen = await versions(pairId);
    await mergeDirect(h, teamId, y, z, admin.userId);
    const res = await post(`/v1/team/duplicates/${pairId}/decision`, {
      decision: 'merge',
      survivorId: x,
      comment: 'Same person',
      versions: seen,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error!.code).toBe('pair_changed');
  });

  it('locks patient rows FOR NO KEY UPDATE, so a push holding FOR KEY SHARE never blocks it', async () => {
    const survivor = (await createPatient(h, teamId, admin.userId, { preferredName: 'Thaddeus' })).id;
    const merged = (await createPatient(h, teamId, admin.userId, { preferredName: 'Thaddeus' })).id;
    const pairId = await openPair(survivor, merged);
    const body = {
      decision: 'merge',
      survivorId: survivor,
      comment: 'Same person',
      versions: await versions(pairId),
    };
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    // What an encounter or allergy insert's foreign key check holds on both patients.
    const push = h.scratch.owner.begin(async (sql) => {
      await sql`select id from sineobex.patients where id in (${survivor}, ${merged}) for key share`;
      locked();
      await released;
    });
    await holding;
    const timeout = new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 5_000));
    const outcome = await Promise.race([post(`/v1/team/duplicates/${pairId}/decision`, body), timeout]);
    release();
    await push;
    expect(outcome).not.toBe('blocked');
    expect((outcome as Response).status).toBe(200);
  });

  it('re-matches the survivor after a merge, its group against everyone else', async () => {
    const survivor = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Benedikt',
        birth: { precision: 'year', year: 1979 },
      })
    ).id;
    const merged = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Benedikt',
        aliases: ['Bennie'],
        birth: { precision: 'year', year: 1979 },
      })
    ).id;
    const pairId = await openPair(survivor, merged);
    const outside = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Bennie',
        birth: { precision: 'year', year: 1979 },
      })
    ).id;
    expect(
      (await decide(pairId, { decision: 'merge', survivorId: survivor, comment: 'Same person' })).status,
    ).toBe(200);
    expect(await pairOf(survivor, outside)).toMatchObject({ status: 'open', sources: ['merge_rematch'] });
  });

  it('carries a settled pair’s Not sure note and "Not them" to the survivor’s new pair', async () => {
    const PERCIVAL: NewPatient = { preferredName: 'Percival', birth: { precision: 'year', year: 1969 } };
    const survivor = (await createPatient(h, teamId, admin.userId, PERCIVAL)).id;
    const merged = (await createPatient(h, teamId, admin.userId, PERCIVAL)).id;
    const other = (await createPatient(h, teamId, admin.userId, PERCIVAL)).id;
    const pairId = await openPair(survivor, merged);
    const [a, b] = [merged, other].sort();
    await h.scratch.owner`
      insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, reasons, sources, status, note,
        creator_dismissed)
      values (${teamId}, ${a!}, ${b!}, 0.8, '{name}', '{sync}', 'not_sure', 'Ask about the tattoo', true)`;
    expect(
      (await decide(pairId, { decision: 'merge', survivorId: survivor, comment: 'Same person' })).status,
    ).toBe(200);
    expect(await pairOf(merged, other)).toMatchObject({ status: 'superseded' });
    expect(await pairOf(survivor, other)).toMatchObject({
      status: 'open',
      note: 'Ask about the tattoo',
      creatorDismissed: true,
      sources: ['merge_rematch'],
    });
  });

  it('changes nothing, and shows nothing, when the merge or the queue can’t be logged', async () => {
    const survivor = (await createPatient(h, teamId, admin.userId, { preferredName: 'Hyacinth' })).id;
    const merged = (await createPatient(h, teamId, admin.userId, { preferredName: 'Hyacinth' })).id;
    const pairId = await openPair(survivor, merged);
    const body = {
      decision: 'merge',
      survivorId: survivor,
      comment: 'Same person',
      versions: await versions(pairId),
    };
    await h.scratch.owner.unsafe(`
      create function sineobex.test_fail_merge() returns trigger language plpgsql as $$
      begin
        if new.action in ('patient.merged', 'duplicates.viewed') then raise exception 'audit refused'; end if;
        return new;
      end $$;
      create trigger test_fail_merge before insert on sineobex.audit_events
        for each row execute function sineobex.test_fail_merge()`);
    try {
      expect((await post(`/v1/team/duplicates/${pairId}/decision`, body)).status).toBe(500);
      const listed = await get('/v1/team/duplicates');
      expect(listed.status).toBe(500);
      expect(await listed.text()).not.toContain(survivor);
    } finally {
      await h.scratch.owner.unsafe(`
        drop trigger test_fail_merge on sineobex.audit_events;
        drop function sineobex.test_fail_merge()`);
    }
    expect(await patient(merged)).toMatchObject({ status: 'active', canonicalId: merged });
    expect((await pairOf(survivor, merged))!.status).toBe('open');
    const decisions = await h.scratch
      .owner`select id from sineobex.duplicate_decisions where pair_id = ${pairId}`;
    expect(decisions).toHaveLength(0);
  });
});
