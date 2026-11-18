import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assignmentRows,
  chartedVisit,
  createWorld,
  eventsAfter,
  finish,
  noteRow,
  noticesOf,
  post,
  removeMember,
  SECRETS,
  setCredential,
  staleToken,
  TEST_MEDICAL_EXAM_TYPE,
  whileTeamLocked,
  WITH_EXAM,
  type ChartedVisit,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import type { Credential } from '../src/auth/permissions.ts';
import { clinician, signoffOf, type Clinician, type Json } from './sync-fixtures.ts';

// POST /v1/notes/{noteId}/assign (lifecycle 3.8, 5.5, PRD main 461): a Program Admin puts another
// clinician in the place of a note's author who has left the team. team.manage_users and a recent
// sign-in. Checked by mayAssign: the acting author is no longer an active member (409
// author_active); the assignee is an active member with encounters.chart, whose credential's rank
// is at least the one the note was signed under, or for an unsigned note its author's last
// (422 credential_too_low), and who could see every answer of the note (422 cannot_see_all). Then a
// note_assignments row, the note's assigned_user_id, note.assigned and a notice to the assignee.
// Every person and value is made up.

const REASON = 'Demo: the author left the program';

describe('phase 4: assign a note', () => {
  let h: Harness;
  let w: World;
  let count = 0;

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
  });
  afterAll(() => h.close());

  const assign = (noteId: string, toUserId: string, token = w.t.adminToken, reason = REASON) =>
    post(w, token, `/v1/notes/${noteId}/assign`, { toUserId, reason });

  /** A clinician who charts a Medical visit and then leaves the team. */
  async function departed(
    credential: Credential,
    o: { type?: typeof TEST_MEDICAL_EXAM_TYPE; answers?: Record<string, unknown> } = {},
  ) {
    const n = ++count;
    const c = await clinician(h, w.t, `left-${n}@example.com`, `Left ${n} (demo)`, credential);
    const v = await chartedVisit(w, c, o.type, o.answers);
    return { c, v };
  }
  const gone = (c: Clinician) => removeMember(w, c.membershipId);
  const unassigned = async (v: ChartedVisit) => {
    expect((await noteRow(h, v.note.noteId)).assignedUserId).toBeNull();
    expect(await assignmentRows(h, v.note.noteId)).toEqual([]);
  };

  describe('who may assign', () => {
    it('needs team.manage_users: a role without it is refused, and the refusal is logged', async () => {
      const { c, v } = await departed('resident');
      await gone(c);
      const mark = await auditMark(h);
      const r = await assign(v.note.noteId, w.nia.id, w.ana.token);
      expect(r.status).toBe(403);
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ permission: 'team.manage_users' });
      await unassigned(v);
    });

    it('needs a recent sign-in', async () => {
      const { c, v } = await departed('resident');
      await gone(c);
      const r = await assign(v.note.noteId, w.nia.id, await staleToken(h, 'admin@example.com'));
      expect(r.status).toBe(403);
      expect((r.body as Json).error?.code).toBe('reauth_required');
      await unassigned(v);
    });
  });

  describe('what is refused, and how', () => {
    it('a note whose acting author is still an active member: 409 author_active', async () => {
      const v = await chartedVisit(w, w.rae);
      const r = await assign(v.note.noteId, w.nia.id);
      expect(r.status).toBe(409);
      expect((r.body as Json).error?.code).toBe('author_active');
      await unassigned(v);
    });

    it('an assignee who is not an active member, or who does not chart: 422', async () => {
      const { c, v } = await departed('resident');
      const { c: other } = await departed('np');
      await gone(c);
      await gone(other);
      for (const [to, code] of [
        [other.id, 'assignee_not_member'],
        [randomUUID(), 'assignee_not_member'],
        [w.bea.id, 'assignee_cannot_chart'],
        [w.kim.id, 'assignee_cannot_chart'],
      ] as [string, string][]) {
        const r = await assign(v.note.noteId, to);
        expect(r.status, code).toBe(422);
        expect((r.body as Json).error?.code).toBe(code);
      }
      await unassigned(v);
    });

    it('an unsigned note needs the rank of its author’s last credential', async () => {
      // A resident (rank 3) drafted it: a student (2) is too low, an NP (3) is not.
      const { c, v } = await departed('resident');
      await gone(c);
      const low = await assign(v.note.noteId, w.sol.id);
      expect(low.status).toBe(422);
      expect((low.body as Json).error?.code).toBe('credential_too_low');
      await unassigned(v);
      expect((await assign(v.note.noteId, w.nia.id)).status).toBe(200);
    });

    it('a signed note needs the rank it was signed under, not the author’s credential since', async () => {
      // Signed by an attending (rank 4): an NP is too low, an attending is not.
      const a = await departed('attending');
      await finish(a.c, [a.v.flags, 'sign', 'signed'], [a.v.note, 'sign', 'signed']);
      await gone(a.c);
      const low = await assign(a.v.note.noteId, w.nia.id);
      expect(low.status).toBe(422);
      expect((low.body as Json).error?.code).toBe('credential_too_low');
      expect((await assign(a.v.note.noteId, w.ana.id)).status).toBe(200);

      // Signed as a resident (rank 3), then promoted to attending before leaving: an NP may take it.
      const r = await departed('resident');
      await finish(r.c, [r.v.flags, 'sign', 'signed'], [r.v.note, 'sign', 'signed']);
      await setCredential(h, w.t, r.c.membershipId, 'attending');
      await gone(r.c);
      expect((await assign(r.v.note.noteId, w.nia.id)).status).toBe(200);
    });

    it('a note with an answer the assignee could not see: 422 cannot_see_all', async () => {
      // Ana's role holds no patients.view_sensitive_exams; Vic's does.
      const { c, v } = await departed('attending', { type: TEST_MEDICAL_EXAM_TYPE, answers: WITH_EXAM });
      await gone(c);
      const r = await assign(v.note.noteId, w.ana.id);
      expect(r.status).toBe(422);
      expect((r.body as Json).error?.code).toBe('cannot_see_all');
      await unassigned(v);
      expect((await assign(v.note.noteId, w.vic.id)).status).toBe(200);
    });

    it('a note the team does not have is 404; a reason too short or too long is 422', async () => {
      expect((await assign(randomUUID(), w.nia.id)).status).toBe(404);
      const { c, v } = await departed('resident');
      await gone(c);
      for (const reason of ['no', 'x'.repeat(501)]) {
        expect((await assign(v.note.noteId, w.nia.id, w.t.adminToken, reason)).status).toBe(422);
      }
      await unassigned(v);
    });
  });

  describe('what an assignment writes, and what it changes', () => {
    it('a row, the note’s assignee, one event with no reason in it, and a notice to the assignee', async () => {
      const { c, v } = await departed('resident');
      await gone(c);
      const mark = await auditMark(h);
      const r = await assign(v.note.noteId, w.nia.id);
      expect(r.status).toBe(200);
      expect(await assignmentRows(h, v.note.noteId)).toEqual([
        expect.objectContaining({
          teamId: w.t.teamId,
          noteId: v.note.noteId,
          fromUserId: c.id,
          toUserId: w.nia.id,
          assignedBy: w.t.adminId,
          reason: REASON,
        }),
      ]);
      expect(await noteRow(h, v.note.noteId)).toMatchObject({
        assignedUserId: w.nia.id,
        authorUserId: c.id,
        status: 'draft',
      });
      const [event] = await expectAudit(h, 'note.assigned', { after: mark, count: 1 });
      expect(event).toMatchObject({
        entity: 'encounter_note',
        entityId: v.note.noteId,
        patientId: w.patientId,
      });
      expect(event!.details).toEqual({ fromUserId: c.id, toUserId: w.nia.id });
      expect((await eventsAfter(h, mark)).map((e) => e.action)).toEqual(['note.assigned']);
      expect(await noticesOf(h, w.nia.id, 'note_assigned')).toEqual([
        { entity: 'encounter_note', recordId: v.note.noteId },
      ]);
      await expectAuditClean(h, [...SECRETS, REASON], mark);
    });

    it('the assignee then acts as the author: completes the draft under their own credential (PLAN-OPEN 12.1 #7)', async () => {
      const { c, v } = await departed('resident');
      await gone(c);
      expect((await assign(v.note.noteId, w.nia.id)).status).toBe(200);
      // The visit's Red flags note is hers too, so she can finish the visit.
      expect((await assign(v.flags.noteId, w.nia.id)).status).toBe(200);
      const signs = [await signoffOf(w.nia, v.flags, 'sign'), await signoffOf(w.nia, v.note, 'sign')];
      expect((await w.nia.send(...signs)).map((r) => r.details?.effect)).toEqual(['signed', 'signed']);
      expect(await noteRow(h, v.note.noteId)).toMatchObject({ status: 'signed', attestation: 'waiting' });
    });

    it('a note whose assignee is active is theirs: assigning it again is 409 author_active', async () => {
      const { c, v } = await departed('resident');
      await gone(c);
      expect((await assign(v.note.noteId, w.nia.id)).status).toBe(200);
      const again = await assign(v.note.noteId, w.rae.id);
      expect(again.status).toBe(409);
      expect((again.body as Json).error?.code).toBe('author_active');
      // Once the assignee leaves too, the note passes on, from them.
      const nina = await clinician(h, w.t, 'nina@example.com', 'Nina (demo)', 'np');
      const { c: c2, v: v2 } = await departed('resident');
      await gone(c2);
      expect((await assign(v2.note.noteId, nina.id)).status).toBe(200);
      await gone(nina);
      expect((await assign(v2.note.noteId, w.rae.id)).status).toBe(200);
      expect((await assignmentRows(h, v2.note.noteId)).map((a) => [a.fromUserId, a.toUserId])).toEqual([
        [c2.id, nina.id],
        [nina.id, w.rae.id],
      ]);
    });

    it('takes the team lock before it locks the note', async () => {
      const { c, v } = await departed('resident');
      await gone(c);
      const run = await whileTeamLocked(h, w.t.teamId, () => assign(v.note.noteId, w.nia.id));
      expect(run.waited).toBe(true);
      expect(run.rowLocks).toBe(0);
      expect(run.answer.status).toBe(200);
    });
  });
});
