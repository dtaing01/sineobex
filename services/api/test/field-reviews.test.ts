import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Permission } from '../src/auth/permissions.ts';
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
} from './patient-fixtures.ts';

// Field reviews: two values recorded for one patient field, the chart keeps its own, and someone
// who knows the patient picks (phase 3 design 2.4, 3.2; D26).

describe('field reviews', () => {
  let h: Harness;
  let teamId: string;
  let otherTeamId: string;
  let editor: Member;
  let admin: Member;
  let adminEmail: string;
  let viewer: Member;
  let other: Member;
  const logs = logSpy();
  /** Values written in this file: none may reach an audit event or a log line. */
  const values = [
    'Demo: by the made-up bus station',
    'Demo: behind the made-up library',
    'Demo: tall, green coat',
    'Delbert',
    'Okafor-Demo',
  ] as const;

  const ADMIN: Permission[] = ['patients.view', 'patients.edit', 'patients.correct_identity'];

  beforeAll(async () => {
    h = await createHarness({ log: logs.log });
    teamId = await createTeam(h, 'Review Team (demo)');
    otherTeamId = await createTeam(h, 'Other Review Team (demo)');
    editor = await memberWith(h, teamId, ['patients.view', 'patients.edit'], {
      displayName: 'Jordan (demo)',
    });
    adminEmail = `admin-${randomUUID().slice(0, 8)}@example.com`;
    admin = await memberWith(h, teamId, ADMIN, { email: adminEmail, displayName: 'Alex (demo)' });
    viewer = await memberWith(h, teamId, ['patients.view']);
    other = await memberWith(h, otherTeamId, ADMIN);
  });
  afterAll(() => h.close());

  /**
   * An open review on one field, as the keep-both rule leaves it (design 2.4): the chart keeps its
   * value and the other one is a `kept_both` history row carrying the review's ID.
   */
  async function openReview(
    patientId: string,
    field: string,
    alternate: unknown,
    o: { needs?: Permission; by?: Member; team?: string } = {},
  ) {
    const sql = h.scratch.owner;
    const reviewId = randomUUID();
    const team = o.team ?? teamId;
    const [current] = await sql<{ value: unknown }[]>`
      select value from sineobex.field_history
      where record_id = ${patientId} and field = ${field} order by id desc limit 1`;
    await sql`
      insert into sineobex.field_reviews (id, team_id, patient_id, entity, record_id, field, needs)
      values (${reviewId}, ${team}, ${patientId}, 'patient', ${patientId}, ${field}, ${o.needs ?? 'patients.edit'})`;
    const [row] = await sql<{ id: string }[]>`
      insert into sineobex.field_history (team_id, entity, record_id, field, version, value, previous_value, kind,
        changed_by, device_time, review_id)
      values (${team}, 'patient', ${patientId}, ${field}, 1, ${sql.json(alternate as never)},
        ${sql.json((current?.value ?? null) as never)}, 'kept_both', ${(o.by ?? editor).userId},
        '2026-10-20T14:40:00Z', ${reviewId})
      returning id::text as id`;
    return { reviewId, historyId: row!.id };
  }

  interface ReviewView {
    id: string;
    patientId: string;
    field: string;
    needs: string;
    current: { value: unknown; version: number; changedBy: string | null };
    alternates: { historyId: string; value: unknown; by: { userId: string; displayName: string } }[];
    status: string;
  }

  const call = async (path: string, by: Member, json?: unknown) => {
    const res = await h.request(path, {
      method: json === undefined ? 'GET' : 'POST',
      token: by.token,
      teamId: by === other ? otherTeamId : teamId,
      ...(json === undefined ? {} : { json }),
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    return {
      status: res.status,
      text,
      body: JSON.parse(text) as ReviewView & {
        reviews: ReviewView[];
        nextAfterId: string | null;
        error?: { code: string; details?: Record<string, unknown> };
      },
    };
  };
  const decide = (reviewId: string, by: Member, body: Record<string, unknown>) =>
    call(`/v1/team/field-reviews/${reviewId}/decision`, by, body);

  const patientRow = async (id: string) =>
    (
      await h.scratch.owner<
        {
          usualArea: string | null;
          visualDescriptor: string | null;
          version: number;
          versions: Record<string, number>;
        }[]
      >`
        select usual_area as "usualArea", visual_descriptor as "visualDescriptor", version,
               field_versions as versions
        from sineobex.patients where id = ${id}`
    )[0]!;
  const reviewRow = async (id: string) =>
    (
      await h.scratch.owner<
        { status: string; decision: unknown; comment: string | null; decidedBy: string | null }[]
      >`
        select status, decision, comment, decided_by as "decidedBy" from sineobex.field_reviews where id = ${id}`
    )[0]!;

  describe('the queue', () => {
    it('lists the reviews the caller may decide, with the chart’s value beside the alternates', async () => {
      const p = await createPatient(h, teamId, editor.userId, { usualArea: values[0] });
      const usual = await openReview(p.id, 'usualArea', values[1]);
      const legal = await openReview(
        p.id,
        'legalName',
        { given: values[3], family: null },
        {
          needs: 'patients.correct_identity',
        },
      );

      const mark = await auditMark(h);
      const asEditor = await call('/v1/team/field-reviews?status=open', editor);
      expect(asEditor.status).toBe(200);
      const mine = asEditor.body.reviews.filter((r) => r.patientId === p.id);
      // An editor decides ordinary fields only; legal name and birth date are an admin's.
      expect(mine.map((r) => r.id)).toEqual([usual.reviewId]);
      expect(mine[0]).toMatchObject({
        field: 'usualArea',
        needs: 'patients.edit',
        status: 'open',
        current: { value: values[0], version: 1, changedBy: editor.userId },
        alternates: [
          {
            historyId: usual.historyId,
            value: values[1],
            by: { userId: editor.userId, displayName: 'Jordan (demo)' },
          },
        ],
      });
      const [viewed] = await expectAudit(h, 'field_review.viewed', { after: mark, count: 1 });
      expect(viewed!.details).toMatchObject({ status: 'open', count: asEditor.body.reviews.length });
      const seen = await expectAudit(h, 'patient.viewed', { after: mark, patientId: p.id, count: 1 });
      expect(seen[0]!.details).toEqual({ source: 'field_review' });

      const asAdmin = await call('/v1/team/field-reviews?status=open', admin);
      expect(asAdmin.body.reviews.filter((r) => r.patientId === p.id).map((r) => r.id)).toEqual([
        usual.reviewId,
        legal.reviewId,
      ]);
    });

    it('pages by afterId, and never shows another team’s reviews', async () => {
      const p = await createPatient(h, teamId, editor.userId, { usualArea: values[0] });
      await openReview(p.id, 'usualArea', values[1]);
      await openReview(p.id, 'livingSituation', { kind: 'vehicle' });
      const elsewhere = await createPatient(h, otherTeamId, other.userId, { usualArea: values[0] });
      const theirs = await openReview(elsewhere.id, 'usualArea', values[1], { team: otherTeamId, by: other });

      const all = (await call('/v1/team/field-reviews', admin)).body.reviews;
      expect(all.map((r) => r.id)).not.toContain(theirs.reviewId);
      const after = (await call(`/v1/team/field-reviews?afterId=${all[0]!.id}`, admin)).body.reviews;
      expect(after.map((r) => r.id)).toEqual(all.slice(1).map((r) => r.id));
      expect((await call('/v1/team/field-reviews', other)).body.reviews.map((r) => r.id)).toEqual([
        theirs.reviewId,
      ]);
    });

    it('refuses someone who decides nothing, and logs it', async () => {
      const mark = await auditMark(h);
      expect((await call('/v1/team/field-reviews', viewer)).status).toBe(403);
      await expectAudit(h, 'access.denied', { after: mark, count: 1 });
    });
  });

  describe('decisions', () => {
    it('keeps the chart’s value: the review closes and the chart is untouched', async () => {
      const p = await createPatient(h, teamId, editor.userId, { usualArea: values[0] });
      const { reviewId } = await openReview(p.id, 'usualArea', values[1]);
      const mark = await auditMark(h);
      const res = await decide(reviewId, editor, { keep: 'current', baseVersion: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: reviewId,
        status: 'decided',
        current: { value: values[0], version: 1 },
      });
      expect(await patientRow(p.id)).toMatchObject({ usualArea: values[0], version: 1 });
      expect(await reviewRow(reviewId)).toMatchObject({
        status: 'decided',
        decision: { kept: 'current', historyId: null },
        decidedBy: editor.userId,
      });
      const [decided] = await expectAudit(h, 'field_review.decided', {
        after: mark,
        patientId: p.id,
        count: 1,
      });
      expect(decided!.details).toEqual({
        reviewId,
        field: 'usualArea',
        kept: 'current',
        historyId: null,
        version: 1,
      });
    });

    it('writes a kept alternate as review_decided, by whoever saw it and approved by the reviewer', async () => {
      const p = await createPatient(h, teamId, editor.userId, { usualArea: values[0] });
      const casey = await memberWith(h, teamId, ['patients.view', 'patients.edit'], {
        displayName: 'Casey (demo)',
      });
      const { reviewId, historyId } = await openReview(p.id, 'usualArea', values[1], { by: casey });
      const mark = await auditMark(h);
      const res = await decide(reviewId, editor, {
        keep: 'alternate',
        historyId,
        baseVersion: 1,
        comment: 'Asked him today',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'decided',
        current: { value: values[1], version: 2, changedBy: casey.userId },
      });
      const row = await patientRow(p.id);
      expect(row).toMatchObject({ usualArea: values[1], version: 2 });
      expect(row.versions.usualArea).toBe(2);
      const history = await h.scratch.owner<
        { value: unknown; previousValue: unknown; changedBy: string; approvedBy: string; reviewId: string }[]
      >`
        select value, previous_value as "previousValue", changed_by as "changedBy", approved_by as "approvedBy",
               review_id as "reviewId"
        from sineobex.field_history where record_id = ${p.id} and kind = 'review_decided'`;
      expect(history).toEqual([
        {
          value: values[1],
          previousValue: values[0],
          changedBy: casey.userId,
          approvedBy: editor.userId,
          reviewId,
        },
      ]);
      expect(await reviewRow(reviewId)).toMatchObject({
        decision: { kept: 'alternate', historyId },
        comment: 'Asked him today',
      });
      const [decided] = await expectAudit(h, 'field_review.decided', { after: mark, count: 1 });
      expect(decided!.details).toMatchObject({
        kept: 'alternate',
        historyId,
        version: 2,
        commentSha256: expect.any(String),
      });
      expect(JSON.stringify(decided!.details)).not.toContain('Asked him');
    });

    it('answers a stale baseVersion with 409 field_changed and the version, never the value', async () => {
      const p = await createPatient(h, teamId, editor.userId, { usualArea: values[0] });
      const { reviewId, historyId } = await openReview(p.id, 'usualArea', values[1]);
      await h.scratch.owner`
        update sineobex.patients set field_versions = field_versions || '{"usualArea": 2}' where id = ${p.id}`;
      const res = await decide(reviewId, editor, { keep: 'alternate', historyId, baseVersion: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'field_changed',
        details: { field: 'usualArea', version: 2 },
      });
      for (const v of values) expect(res.text).not.toContain(v);
      expect(await reviewRow(reviewId)).toMatchObject({ status: 'open' });
    });

    it('refuses an alternate that would leave nobody to recognise (409 nothing_to_recognise)', async () => {
      const p = await createPatient(h, teamId, editor.userId, {
        preferredName: null,
        visualDescriptor: values[2],
      });
      // A phone cleared the description without having seen it: kept as the other value.
      const { reviewId, historyId } = await openReview(p.id, 'visualDescriptor', null);
      const res = await decide(reviewId, editor, { keep: 'alternate', historyId, baseVersion: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({ code: 'nothing_to_recognise', message: expect.any(String) });
      expect(await patientRow(p.id)).toMatchObject({ visualDescriptor: values[2], version: 1 });
      expect(await reviewRow(reviewId)).toMatchObject({ status: 'open' });
      // Keeping the chart's value is always possible.
      expect((await decide(reviewId, editor, { keep: 'current', baseVersion: 1 })).status).toBe(200);
    });

    it('refuses a value that isn’t this review’s, and a review already decided', async () => {
      const p = await createPatient(h, teamId, editor.userId, { usualArea: values[0] });
      const first = await openReview(p.id, 'usualArea', values[1]);
      const second = await openReview(p.id, 'livingSituation', { kind: 'vehicle' });
      const wrong = await decide(first.reviewId, editor, {
        keep: 'alternate',
        historyId: second.historyId,
        baseVersion: 1,
      });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error?.code).toBe('not_an_alternate');
      expect((await decide(first.reviewId, editor, { keep: 'current', baseVersion: 1 })).status).toBe(200);
      const again = await decide(first.reviewId, editor, { keep: 'current', baseVersion: 1 });
      expect(again.status).toBe(409);
      expect(again.body.error?.code).toBe('already_decided');
    });

    it('answers 404 for a review the team doesn’t have', async () => {
      const elsewhere = await createPatient(h, otherTeamId, other.userId, { usualArea: values[0] });
      const theirs = await openReview(elsewhere.id, 'usualArea', values[1], { team: otherTeamId, by: other });
      for (const id of [randomUUID(), theirs.reviewId]) {
        expect((await decide(id, admin, { keep: 'current', baseVersion: 1 })).status).toBe(404);
      }
    });
  });

  describe('legal name and birth date (needs patients.correct_identity)', () => {
    it('refuses an editor, logged with the permission the review needs', async () => {
      const p = await createPatient(h, teamId, editor.userId, {
        legalName: { given: values[3], family: null },
      });
      const { reviewId } = await openReview(
        p.id,
        'legalName',
        { given: values[3], family: values[4] },
        {
          needs: 'patients.correct_identity',
        },
      );
      const mark = await auditMark(h);
      const res = await decide(reviewId, editor, {
        keep: 'current',
        baseVersion: 1,
        comment: 'Checked the ID card',
      });
      expect(res.status).toBe(403);
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ permission: 'patients.correct_identity' });
    });

    it('needs a recent sign-in and a comment', async () => {
      const p = await createPatient(h, teamId, editor.userId, {
        birth: { precision: 'estimated', year: 1980 },
      });
      const { reviewId } = await openReview(
        p.id,
        'birth',
        { precision: 'day', date: '1970-03-07' },
        {
          needs: 'patients.correct_identity',
        },
      );
      const stale = {
        ...admin,
        token: await h.tokenFor(adminEmail, { authTime: new Date(h.clock.now.getTime() - 3600_000) }),
      };
      const old = await decide(reviewId, stale, {
        keep: 'current',
        baseVersion: 1,
        comment: 'Checked the ID card',
      });
      expect(old.status).toBe(403);
      expect(old.body.error?.code).toBe('reauth_required');
      const bare = await decide(reviewId, admin, { keep: 'current', baseVersion: 1 });
      expect(bare.status).toBe(422);
      expect(bare.body.error?.code).toBe('comment_required');
      const ok = await decide(reviewId, admin, {
        keep: 'current',
        baseVersion: 1,
        comment: 'Checked the ID card',
      });
      expect(ok.status).toBe(200);
      expect(await reviewRow(reviewId)).toMatchObject({ status: 'decided', comment: 'Checked the ID card' });
    });

    // Waits on S3: keeping an identity alternate re-runs duplicate matching (rematchPatient).
    it('writes a kept legal name with a correction row and re-runs matching', async () => {
      const p = await createPatient(h, teamId, editor.userId, {
        legalName: { given: values[3], family: null },
      });
      const { reviewId, historyId } = await openReview(
        p.id,
        'legalName',
        { given: values[3], family: values[4] },
        {
          needs: 'patients.correct_identity',
        },
      );
      const mark = await auditMark(h);
      const res = await decide(reviewId, admin, {
        keep: 'alternate',
        historyId,
        baseVersion: 1,
        comment: 'Checked the ID card',
      });
      expect(res.status).toBe(200);
      expect(res.body.current).toMatchObject({ value: { given: values[3], family: values[4] }, version: 2 });
      const [correction] = await h.scratch.owner<
        {
          kind: string;
          field: string;
          oldValue: unknown;
          newValue: unknown;
          reason: string;
          historyId: string;
        }[]
      >`
        select c.kind, c.field, c.old_value as "oldValue", c.new_value as "newValue", c.reason,
               h.kind as "historyId"
        from sineobex.patient_corrections c join sineobex.field_history h on h.id = c.history_id
        where c.patient_id = ${p.id}`;
      expect(correction).toEqual({
        kind: 'review_decision',
        field: 'legalName',
        oldValue: { given: values[3], family: null },
        newValue: { given: values[3], family: values[4] },
        reason: 'Checked the ID card',
        historyId: 'review_decided',
      });
      const [decided] = await expectAudit(h, 'field_review.decided', { after: mark, count: 1 });
      expect(decided!.details).toMatchObject({ correctionId: expect.any(String), version: 2 });
    });
  });

  it('keeps every recorded value out of audit details and log lines', async () => {
    await expectAuditClean(h, values);
    logs.expectClean(values);
  });
});
