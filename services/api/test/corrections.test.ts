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
  mergeDirect,
  type Member,
} from './patient-fixtures.ts';

// Admin corrections of a legal name or birth date, with a reason, and declined amendment requests
// (HIPAA §164.526): phase 3 design 3.2, 11.6.

describe('identity corrections', () => {
  let h: Harness;
  let teamId: string;
  let admin: Member;
  let adminEmail: string;
  let editor: Member;
  const logs = logSpy();
  const names = ['Delbert', 'Smith-Demo', 'Delbart'] as const;
  const reason = 'Patient showed a state ID';

  const ADMIN: Permission[] = ['patients.view', 'patients.edit', 'patients.correct_identity'];

  beforeAll(async () => {
    h = await createHarness({ log: logs.log });
    teamId = await createTeam(h, 'Correction Team (demo)');
    adminEmail = `admin-${randomUUID().slice(0, 8)}@example.com`;
    admin = await memberWith(h, teamId, ADMIN, { email: adminEmail, displayName: 'Alex (demo)' });
    editor = await memberWith(h, teamId, ['patients.view', 'patients.edit']);
  });
  afterAll(() => h.close());

  const correct = async (patientId: string, body: Record<string, unknown>, by: Member = admin) => {
    const res = await h.request(`/v1/patients/${patientId}/corrections`, {
      method: 'POST',
      token: by.token,
      teamId,
      json: { reason, requestedByPatient: false, outcome: 'corrected', ...body },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    return {
      status: res.status,
      text,
      body: JSON.parse(text) as {
        canonicalId: string;
        patient: { fields: Record<string, { value: unknown; version: number }> };
        error?: { code: string; details?: Record<string, unknown> };
      },
    };
  };

  const legal = async (id: string) =>
    (
      await h.scratch.owner<{ given: string | null; family: string | null; version: number }[]>`
        select legal_given_name as given, legal_family_name as family,
               (field_versions ->> 'legalName')::int as version
        from sineobex.patients where id = ${id}`
    )[0]!;
  const corrections = (id: string) =>
    h.scratch.owner<
      {
        kind: string;
        field: string;
        oldValue: unknown;
        newValue: unknown;
        reason: string;
        requestedByPatient: boolean;
        historyKind: string | null;
      }[]
    >`
      select c.kind, c.field, c.old_value as "oldValue", c.new_value as "newValue", c.reason,
             c.requested_by_patient as "requestedByPatient", h.kind as "historyKind"
      from sineobex.patient_corrections c left join sineobex.field_history h on h.id = c.history_id
      where c.patient_id = ${id} order by c.decided_at, c.id`;

  describe('refusals that never reach the chart', () => {
    it('answers a stale baseVersion with 409 field_changed and the version, never the value', async () => {
      const p = await createPatient(h, teamId, admin.userId, {
        legalName: { given: names[0], family: null },
      });
      const res = await correct(p.id, {
        field: 'legalName',
        value: { given: names[0], family: names[1] },
        baseVersion: 0,
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'field_changed',
        details: { field: 'legalName', version: 1 },
      });
      for (const n of names) expect(res.text).not.toContain(n);
      expect(await legal(p.id)).toEqual({ given: names[0], family: null, version: 1 });
    });

    it('refuses a birth date in the future, a decline nobody asked for, and a patient the team doesn’t have', async () => {
      const p = await createPatient(h, teamId, admin.userId, { birth: { precision: 'year', year: 1946 } });
      const future = await correct(p.id, {
        field: 'birth',
        value: { precision: 'day', date: '2027-01-01' },
        baseVersion: 1,
      });
      expect(future.status).toBe(422);
      expect(future.body.error?.code).toBe('birth_in_future');
      const unasked = await correct(p.id, {
        field: 'birth',
        value: { precision: 'year', year: 1947 },
        baseVersion: 1,
        outcome: 'declined',
      });
      expect(unasked.status).toBe(422);
      const missing = await correct(randomUUID(), {
        field: 'birth',
        value: { precision: 'year', year: 1947 },
        baseVersion: 1,
      });
      expect(missing.status).toBe(404);
      expect(await corrections(p.id)).toEqual([]);
    });

    it('needs patients.correct_identity (refusal logged) and a recent sign-in', async () => {
      const p = await createPatient(h, teamId, admin.userId);
      const body = { field: 'birth', value: { precision: 'year', year: 1946 }, baseVersion: 1 };
      const mark = await auditMark(h);
      expect((await correct(p.id, body, editor)).status).toBe(403);
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ permission: 'patients.correct_identity' });
      const stale = {
        ...admin,
        token: await h.tokenFor(adminEmail, { authTime: new Date(h.clock.now.getTime() - 3600_000) }),
      };
      const old = await correct(p.id, body, stale);
      expect(old.status).toBe(403);
      expect(old.body.error?.code).toBe('reauth_required');
    });
  });

  /** The sources of the pair, if any, matching has flagged for these two patients. */
  const pairSources = async (a: string, b: string) =>
    (
      await h.scratch.owner<{ sources: string[] }[]>`
        select sources from sineobex.duplicate_pairs
        where (patient_a, patient_b) = (least(${a}::uuid, ${b}::uuid), greatest(${a}::uuid, ${b}::uuid))`
    )[0]?.sources ?? null;

  describe('corrections and declined amendments', () => {
    it('corrects a legal name: history `corrected` with old and new, a correction row, reviews closed', async () => {
      const p = await createPatient(h, teamId, editor.userId, {
        preferredName: 'Smitty Demo',
        legalName: { given: names[0], family: names[1] },
        birth: { precision: 'day', date: '1946-03-07' },
      });
      // Someone matching would pair with this chart; nothing has run matching on it yet.
      const twin = await createPatient(h, teamId, editor.userId, {
        preferredName: 'Smitty Demo',
        legalName: { given: names[0], family: null },
        birth: { precision: 'day', date: '1946-03-07' },
      });
      expect(await pairSources(p.id, twin.id)).toBeNull();
      const reviewId = randomUUID();
      await h.scratch.owner`
        insert into sineobex.field_reviews (id, team_id, patient_id, entity, record_id, field, needs)
        values (${reviewId}, ${teamId}, ${p.id}, 'patient', ${p.id}, 'legalName', 'patients.correct_identity')`;
      const mark = await auditMark(h);
      const res = await correct(p.id, {
        field: 'legalName',
        value: { given: names[0], family: null },
        baseVersion: 1,
        requestedByPatient: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.canonicalId).toBe(p.id);
      expect(await legal(p.id)).toEqual({ given: names[0], family: null, version: 2 });
      const [history] = await h.scratch.owner<
        { value: unknown; previousValue: unknown; changedBy: string; approvedBy: string }[]
      >`
        select value, previous_value as "previousValue", changed_by as "changedBy", approved_by as "approvedBy"
        from sineobex.field_history where record_id = ${p.id} and kind = 'corrected'`;
      expect(history).toEqual({
        value: { given: names[0], family: null },
        previousValue: { given: names[0], family: names[1] },
        changedBy: admin.userId,
        approvedBy: admin.userId,
      });
      expect(await corrections(p.id)).toEqual([
        {
          kind: 'identity',
          field: 'legalName',
          oldValue: { given: names[0], family: names[1] },
          newValue: { given: names[0], family: null },
          reason,
          requestedByPatient: true,
          historyKind: 'corrected',
        },
      ]);
      const [review] = await h.scratch.owner<{ status: string; decision: { kept: string } }[]>`
        select status, decision from sineobex.field_reviews where id = ${reviewId}`;
      expect(review).toMatchObject({ status: 'decided', decision: { kept: 'corrected' } });
      const [event] = await expectAudit(h, 'patient.identity_corrected', {
        after: mark,
        patientId: p.id,
        count: 1,
      });
      expect(event!.details).toMatchObject({
        field: 'legalName',
        version: 2,
        correctionId: expect.any(String),
        requestedByPatient: true,
      });
      // Matching ran again, as a correction.
      expect(await pairSources(p.id, twin.id)).toEqual(['correction']);
    });

    it('records a declined amendment request with the requested value, the chart unchanged', async () => {
      const p = await createPatient(h, teamId, editor.userId, {
        legalName: { given: names[0], family: null },
      });
      const mark = await auditMark(h);
      const res = await correct(p.id, {
        field: 'legalName',
        value: { given: names[2], family: null },
        baseVersion: 1,
        requestedByPatient: true,
        outcome: 'declined',
        reason: 'Records show the current spelling',
      });
      expect(res.status).toBe(200);
      expect(await legal(p.id)).toEqual({ given: names[0], family: null, version: 1 });
      expect(await corrections(p.id)).toEqual([
        {
          kind: 'amendment_declined',
          field: 'legalName',
          oldValue: { given: names[0], family: null },
          newValue: { given: names[2], family: null },
          reason: 'Records show the current spelling',
          requestedByPatient: true,
          historyKind: null,
        },
      ]);
      const [event] = await expectAudit(h, 'patient.amendment_declined', {
        after: mark,
        patientId: p.id,
        count: 1,
      });
      expect(event!.details).toMatchObject({ field: 'legalName', correctionId: expect.any(String) });
      await expectAudit(h, 'patient.identity_corrected', { after: mark, count: 0 });
    });

    it('treats the value already on the chart as a no-op', async () => {
      const p = await createPatient(h, teamId, editor.userId, { birth: { precision: 'year', year: 1946 } });
      const res = await correct(p.id, {
        field: 'birth',
        value: { precision: 'year', year: 1946 },
        baseVersion: 1,
      });
      expect(res.status).toBe(200);
      expect(await corrections(p.id)).toEqual([]);
    });

    it('corrects the kept chart when given a merged ID', async () => {
      const survivor = await createPatient(h, teamId, editor.userId, {
        birth: { precision: 'estimated', year: 1980 },
      });
      const merged = await createPatient(h, teamId, editor.userId);
      await mergeDirect(h, teamId, merged.id, survivor.id, admin.userId);
      const res = await correct(merged.id, {
        field: 'birth',
        value: { precision: 'day', date: '1979-03-07' },
        baseVersion: 1,
      });
      expect(res.status).toBe(200);
      expect(res.body.canonicalId).toBe(survivor.id);
      const [row] = await h.scratch.owner<{ birthDate: string }[]>`
        select birth_date::text as "birthDate" from sineobex.patients where id = ${survivor.id}`;
      expect(row!.birthDate).toBe('1979-03-07');
    });
  });

  it('keeps names, dates and reasons out of audit details and log lines', async () => {
    const terms = [...names, reason, 'Records show the current spelling', '1979-03-07'];
    await expectAuditClean(h, terms);
    logs.expectClean(terms);
  });
});
