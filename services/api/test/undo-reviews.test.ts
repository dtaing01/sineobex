import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  DuplicateDecisionResultValue,
  DuplicatePairDetailValue,
  FieldReviewPageValue,
  FieldReviewViewValue,
  PatientChartValue,
  UndoMergeResultValue,
} from '../src/patients/schemas.ts';
import { createHarness, type Harness } from './harness.ts';
import { createPatient, type NewPatient } from './patient-fixtures.ts';
import {
  call,
  FakePhone,
  push,
  register,
  results,
  setupTeam,
  type Json,
  type Team,
} from './sync-fixtures.ts';

// Undoing a merge takes the merged record's values back out of the kept chart's field reviews
// (phase 3 design 8.5; review finding S1): those the merge put there, and those edits sent to the
// merged record while merged put there. Decided reviews stay decided and are listed, and the merged
// record's own reviews open again. S is the kept chart, M the merged one. Everyone here is made up.

type Change = Awaited<ReturnType<FakePhone['change']>>;

let h: Harness;
let t: Team;
let phoneA: FakePhone;
let phoneB: FakePhone;

beforeAll(async () => {
  h = await createHarness();
  t = await setupTeam(h);
  phoneA = await FakePhone.create();
  phoneB = await FakePhone.create();
  await register(h, phoneA, t.aToken, t.teamId);
  await register(h, phoneB, t.bToken, t.teamId);
});
afterAll(() => h.close());

const asAdmin = (path: string, json?: unknown) =>
  call(h, path, { method: json === undefined ? 'GET' : 'POST', token: t.adminToken, teamId: t.teamId, json });

const send = async (phone: FakePhone, token: string, ...changes: Change[]) =>
  results((await push(h, phone, token, t.teamId, changes)).body);

/** A set from a phone that hasn't seen the field's current version: kept both on a different value. */
const staleSet = (phone: FakePhone, recordId: string, field: string, value: unknown) =>
  phone.change({ entity: 'patient', recordId, op: 'set', field, value, baseVersion: 0 });

const patients = async (s: NewPatient, m: NewPatient) => ({
  s: (await createPatient(h, t.teamId, t.aId, s)).id,
  m: (await createPatient(h, t.teamId, t.aId, m)).id,
});

/** Merges M into S through the routes, as a reviewer would; returns the merge's ID. */
async function merge(m: string, s: string): Promise<string> {
  const [a, b] = [s, m].sort();
  const [pair] = await h.scratch.owner<{ id: string }[]>`
    insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, reasons, sources)
    values (${t.teamId}, ${a!}, ${b!}, 0.85, '{name}', '{sync}') returning id`;
  const detail = (await asAdmin(`/v1/team/duplicates/${pair!.id}`))
    .body as unknown as DuplicatePairDetailValue;
  const decided = await asAdmin(`/v1/team/duplicates/${pair!.id}/decision`, {
    decision: 'merge',
    survivorId: s,
    comment: 'Same person, ID card checked',
    versions: { a: detail.a.version, b: detail.b.version },
  });
  expect(decided.status).toBe(200);
  return (decided.body as unknown as DuplicateDecisionResultValue).merge!.id;
}

async function undo(mergeId: string): Promise<UndoMergeResultValue> {
  const res = await asAdmin(`/v1/team/merges/${mergeId}/undo`, { comment: 'Two different people' });
  expect(res.status).toBe(200);
  return res.body as unknown as UndoMergeResultValue;
}

/** The open reviews of a patient record as the team list shows them, by field. */
async function openReviews(recordId: string): Promise<Map<string, FieldReviewViewValue>> {
  const page = (await asAdmin('/v1/team/field-reviews?status=open')).body as unknown as FieldReviewPageValue;
  const [row] = await h.scratch.owner<{ canonicalId: string }[]>`
    select canonical_id as "canonicalId" from sineobex.patients where id = ${recordId}`;
  return new Map(page.reviews.filter((r) => r.patientId === row!.canonicalId).map((r) => [r.field, r]));
}

const values = (r: FieldReviewViewValue | undefined) => r?.alternates.map((a) => a.value);

/**
 * History IDs of the values that came from M while merged: the kept_both rows the merge wrote on S
 * (in its own transaction, so at its time, with no device), and those of changes a phone sent naming M.
 */
async function fromMerged(s: string, m: string): Promise<string[]> {
  const rows = await h.scratch.owner<{ id: string }[]>`
    select h.id::text as id from sineobex.field_history h
    left join sineobex.sync_changes c on c.change_id = h.change_id and h.device_id is not null
    where h.record_id = ${s} and h.kind = 'kept_both'
      and ((h.device_id is null
            and h.recorded_at = (select merged_at from sineobex.patient_merges where merged_id = ${m}))
        or c.record_id = ${m})`;
  return rows.map((r) => r.id);
}

/** Every alternate an open review on the record still offers, read from the database. */
async function offered(recordId: string): Promise<string[]> {
  const rows = await h.scratch.owner<{ id: string }[]>`
    select h.id::text as id from sineobex.field_reviews r
    join sineobex.field_history h on h.review_id = r.id and h.kind = 'kept_both'
    where r.record_id = ${recordId} and r.status = 'open' and h.id <> all (r.withdrawn_history_ids)`;
  return rows.map((r) => r.id);
}

describe('undo and the kept chart’s field reviews', () => {
  it('takes the merged record’s values out of open reviews, and lists the redirected edit', async () => {
    const { s, m } = await patients(
      {
        preferredName: 'Demo Sam',
        usualArea: 'Demo: Elm St underpass',
        visualDescriptor: 'Demo: red cap',
        preferredLanguage: 'en',
      },
      { preferredName: 'Demo Mo', usualArea: 'Demo: Pier 3', visualDescriptor: 'Demo: blue scarf' },
    );
    // Before the merge, S already has a review on its usual area (a phone that hadn't seen it).
    expect(
      (await send(phoneA, t.aToken, await staleSet(phoneA, s, 'usualArea', 'Demo: Oak Park')))[0],
    ).toMatchObject({ details: { outcome: 'kept_both' } });

    const mergeId = await merge(m, s);
    const merged = await openReviews(s);
    // The merge joined the usual area review and opened reviews on the name and the description.
    expect(values(merged.get('usualArea'))).toEqual(['Demo: Oak Park', 'Demo: Pier 3']);
    expect(values(merged.get('preferredName'))).toEqual(['Demo Mo']);
    expect(values(merged.get('visualDescriptor'))).toEqual(['Demo: blue scarf']);

    // While merged: a phone still holding M records a language for M (redirected to S, kept both),
    // and a phone on S that hadn't seen its description records another (S's own value).
    const [late] = await send(
      phoneB,
      t.bToken,
      await phoneB.change({
        entity: 'patient',
        recordId: m,
        op: 'set',
        field: 'preferredLanguage',
        value: 'fr',
        baseVersion: 1,
      }),
    );
    expect(late).toMatchObject({ status: 'accepted', details: { outcome: 'kept_both', redirectedTo: s } });
    await send(phoneA, t.aToken, await staleSet(phoneA, s, 'visualDescriptor', 'Demo: green coat'));
    const [lateRow] = await h.scratch.owner<{ id: string }[]>`
      select id::text from sineobex.field_history where change_id = ${late!.changeId}`;
    expect(values((await openReviews(s)).get('preferredLanguage'))).toEqual(['fr']);
    const mValues = await fromMerged(s, m);
    expect(mValues).toHaveLength(4);
    expect(mValues).toContain(lateRow!.id);

    const result = await undo(mergeId);

    // No open review on S offers anything that came from M.
    const stillOffered = await offered(s);
    expect(stillOffered).toHaveLength(2);
    for (const id of mValues) expect(stillOffered).not.toContain(id);
    const after = await openReviews(s);
    expect([...after.keys()].sort()).toEqual(['usualArea', 'visualDescriptor']);
    expect(values(after.get('usualArea'))).toEqual(['Demo: Oak Park']);
    expect(values(after.get('visualDescriptor'))).toEqual(['Demo: green coat']);
    const chart = (await asAdmin(`/v1/patients/${s}`)).body as unknown as PatientChartValue;
    expect(chart.reviews.map((r) => [r.field, r.alternates.map((a) => a.value)]).sort()).toEqual([
      ['usualArea', ['Demo: Oak Park']],
      ['visualDescriptor', ['Demo: green coat']],
    ]);

    // The answer: the name and language reviews held only M's values; the redirected edit is
    // listed for the admin to move by hand; nothing was decided.
    expect(result.reviewsClosed).toBe(2);
    expect(result.decidedReviews).toEqual([]);
    expect(result.redirectedEdits).toEqual([
      expect.objectContaining({ historyId: lateRow!.id, field: 'preferredLanguage', outcome: 'kept_both' }),
    ]);

    // M's usual area can no longer be chosen for S.
    const area = after.get('usualArea')!;
    const [pier] = await h.scratch.owner<{ id: string }[]>`
      select id::text from sineobex.field_history
      where review_id = ${area.id} and value = ${h.scratch.owner.json('Demo: Pier 3')}`;
    const refused = await asAdmin(`/v1/team/field-reviews/${area.id}/decision`, {
      keep: 'alternate',
      historyId: pier!.id,
      baseVersion: area.current.version,
    });
    expect(refused.status).toBe(422);
    expect((refused.body as Json).error!.code).toBe('not_an_alternate');
    const [row] = await h.scratch.owner<{ usualArea: string }[]>`
      select usual_area as "usualArea" from sineobex.patients where id = ${s}`;
    expect(row!.usualArea).toBe('Demo: Elm St underpass');
  });

  it('lists reviews decided while merged, saying when the kept chart took the merged record’s value', async () => {
    const { s, m } = await patients(
      { preferredName: 'Demo Ash', birth: { precision: 'day', date: '1970-05-05' } },
      { preferredName: 'Demo Ashe', birth: { precision: 'day', date: '1958-11-30' } },
    );
    const mergeId = await merge(m, s);
    const open = await openReviews(s);
    const birth = open.get('birth')!;
    const name = open.get('preferredName')!;
    expect(
      (
        await asAdmin(`/v1/team/field-reviews/${birth.id}/decision`, {
          keep: 'alternate',
          historyId: birth.alternates[0]!.historyId,
          comment: 'ID card shows this date',
          baseVersion: birth.current.version,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await asAdmin(`/v1/team/field-reviews/${name.id}/decision`, {
          keep: 'current',
          baseVersion: name.current.version,
        })
      ).status,
    ).toBe(200);

    const result = await undo(mergeId);

    expect([...result.decidedReviews].sort((x, y) => x.field.localeCompare(y.field))).toEqual([
      expect.objectContaining({
        reviewId: birth.id,
        field: 'birth',
        keptMergedValue: true,
        decidedBy: expect.objectContaining({ userId: t.adminId }),
      }),
      expect.objectContaining({ reviewId: name.id, field: 'preferredName', keptMergedValue: false }),
    ]);
    expect(result.reviewsClosed).toBe(0);
    // The design lists a decided value rather than reverting it (8.5): S keeps the date chosen.
    const [row] = await h.scratch.owner<{ birth: string }[]>`
      select to_char(birth_date, 'YYYY-MM-DD') as birth from sineobex.patients where id = ${s}`;
    expect(row!.birth).toBe('1958-11-30');
  });

  it('opens the merged record’s own reviews again', async () => {
    const { s, m } = await patients(
      { preferredName: 'Demo Wren', usualArea: 'Demo: Dock 5' },
      { preferredName: 'Demo Wren', usualArea: 'Demo: Dock 5' },
    );
    await send(phoneA, t.aToken, await staleSet(phoneA, m, 'usualArea', 'Demo: Dock 6'));
    const before = (await openReviews(m)).get('usualArea')!;
    const mergeId = await merge(m, s);
    expect((await openReviews(s)).get('usualArea')).toBeUndefined();

    const result = await undo(mergeId);

    expect(result.reviewsReopened).toBe(1);
    const again = (await openReviews(m)).get('usualArea');
    expect(again).toMatchObject({ id: before.id, patientId: m, status: 'open' });
    expect(values(again)).toEqual(['Demo: Dock 6']);
    const chart = (await asAdmin(`/v1/patients/${m}`)).body as unknown as PatientChartValue;
    expect(chart.reviews.map((r) => r.id)).toEqual([before.id]);
  });
});
