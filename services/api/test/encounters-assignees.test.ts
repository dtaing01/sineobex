import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chartedVisit,
  createWorld,
  eventsAfter,
  expectNoneOf,
  finish,
  get,
  noteRow,
  post,
  removeMember,
  roleWith,
  SECRETS,
  staleToken,
  TEST_MEDICAL_EXAM_TYPE,
  WITH_EXAM,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import type { Credential } from '../src/auth/permissions.ts';
import { addMember, clinician, type Json } from './sync-fixtures.ts';

// GET /v1/notes/{noteId}/assignees (lifecycle 3.8, 5.5, 9.12; unit L6): who may be put in the place
// of a note's author who has left the team, so the portal's picker lists exactly the people the
// assign route takes and holds no copy of its rule. mayAssign, the route's own rule, is asked of
// each active member. team.manage_users; 409 author_active while whoever acts as the author is an
// active member; 404 for a note the team does not have or the caller may not read. Logged as
// note.assignees_viewed on the note, with its patient. Every person and value is made up.

interface Assignee {
  userId: string;
  displayName: string;
  credential: string;
}

describe('phase 4: who may be assigned a note', () => {
  let h: Harness;
  let w: World;
  let count = 0;

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
  });
  afterAll(() => h.close());

  const assignees = (noteId: string, token = w.t.adminToken) =>
    get(w, token, `/v1/notes/${noteId}/assignees`);
  const listed = async (noteId: string) => {
    const r = await assignees(noteId);
    expect(r.status).toBe(200);
    return ((r.body as Json).assignees as Assignee[]).map((a) => a.userId).sort();
  };
  const assign = (noteId: string, toUserId: string) =>
    post(w, w.t.adminToken, `/v1/notes/${noteId}/assign`, { toUserId, reason: 'Demo: the author left' });

  /** A visit charted by a clinician who then left the team. */
  async function departed(
    credential: Credential,
    o: { type?: typeof TEST_MEDICAL_EXAM_TYPE; answers?: Record<string, unknown>; sign?: boolean } = {},
  ) {
    const n = ++count;
    const c = await clinician(h, w.t, `gone-${n}@example.com`, `Gone ${n} (demo)`, credential);
    const v = await chartedVisit(w, c, o.type, o.answers);
    if (o.sign) await finish(c, [v.flags, 'sign', 'signed'], [v.note, 'sign', 'signed']);
    await removeMember(w, c.membershipId);
    return v;
  }

  /** Every active member of the team. */
  const members = async () =>
    (
      await h.scratch.owner<{ userId: string }[]>`
        select user_id as "userId" from sineobex.team_memberships where team_id = ${w.t.teamId} and status = 'active'`
    ).map((m) => m.userId);

  it('needs team.manage_users: a role without it is refused, and the refusal is logged', async () => {
    const v = await departed('resident');
    const mark = await auditMark(h);
    const r = await assignees(v.note.noteId, w.ana.token);
    expect(r.status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
    expect(denied!.details).toMatchObject({ permission: 'team.manage_users' });
  });

  it('is a read, as the list of members is: no recent sign-in asked; the assignment itself asks for one', async () => {
    const v = await departed('resident');
    const r = await assignees(v.note.noteId, await staleToken(h, 'admin@example.com'));
    expect(r.status).toBe(200);
  });

  it('lists exactly the active members the assign route would take, by name and credential', async () => {
    // An unsigned note a resident drafted (rank 3): an attending or an NP who sees all of it may
    // take it; a student is too low; Program Admin's credential (none) is too low; Billing/Data
    // and the CHW preset do not chart; Eli charts without reading a Medical note.
    const v = await departed('resident');
    const ids = await listed(v.note.noteId);
    expect(ids).toEqual([w.ana.id, w.rae.id, w.vic.id, w.nia.id].sort());
    const r = await assignees(v.note.noteId);
    expect(((r.body as Json).assignees as Assignee[]).find((a) => a.userId === w.rae.id)).toEqual({
      userId: w.rae.id,
      displayName: w.rae.displayName,
      credential: 'resident',
    });
    // Each member left out is one the route refuses, and refuses without writing anything.
    for (const id of (await members()).filter((m) => !ids.includes(m))) {
      const refused = await assign(v.note.noteId, id);
      expect(refused.status, id).toBe(422);
    }
    expect((await noteRow(h, v.note.noteId)).assignedUserId).toBeNull();
    // And one listed is taken.
    expect((await assign(v.note.noteId, w.nia.id)).status).toBe(200);
  });

  it('a signed note lists only those of the rank it was signed under, and one with a hidden answer only those who see it', async () => {
    const signed = await departed('attending', { sign: true });
    expect(await listed(signed.note.noteId)).toEqual([w.ana.id, w.vic.id].sort());
    const exam = await departed('attending', { type: TEST_MEDICAL_EXAM_TYPE, answers: WITH_EXAM });
    expect(await listed(exam.note.noteId)).toEqual([w.vic.id]);
  });

  it('a note whose acting author is an active member: 409 author_active, not logged', async () => {
    const v = await chartedVisit(w, w.rae);
    const mark = await auditMark(h);
    const r = await assignees(v.note.noteId);
    expect(r.status).toBe(409);
    expect((r.body as Json).error?.code).toBe('author_active');
    // Assigned to someone active, it is theirs: the same answer.
    const gone = await departed('resident');
    expect((await assign(gone.note.noteId, w.nia.id)).status).toBe(200);
    expect((await assignees(gone.note.noteId)).status).toBe(409);
    expect((await eventsAfter(h, mark)).filter((e) => e.action === 'note.assignees_viewed')).toEqual([]);
  });

  it('a note the team does not have, or the caller may not read, is 404; an ID that is not one 422; none logged', async () => {
    const v = await departed('resident');
    // An admin role that reads no Medical note (no patients.view).
    const role = await roleWith(h, w.t, 'Roster only', ['team.manage_users']);
    const ros = await addMember(h, w.t, 'ros@example.com', 'Ros (demo)', role);
    const mark = await auditMark(h);
    expect((await assignees(v.note.noteId, ros.token)).status).toBe(404);
    expect((await assignees(randomUUID())).status).toBe(404);
    expect((await assignees('not-a-note')).status).toBe(422);
    expect(await eventsAfter(h, mark)).toEqual([]);
  });

  it('is logged as one view of the note, with its patient and how many people it lists, and no name', async () => {
    const v = await departed('resident');
    const mark = await auditMark(h);
    const r = await assignees(v.note.noteId);
    const [event] = await expectAudit(h, 'note.assignees_viewed', { after: mark, count: 1 });
    expect(event).toMatchObject({
      entity: 'encounter_note',
      entityId: v.note.noteId,
      patientId: w.patientId,
    });
    expect(event!.details).toEqual({ resultCount: ((r.body as Json).assignees as unknown[]).length });
    expect((await eventsAfter(h, mark)).map((e) => e.action)).toEqual(['note.assignees_viewed']);
    await expectAuditClean(h, [...SECRETS, w.ana.displayName, w.rae.displayName], mark);
    expectNoneOf(r.body, SECRETS);
  });
});
