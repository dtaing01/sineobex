import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/auth/context.ts';
import type { Permission } from '../src/auth/permissions.ts';
import type { Tx } from '../src/db/database.ts';
import { rematchPatient } from '../src/patients/duplicates.ts';
import { idLinkTokenHash, newIdLinkToken } from '../src/patients/id-links.ts';
import type {
  DuplicateDecisionResultValue,
  DuplicatePairDetailValue,
  MergePageValue,
  PatientChartValue,
  UndoMergeResultValue,
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
  type Member,
  type NewPatient,
} from './patient-fixtures.ts';
import type { Json } from './sync-fixtures.ts';

// Merges and their undo (phase 3 design 8.4, 8.5, D27, D39): undo is exact, gives each record its
// own cards back, needs patients.correct_identity, and waits for a later merge on the group to be
// undone first. "Not the same person" holds through both. Everyone here is made up.

const ADMIN: Permission[] = [
  'patients.view',
  'patients.edit',
  'patients.review_duplicates',
  'patients.correct_identity',
  'encounters.chart',
];
const REVIEWER: Permission[] = ['patients.view', 'patients.review_duplicates'];

const spy = logSpy();
let h: Harness;
let teamId: string;
let admin: Member;
let reviewer: Member;

const get = (path: string, token = admin.token) => h.request(path, { token, teamId });
const post = (path: string, json: unknown, token = admin.token) =>
  h.request(path, { method: 'POST', token, teamId, json });

async function openPair(x: string, y: string, status = 'open', note: string | null = null): Promise<string> {
  const [a, b] = [x, y].sort();
  const [row] = await h.scratch.owner<{ id: string }[]>`
    insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, reasons, sources, status, note)
    values (${teamId}, ${a!}, ${b!}, 0.85, '{name}', '{sync}', ${status}, ${note}) returning id`;
  return row!.id;
}

async function pairStatus(pairId: string): Promise<{ status: string; note: string | null }> {
  const [row] = await h.scratch.owner<{ status: string; note: string | null }[]>`
    select status, note from sineobex.duplicate_pairs where id = ${pairId}`;
  return row!;
}

/** Merges through the route, as a reviewer would; returns the merge's ID. */
async function merge(mergedId: string, survivorId: string, pairId?: string): Promise<string> {
  const id = pairId ?? (await openPair(mergedId, survivorId));
  const detail = (await (await get(`/v1/team/duplicates/${id}`)).json()) as DuplicatePairDetailValue;
  const res = await post(`/v1/team/duplicates/${id}/decision`, {
    decision: 'merge',
    survivorId,
    comment: 'Same person, ID card checked',
    versions: { a: detail.a.version, b: detail.b.version },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as DuplicateDecisionResultValue).merge!.id;
}

const undo = (mergeId: string, token = admin.token, comment = 'Merged by mistake, two people') =>
  post(`/v1/team/merges/${mergeId}/undo`, { comment }, token);

async function patient(id: string) {
  const [row] = await h.scratch.owner<{ status: string; canonicalId: string; mergedInto: string | null }[]>`
    select status, canonical_id as "canonicalId", merged_into as "mergedInto" from sineobex.patients where id = ${id}`;
  return row!;
}

async function linkStatus(id: string): Promise<string> {
  const [row] = await h.scratch.owner<{ status: string }[]>`
    select status from sineobex.patient_id_links where id = ${id}`;
  return row!.status;
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

function rematch(patientId: string) {
  return h.db.tx({ teamId, userId: admin.userId }, async (tx: Tx) => {
    await lockTeamWrites(tx, teamId);
    const audit = async (e: AuditEvent) => {
      await tx`
        select sineobex.append_audit(${teamId}, ${admin.userId}, null, null, ${e.action}, ${e.entity ?? null},
          ${e.entityId ?? null}, ${e.patientId ?? null}, null, null, null, null, null,
          ${tx.json((e.details ?? {}) as never)})`;
    };
    return rematchPatient(tx, audit, patientId, 'edit');
  });
}

/** A phone's `set` on the merged record, applied to the survivor (design 2.7), as S1 records it. */
async function redirectedEdit(mergedId: string, survivorId: string): Promise<string> {
  const deviceId = randomUUID();
  const changeId = randomUUID();
  await h.scratch.owner`
    insert into sineobex.devices (id, team_id, user_id, platform, app_version, public_key)
    values (${deviceId}, ${teamId}, ${admin.userId}, 'android', '1.0.0', ${'A'.repeat(43)})`;
  await h.scratch.owner`
    insert into sineobex.sync_changes (change_id, team_id, device_id, user_id, device_seq, entity, record_id, op, field,
      value_hash, base_version, device_time, status)
    values (${changeId}, ${teamId}, ${deviceId}, ${admin.userId}, 1, 'patient', ${mergedId}, 'set', 'visualDescriptor',
      ${'0'.repeat(64)}, 1, now(), 'accepted')`;
  const [row] = await h.scratch.owner<{ id: string }[]>`
    insert into sineobex.field_history (team_id, entity, record_id, field, version, value, previous_value, kind,
      changed_by, change_id, device_id)
    values (${teamId}, 'patient', ${survivorId}, 'visualDescriptor', 2, ${h.scratch.owner.json('Demo: orange hat')},
      'null'::jsonb, 'redirected', ${admin.userId}, ${changeId}, ${deviceId})
    returning id::text`;
  return row!.id;
}

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  teamId = await createTeam(h);
  admin = await memberWith(h, teamId, ADMIN);
  reviewer = await memberWith(h, teamId, REVIEWER);
});

afterAll(async () => {
  spy.expectClean(['fitzgerald', 'demoray', 'orange hat', 'by mistake']);
  await h?.close();
});

describe('undo (design 8.5)', () => {
  it('reverts the fills nobody touched, keeps the rest, and puts pairs and late records back', async () => {
    const FITZ: NewPatient = { preferredName: 'Fitz', allergyScreen: 'none_known' };
    const survivor = (await createPatient(h, teamId, admin.userId, FITZ)).id;
    const merged = (
      await createPatient(h, teamId, admin.userId, {
        preferredName: 'Fitzgerald',
        legalName: { given: 'Fitzgerald', family: 'Demoray' },
        usualArea: 'Demo: by the ferry',
        livingSituation: { kind: 'housed' },
        allergies: [{ substance: 'latex' }],
      })
    ).id;
    const t1 = (await createPatient(h, teamId, admin.userId, { preferredName: 'Gerald' })).id;
    const t2 = (await createPatient(h, teamId, admin.userId, { preferredName: 'Gerry' })).id;
    const settled = await openPair(merged, t1);
    const unsure = await openPair(merged, t2, 'not_sure', 'Check the card');
    const pairId = await openPair(merged, survivor);
    const mergeId = await merge(merged, survivor, pairId);
    expect((await pairStatus(settled)).status).toBe('superseded');

    // While merged: livingSituation edited on the survivor; the preferred name cleared, so the
    // filled legal name is all that names him; a late alias stored with the merged ID; an edit
    // sent to the merged record applied to the survivor.
    await h.scratch.owner`
      update sineobex.patients set living_situation = 'unsheltered', preferred_name = null,
        field_versions = field_versions || '{"livingSituation": 3, "preferredName": 2}'::jsonb
      where id = ${survivor}`;
    await h.scratch.owner`
      insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id)
      values (${randomUUID()}, ${teamId}, ${merged}, 'Demo Fitzy', ${admin.userId})`;
    const historyId = await redirectedEdit(merged, survivor);

    const mark = await auditMark(h);
    const res = await undo(mergeId);
    expect(res.status).toBe(200);
    const result = (await res.json()) as UndoMergeResultValue;
    expect(result.revertedFields).toEqual(['usualArea', 'allergyScreen']);
    expect(result.keptFields).toEqual(['legalName', 'livingSituation']);
    expect(result.reviewsClosed).toBe(1);
    expect(result.redirectedEdits).toEqual([
      expect.objectContaining({
        historyId,
        field: 'visualDescriptor',
        by: expect.objectContaining({ userId: admin.userId }),
      }),
    ]);
    expect(result.restoredLinks).toEqual([]);
    expect(result.linksIssuedWhileMerged).toEqual([]);
    expect(result.merge).toMatchObject({
      id: mergeId,
      undone: { by: { userId: admin.userId }, comment: 'Merged by mistake, two people' },
      undoable: false,
    });

    // Two records again, each with what was stored under its own ID.
    expect(await patient(merged)).toEqual({ status: 'active', canonicalId: merged, mergedInto: null });
    const [s] = await h.scratch.owner<
      { usualArea: string | null; allergyScreen: string; legalGivenName: string | null }[]
    >`
      select usual_area as "usualArea", allergy_screen as "allergyScreen", legal_given_name as "legalGivenName"
      from sineobex.patients where id = ${survivor}`;
    expect(s).toEqual({ usualArea: null, allergyScreen: 'none_known', legalGivenName: 'Fitzgerald' });
    const mergedChart = (await (await get(`/v1/patients/${merged}`)).json()) as PatientChartValue;
    expect(mergedChart.canonicalId).toBe(merged);
    expect(mergedChart.aliases.map((a) => a.fields.alias?.value ?? a.attributes.alias)).toContain(
      'Demo Fitzy',
    );
    const survivorChart = (await (await get(`/v1/patients/${survivor}`)).json()) as PatientChartValue;
    expect(survivorChart.allergies).toEqual([]);
    expect(survivorChart.reviews.filter((r) => r.status === 'open')).toEqual([]);

    // Pairs: the superseded ones as they were, the merged one open to be decided again.
    expect(await pairStatus(settled)).toEqual({ status: 'open', note: null });
    expect(await pairStatus(unsure)).toEqual({ status: 'not_sure', note: 'Check the card' });
    expect((await pairStatus(pairId)).status).toBe('open');
    const detail = (await (await get(`/v1/team/duplicates/${pairId}`)).json()) as DuplicatePairDetailValue;
    expect(detail.decisions.map((d) => d.decision)).toEqual(['merge', 'undo_merge']);

    const events = await expectAudit(h, 'patient.merge_undone', { after: mark, count: 2 });
    expect(events.map((e) => e.patientId).sort()).toEqual([survivor, merged].sort());
    expect(Object.keys(events[0]!.details).sort()).toEqual(['commentSha256', 'decisionId', 'mergeId']);
    await expectAuditClean(h, ['by mistake', 'fitzgerald', 'demoray'], mark);
    const corrections = await h.scratch.owner<{ patientId: string }[]>`
      select patient_id as "patientId" from sineobex.patient_corrections where kind = 'merge_undo'
        and patient_id in (${survivor}, ${merged})`;
    expect(corrections).toHaveLength(2);

    const again = await undo(mergeId);
    expect(again.status).toBe(409);
    expect(((await again.json()) as Json).error!.code).toBe('already_undone');
  });

  it('changes no card when nobody regenerated one while merged', async () => {
    const survivor = (await createPatient(h, teamId, admin.userId, { preferredName: 'Rosalind' })).id;
    const merged = (await createPatient(h, teamId, admin.userId, { preferredName: 'Roz' })).id;
    const [ls, lm] = [await issueLink(survivor), await issueLink(merged)];
    const mergeId = await merge(merged, survivor);
    expect([await linkStatus(ls), await linkStatus(lm)]).toEqual(['active', 'active']);
    const result = (await (await undo(mergeId)).json()) as UndoMergeResultValue;
    expect(result.restoredLinks).toEqual([]);
    expect([await linkStatus(ls), await linkStatus(lm)]).toEqual(['active', 'active']);
  });

  it('gives the merged record back the card a regeneration retired, and lists the new one', async () => {
    const survivor = (await createPatient(h, teamId, admin.userId, { preferredName: 'Cormac' })).id;
    const merged = (await createPatient(h, teamId, admin.userId, { preferredName: 'Mac' })).id;
    const [ls, lm] = [await issueLink(survivor), await issueLink(merged)];
    const mergeId = await merge(merged, survivor);

    // A new card for the group retires both old ones (D39).
    const ln = randomUUID();
    const issued = await post(`/v1/patients/${survivor}/id-link`, {
      linkId: ln,
      replacesLinkId: ls,
      reason: 'lost',
    });
    expect(issued.status).toBe(200);
    expect([await linkStatus(ls), await linkStatus(lm), await linkStatus(ln)]).toEqual([
      'retired',
      'retired',
      'active',
    ]);

    const mark = await auditMark(h);
    const result = (await (await undo(mergeId)).json()) as UndoMergeResultValue;
    expect(result.restoredLinks).toEqual([
      { linkId: lm, tokenRef: expect.stringMatching(/^[0-9a-f]{12}$/), issuedOn: merged },
    ]);
    expect(result.linksIssuedWhileMerged).toEqual([
      expect.objectContaining({ linkId: ln, issuedOn: survivor, reason: 'lost' }),
    ]);
    expect([await linkStatus(ls), await linkStatus(lm), await linkStatus(ln)]).toEqual([
      'retired',
      'active',
      'active',
    ]);
    const [restored] = await expectAudit(h, 'id_link.restored', { after: mark, count: 1 });
    expect(restored).toMatchObject({ patientId: merged, details: { linkId: lm, mergeId } });
    const [m] = await h.scratch.owner<{ ids: string[] }[]>`
      select restored_link_ids as ids from sineobex.patient_merges where id = ${mergeId}`;
    expect(m!.ids).toEqual([lm]);
  });

  it('refuses while a later merge sits on top, then undoes each in turn', async () => {
    const a = (await createPatient(h, teamId, admin.userId, { preferredName: 'Ansel' })).id;
    const b = (await createPatient(h, teamId, admin.userId, { preferredName: 'Anse' })).id;
    const c = (await createPatient(h, teamId, admin.userId, { preferredName: 'Anselm' })).id;
    const first = await merge(b, a);
    const second = await merge(a, c);
    const list = (await (await get('/v1/team/merges')).json()) as MergePageValue;
    const undoable = Object.fromEntries(list.merges.map((m) => [m.id, m.undoable]));
    expect(undoable).toMatchObject({ [first]: false, [second]: true });

    const refused = await undo(first);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as Json;
    expect(body.error).toMatchObject({ code: 'undo_later_merge_first', details: { mergeIds: [second] } });
    expect((await patient(b)).canonicalId).toBe(c);

    expect((await undo(second)).status).toBe(200);
    // a's group (a, b) comes back whole: b's canonical follows a down the subtree.
    expect(await patient(b)).toMatchObject({ canonicalId: a, mergedInto: a });
    expect((await undo(first)).status).toBe(200);
    expect(await patient(b)).toEqual({ status: 'active', canonicalId: b, mergedInto: null });
  });

  it('needs patients.correct_identity and a recent sign-in; review_duplicates alone is refused and logged', async () => {
    const survivor = (await createPatient(h, teamId, admin.userId, { preferredName: 'Ottoline' })).id;
    const merged = (await createPatient(h, teamId, admin.userId, { preferredName: 'Otto' })).id;
    const mergeId = await merge(merged, survivor);
    const mark = await auditMark(h);
    expect((await undo(mergeId, reviewer.token)).status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
    expect(denied!.details).toMatchObject({ permission: 'patients.correct_identity' });

    const [user] = await h.scratch.owner<
      { email: string }[]
    >`select email from sineobex.users where id = ${admin.userId}`;
    const stale = await h.tokenFor(user!.email, { authTime: new Date(h.clock.now.getTime() - 20 * 60_000) });
    const res = await undo(mergeId, stale);
    expect(res.status).toBe(403);
    expect(((await res.json()) as Json).error!.code).toBe('reauth_required');
    expect((await patient(merged)).status).toBe('merged');
    expect((await undo(randomUUID())).status).toBe(404);
  });
});

describe('the merge list', () => {
  it('lists merges newest first, undoable only for patients.correct_identity, auditing both patients of each', async () => {
    const survivor = (await createPatient(h, teamId, admin.userId, { preferredName: 'Perpetua' })).id;
    const merged = (await createPatient(h, teamId, admin.userId, { preferredName: 'Pet' })).id;
    const mergeId = await merge(merged, survivor);

    const mark = await auditMark(h);
    const res = await get('/v1/team/merges');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const page = (await res.json()) as MergePageValue;
    expect(page.merges[0]).toMatchObject({
      id: mergeId,
      survivor: { patientId: survivor, summary: { preferredName: 'Perpetua' } },
      merged: { patientId: merged, summary: { preferredName: 'Pet' } },
      comment: 'Same person, ID card checked',
      undone: null,
      undoable: true,
    });
    const times = page.merges.map((m) => m.mergedAt);
    expect(times).toEqual([...times].sort().reverse());
    const [viewed] = await expectAudit(h, 'merges.viewed', { after: mark, count: 1 });
    expect(viewed!.details.count).toBe(page.merges.length);
    for (const m of page.merges)
      expect(viewed!.details.patientIds).toEqual(
        expect.arrayContaining([m.survivor.patientId, m.merged.patientId]),
      );

    const asReviewer = (await (await get('/v1/team/merges', reviewer.token)).json()) as MergePageValue;
    expect(asReviewer.merges.every((m) => !m.undoable)).toBe(true);
    const nobody = await memberWith(h, teamId, ['patients.view']);
    expect((await get('/v1/team/merges', nobody.token)).status).toBe(403);
  });
});

describe('"Not the same person" through merges and undos (design 8.6)', () => {
  it('suppresses the merged group while merged, and only the original pair after the undo', async () => {
    const LEO: NewPatient = { preferredName: 'Leopold', birth: { precision: 'year', year: 1966 } };
    const x = (await createPatient(h, teamId, admin.userId, LEO)).id;
    const y = (await createPatient(h, teamId, admin.userId, LEO)).id;
    const z = (await createPatient(h, teamId, admin.userId, LEO)).id;
    const kept = await openPair(x, y);
    const detail = (await (await get(`/v1/team/duplicates/${kept}`)).json()) as DuplicatePairDetailValue;
    const decided = await post(`/v1/team/duplicates/${kept}/decision`, {
      decision: 'keep_separate',
      comment: 'Brothers, met both',
      versions: { a: detail.a.version, b: detail.b.version },
    });
    expect(decided.status).toBe(200);

    const mergeId = await merge(y, z);
    expect((await rematch(x)).flagged.map((f) => f.otherId)).not.toContain(z);
    expect((await undo(mergeId)).status).toBe(200);
    expect((await rematch(x)).flagged.map((f) => f.otherId)).toEqual([z]);
    expect((await rematch(y)).flagged.map((f) => f.otherId)).not.toContain(x);
  });
});
