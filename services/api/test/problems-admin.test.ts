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

// Resolved back to Ongoing: admin only, entered in error, then the offer to merge the two entries
// (phase 3 design 3.3, 9.4; D36).

describe('problem admin', () => {
  let h: Harness;
  let teamId: string;
  let admin: Member;
  let adminEmail: string;
  let clinician: Member;
  let billing: Member;
  let noSensitive: Member;
  const logs = logSpy();
  const reason = 'Never healed, seen at every visit';

  const ADMIN: Permission[] = [
    'patients.view',
    'patients.edit',
    'patients.reverse_resolved',
    'patients.view_sensitive',
    'encounters.chart',
  ];

  beforeAll(async () => {
    h = await createHarness({ log: logs.log });
    teamId = await createTeam(h, 'Problem Team (demo)');
    adminEmail = `admin-${randomUUID().slice(0, 8)}@example.com`;
    admin = await memberWith(h, teamId, ADMIN, { email: adminEmail, displayName: 'Alex (demo)' });
    clinician = await memberWith(h, teamId, ['patients.view', 'patients.edit', 'encounters.chart'], {
      displayName: 'Jordan (demo)',
    });
    billing = await memberWith(h, teamId, ['patients.view', 'billing.view_codes', 'exports.billing']);
    noSensitive = await memberWith(h, teamId, [
      'patients.view',
      'patients.reverse_resolved',
      'encounters.chart',
    ]);
  });
  afterAll(() => h.close());

  type Status = 'new' | 'ongoing' | 'resolved';

  /**
   * A problem as sync leaves it (design 1.3, 9.2): the status history as field_history rows on
   * (problem, status), the current status and its bookkeeping on the row.
   */
  async function createProblem(
    patientId: string,
    o: {
      title?: string;
      code?: string;
      statuses?: { status: Status; at: string }[];
      sensitive?: boolean;
      resolvedInErrorOf?: string;
      recurrenceOf?: string;
      by?: Member;
      createdAt?: string;
      notes?: string[];
    } = {},
  ): Promise<string> {
    const sql = h.scratch.owner;
    const id = randomUUID();
    const by = (o.by ?? clinician).userId;
    const statuses = o.statuses ?? [{ status: 'new', at: '2026-10-01T10:00:00Z' }];
    const current = statuses.at(-1)!;
    const createdAt = o.createdAt ?? statuses[0]!.at;
    await sql`
      insert into sineobex.problems (id, team_id, patient_id, title, code_system, code, code_display, sensitive,
        status, status_changed_at, status_changed_by, status_checked_at, recurrence_of, resolved_in_error_of,
        reversal_request, author_user_id, field_versions, field_meta, version, created_at)
      values (${id}, ${teamId}, ${patientId}, ${o.title ?? 'Burn, left forearm'}, ${o.code ? 'icd10cm' : null},
        ${o.code ?? null}, ${o.code ? 'Demo code display' : null}, ${o.sensitive ?? false}, ${current.status},
        ${current.at}, ${by}, ${current.at}, ${o.recurrenceOf ?? null}, ${o.resolvedInErrorOf ?? null},
        ${o.resolvedInErrorOf ? 'open' : null}, ${by}, ${sql.json({ status: statuses.length })},
        ${sql.json({ status: { by, at: current.at, changeId: null } })}, ${statuses.length}, ${createdAt})`;
    for (const [i, s] of statuses.entries()) {
      await sql`
        insert into sineobex.field_history (team_id, entity, record_id, field, version, value, previous_value, kind,
          changed_by, device_time)
        values (${teamId}, 'problem', ${id}, 'status', ${i + 1}, ${sql.json({ status: s.status, encounterId: null })},
          ${i === 0 ? null : sql.json({ status: statuses[i - 1]!.status, encounterId: null })},
          ${i === 0 ? 'created' : 'set'}, ${by}, ${s.at})`;
    }
    for (const [i, text] of (o.notes ?? []).entries()) {
      await sql`
        insert into sineobex.problem_notes (id, team_id, problem_id, text, written_at, author_user_id)
        values (${randomUUID()}, ${teamId}, ${id}, ${text}, ${new Date(Date.parse(createdAt) + i * 60_000)}, ${by})`;
    }
    return id;
  }

  /** A problem resolved on Oct 5, and a worker's "Resolved by mistake" entry for it on Oct 12. */
  async function withRequest(o: { sensitive?: boolean; code?: string } = {}) {
    const patient = await createPatient(h, teamId, clinician.userId);
    const original = await createProblem(patient.id, {
      code: o.code ?? 'T22.112A',
      sensitive: o.sensitive,
      statuses: [
        { status: 'new', at: '2026-10-01T10:00:00Z' },
        { status: 'resolved', at: '2026-10-05T10:00:00Z' },
      ],
      notes: ['Demo note: dressing changed'],
    });
    const request = await createProblem(patient.id, {
      code: o.code ?? 'T22.112A',
      sensitive: o.sensitive,
      resolvedInErrorOf: original,
      statuses: [{ status: 'new', at: '2026-10-12T10:00:00Z' }],
      notes: ['Demo note: still weeping'],
    });
    return { patientId: patient.id, original, request };
  }

  interface ProblemView {
    id: string;
    patientId: string;
    status: Status;
    reversalRequest: string | null;
    mergedInto: string | null;
    statusHistory: { problemId: string; status: Status; kind: string; by: { userId: string } }[];
    notes: { problemId: string; text: string }[];
  }
  type Body = ProblemView & {
    problem: ProblemView;
    mergeCandidates: ProblemView[];
    requests: { request: ProblemView; original: ProblemView; patientId: string }[];
    error?: { code: string; details?: Record<string, unknown> };
  };

  const call = async (path: string, by: Member, json?: unknown) => {
    const res = await h.request(path, {
      method: json === undefined ? 'GET' : 'POST',
      token: by.token,
      teamId,
      ...(json === undefined ? {} : { json }),
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
    return { status: res.status, body: (await res.json()) as Body };
  };
  const reverse = (id: string, by: Member, body: Record<string, unknown> = { reason }) =>
    call(`/v1/problems/${id}/reverse`, by, body);
  const decline = (id: string, by: Member = admin) =>
    call(`/v1/team/problem-reversals/${id}/decline`, by, { reason: 'Healed; this is a new burn' });
  const merge = (id: string, into: string, by: Member = admin) =>
    call(`/v1/problems/${id}/merge`, by, { intoProblemId: into, comment: 'Same burn, one entry' });

  const row = async (id: string) =>
    (
      await h.scratch.owner<
        {
          status: Status;
          reversalRequest: string | null;
          mergedInto: string | null;
          statusChangedBy: string;
        }[]
      >`
        select status, reversal_request as "reversalRequest", merged_into as "mergedInto",
               status_changed_by as "statusChangedBy"
        from sineobex.problems where id = ${id}`
    )[0]!;
  const noticesFor = async (userId: string, recordId: string) =>
    (
      await h.scratch.owner<{ kind: string }[]>`
        select kind from sineobex.user_notices where user_id = ${userId} and record_id = ${recordId}`
    ).map((r) => r.kind);

  describe('reverse', () => {
    it('sets a Resolved problem back to Ongoing as entered in error, with a reason, and offers the merge', async () => {
      const { patientId, original, request } = await withRequest();
      // Added after the resolution with the same code: offered too, after the request.
      const sameCode = await createProblem(patientId, {
        code: 'T22.112A',
        title: 'Burn of left forearm',
        statuses: [{ status: 'ongoing', at: '2026-10-08T10:00:00Z' }],
      });
      const unrelated = await createProblem(patientId, {
        code: 'L03.114',
        title: 'Cellulitis, left arm',
        statuses: [{ status: 'new', at: '2026-10-09T10:00:00Z' }],
      });
      const mark = await auditMark(h);
      const res = await reverse(original, admin, { reason, requestProblemId: request });
      expect(res.status).toBe(200);
      expect(res.body.problem).toMatchObject({ id: original, patientId, status: 'ongoing' });
      expect(res.body.problem.statusHistory.map((e) => [e.status, e.kind])).toEqual([
        ['new', 'created'],
        ['resolved', 'set'],
        ['ongoing', 'entered_in_error'],
      ]);
      expect(res.body.mergeCandidates.map((p) => p.id)).toEqual([request, sameCode]);
      expect(res.body.mergeCandidates.map((p) => p.id)).not.toContain(unrelated);

      expect(await row(original)).toMatchObject({ status: 'ongoing', statusChangedBy: admin.userId });
      // Both entries are kept; the request is answered.
      expect(await row(request)).toMatchObject({
        status: 'new',
        reversalRequest: 'reversed',
        mergedInto: null,
      });
      const [history] = await h.scratch.owner<
        { value: unknown; previousValue: unknown; changedBy: string; approvedBy: string; version: number }[]
      >`
        select value, previous_value as "previousValue", changed_by as "changedBy", approved_by as "approvedBy", version
        from sineobex.field_history where record_id = ${original} and kind = 'entered_in_error'`;
      expect(history).toEqual({
        value: { status: 'ongoing', encounterId: null },
        previousValue: { status: 'resolved', encounterId: null },
        changedBy: admin.userId,
        approvedBy: admin.userId,
        version: 3,
      });
      const [correction] = await h.scratch.owner<{ kind: string; reason: string; decidedBy: string }[]>`
        select kind, reason, decided_by as "decidedBy" from sineobex.patient_corrections where record_id = ${original}`;
      expect(correction).toEqual({ kind: 'problem_reversal', reason, decidedBy: admin.userId });
      expect(await noticesFor(clinician.userId, request)).toEqual(['problem_reversal_decided']);
      const [event] = await expectAudit(h, 'problem.reversed', { after: mark, patientId, count: 1 });
      expect(event!.details).toMatchObject({
        historyId: expect.any(String),
        correctionId: expect.any(String),
        requestIds: [request],
        commentSha256: expect.any(String),
      });
    });

    it('answers every open request when reversed from the patient page', async () => {
      const { original, request } = await withRequest();
      expect((await reverse(original, admin)).status).toBe(200);
      expect(await row(request)).toMatchObject({ reversalRequest: 'reversed' });
      expect(await noticesFor(clinician.userId, request)).toEqual(['problem_reversal_decided']);
    });

    it('refuses a problem that isn’t Resolved, and a request that isn’t for it', async () => {
      const { original, request } = await withRequest();
      const notOne = await withRequest();
      const wrong = await reverse(original, admin, { reason, requestProblemId: notOne.request });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error?.code).toBe('not_a_request');
      expect((await reverse(original, admin)).status).toBe(200);
      const again = await reverse(original, admin);
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({ code: 'not_resolved', details: { version: 3 } });
      expect(await row(request)).toMatchObject({ reversalRequest: 'reversed' });
    });

    it('needs a recent sign-in, and patients.reverse_resolved (refusal logged)', async () => {
      const { original } = await withRequest();
      const stale = {
        ...admin,
        token: await h.tokenFor(adminEmail, { authTime: new Date(h.clock.now.getTime() - 3600_000) }),
      };
      const old = await reverse(original, stale);
      expect(old.status).toBe(403);
      expect(old.body.error?.code).toBe('reauth_required');
      for (const who of [clinician, billing]) {
        const mark = await auditMark(h);
        expect((await reverse(original, who)).status).toBe(403);
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ permission: 'patients.reverse_resolved' });
      }
      expect(await row(original)).toMatchObject({ status: 'resolved' });
    });

    it('answers a sensitive problem like a missing one for a role without sensitive details', async () => {
      const { original, request } = await withRequest({ sensitive: true, code: 'F10.20' });
      expect((await reverse(original, noSensitive)).status).toBe(404);
      expect((await reverse(randomUUID(), noSensitive)).status).toBe(404);
      expect((await decline(request, noSensitive)).status).toBe(404);
      expect((await reverse(original, admin)).status).toBe(200);
    });
  });

  describe('decline', () => {
    it('keeps the request as a separate problem, with the reason, and tells the requester', async () => {
      const { patientId, original, request } = await withRequest();
      const mark = await auditMark(h);
      const res = await decline(request);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: request,
        status: 'new',
        reversalRequest: 'declined',
        mergedInto: null,
      });
      expect(await row(original)).toMatchObject({ status: 'resolved' });
      const [correction] = await h.scratch.owner<{ kind: string; reason: string }[]>`
        select kind, reason from sineobex.patient_corrections where record_id = ${request}`;
      expect(correction).toEqual({ kind: 'reversal_declined', reason: 'Healed; this is a new burn' });
      expect(await noticesFor(clinician.userId, request)).toEqual(['problem_reversal_decided']);
      const [event] = await expectAudit(h, 'problem.reversal_declined', { after: mark, patientId, count: 1 });
      expect(event!.details).toMatchObject({ correctionId: expect.any(String), originalId: original });

      const again = await decline(request);
      expect(again.status).toBe(409);
      expect(again.body.error?.code).toBe('already_decided');
      // A problem that was never a request isn't one now.
      expect((await decline(original)).status).toBe(404);
    });
  });

  describe('merge', () => {
    it('absorbs the request into the original after a reversal: one timeline, both kept', async () => {
      const { patientId, original, request } = await withRequest();
      expect((await reverse(original, admin, { reason, requestProblemId: request })).status).toBe(200);
      const mark = await auditMark(h);
      const res = await merge(request, original);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(original);
      expect(res.body.statusHistory.map((e) => [e.problemId, e.status])).toEqual([
        [original, 'new'],
        [original, 'resolved'],
        [request, 'new'],
        [original, 'ongoing'],
      ]);
      expect(res.body.notes.map((n) => [n.problemId, n.text])).toEqual([
        [request, 'Demo note: still weeping'],
        [original, 'Demo note: dressing changed'],
      ]);
      expect(await row(request)).toMatchObject({ mergedInto: original, status: 'new' });
      const [event] = await expectAudit(h, 'problem.merged', { after: mark, patientId, count: 1 });
      expect(event!.details).toMatchObject({
        mergedId: request,
        intoId: original,
        correctionId: expect.any(String),
      });
      const [correction] = await h.scratch.owner<{ field: string; reason: string }[]>`
        select field, reason from sineobex.patient_corrections where id = ${event!.details.correctionId as string}`;
      expect(correction).toEqual({ field: 'mergedInto', reason: 'Same burn, one entry' });

      // Merged once: it can't be merged or reversed again.
      expect((await merge(request, original)).body.error?.code).toBe('problem_merged');
    });

    it('refuses an open request, another patient’s entry, and itself', async () => {
      const { original, request } = await withRequest();
      const open = await merge(request, original);
      expect(open.status).toBe(409);
      expect(open.body.error?.code).toBe('reversal_open');
      const elsewhere = await withRequest();
      const otherPatient = await merge(elsewhere.request, original);
      expect(otherPatient.status).toBe(409);
      expect(otherPatient.body.error?.code).toBe('different_patient');
      expect((await merge(original, original)).status).toBe(422);
      expect((await merge(original, randomUUID())).status).toBe(404);
    });

    it('moves entries already merged into the absorbed one, so none points at a merged entry', async () => {
      const patient = await createPatient(h, teamId, clinician.userId);
      const a = await createProblem(patient.id, { title: 'Cough' });
      const b = await createProblem(patient.id, { title: 'Cough' });
      const c = await createProblem(patient.id, { title: 'Cough' });
      expect((await merge(a, b)).status).toBe(200);
      expect((await merge(b, c)).status).toBe(200);
      expect(await row(a)).toMatchObject({ mergedInto: c });
      expect(await row(b)).toMatchObject({ mergedInto: c });
    });
  });

  // Waits on S2: each request carries the patient's summary (loadSummaries, projectSummary).
  describe('the queue', () => {
    it('lists open requests beside their original, hiding sensitive ones from a role without them', async () => {
      const plain = await withRequest();
      const sensitive = await withRequest({ sensitive: true, code: 'F10.20' });
      const mark = await auditMark(h);
      const res = await call('/v1/team/problem-reversals', admin);
      expect(res.status).toBe(200);
      const mine = res.body.requests.filter((r) => [plain.request, sensitive.request].includes(r.request.id));
      expect(mine.map((r) => [r.request.id, r.original.id, r.patientId])).toEqual([
        [plain.request, plain.original, plain.patientId],
        [sensitive.request, sensitive.original, sensitive.patientId],
      ]);
      await expectAudit(h, 'problem.reversals_viewed', { after: mark, count: 1 });
      await expectAudit(h, 'patient.viewed', { after: mark, patientId: plain.patientId, count: 1 });

      const limited = await call('/v1/team/problem-reversals', noSensitive);
      expect(limited.status).toBe(200);
      const ids = limited.body.requests.map((r) => r.request.id);
      expect(ids).toContain(plain.request);
      expect(ids).not.toContain(sensitive.request);
    });
  });

  it('keeps reasons and comments out of audit details and log lines', async () => {
    const terms = [reason, 'Healed; this is a new burn', 'Same burn, one entry', 'Demo note'];
    await expectAuditClean(h, terms);
    logs.expectClean(terms);
  });
});
