import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorld,
  eventsAfter,
  expectNoneOf,
  finish,
  get,
  receivedAt,
  removeMember,
  SECRETS,
  TEST_NOTE_TYPE,
  visitAt,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import { clinician, noteOn, type Clinician, type HeldNote, type Json } from './sync-fixtures.ts';

// GET /v1/me/notes-to-finish and GET /v1/team/incomplete-notes (lifecycle 3.9, 5.6): draft notes
// on the server, with whether each is overdue: more than 24 hours since its visit started, or since
// the server received the visit when its start time was not verified, worked out when read. An
// empty draft does not count (3.1). Each list is logged with the patients it shows (D53). Every
// person and value is made up.

interface Row {
  noteId: string;
  encounterId: string;
  patientId: string | null;
  noteTypeKey: string;
  startedAt: string;
  overdue: boolean;
  author?: { userId: string; displayName: string };
  authorActive?: boolean;
}

const HOUR = 3600_000;
const PLAN = { 'care.plan': 'Demo: rest and fluids' };

describe('phase 4: notes that are not complete', () => {
  let h: Harness;
  let w: World;
  let other: string;
  /** Lou's drafts, each named by what makes it overdue or not. */
  let lou: Clinician;
  let fresh: HeldNote;
  let late: HeldNote;
  let unverifiedRecent: HeldNote;
  let unverifiedLate: HeldNote;
  let noPatient: HeldNote;
  let empty: HeldNote;
  let done: HeldNote;
  /** A teammate's draft, and a departed author's. */
  let teammates: HeldNote;
  let departedDraft: HeldNote;
  let departed: Clinician;
  /** A departed author's draft assigned to Lou: Lou acts as its author now (lifecycle 3.8). */
  let handed: HeldNote;

  const ago = (hours: number) => new Date(h.clock.now.getTime() - hours * HOUR).toISOString();

  /** A Non-Medical visit with one draft note of Lou's, started [hours] before the clock. */
  async function draftOf(
    c: Clinician,
    hours: number,
    o: { verified?: boolean; patientId?: string | null; answers?: Record<string, unknown> } = {},
  ) {
    const visit = await visitAt(c, o.patientId === undefined ? w.patientId : o.patientId, {
      kind: 'non_medical',
      startedAt: ago(hours),
      clockVerified: o.verified ?? true,
    });
    return noteOn(c, visit, TEST_NOTE_TYPE, o.answers ?? PLAN);
  }

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
    other = (await createPatient(h, w.t.teamId, w.t.adminId, { preferredName: 'Demo Sasha' })).id;
    lou = await clinician(h, w.t, 'lou@example.com', 'Lou (demo)', 'none');
    fresh = await draftOf(lou, 1);
    late = await draftOf(lou, 25, { patientId: other });
    // Started three days ago by the phone's clock, which it could not verify: the server's receipt
    // decides, an hour ago for one and a day and more for the other.
    unverifiedRecent = await draftOf(lou, 72, { verified: false });
    await receivedAt(h, unverifiedRecent.encounterId, new Date(h.clock.now.getTime() - HOUR));
    unverifiedLate = await draftOf(lou, 72, { verified: false });
    await receivedAt(h, unverifiedLate.encounterId, new Date(h.clock.now.getTime() - 25 * HOUR));
    noPatient = await draftOf(lou, 2, { patientId: null });
    // Picked by mistake and blanked: it does not count. A finished note is not a draft.
    empty = await draftOf(lou, 30, { answers: { 'care.plan': '', 'vitals.pulse': null } });
    done = await draftOf(lou, 30);
    await finish(lou, [done, 'complete', 'completed']);
    teammates = await draftOf(w.ana, 26);
    departed = await clinician(h, w.t, 'gil@example.com', 'Gil (demo)', 'none');
    departedDraft = await draftOf(departed, 40);
    handed = await draftOf(departed, 3);
    await removeMember(w, departed.membershipId);
    // As the assign route leaves it (5.5), written here so this test does not wait on that route.
    await h.scratch.owner.begin(async (tx) => {
      await tx`insert into sineobex.note_assignments (team_id, note_id, from_user_id, to_user_id, assigned_by, reason)
               values (${w.t.teamId}, ${handed.noteId}, ${departed.id}, ${lou.id}, ${w.t.adminId}, 'Demo: left')`;
      await tx`update sineobex.encounter_notes set assigned_user_id = ${lou.id} where id = ${handed.noteId}`;
    });
  });
  afterAll(() => h.close());

  const list = async (token: string, path: string) => {
    const r = await get(w, token, path);
    return { status: r.status, body: r.body, notes: ((r.body as Json).notes ?? []) as Row[] };
  };
  const byId = (rows: Row[]) => new Map(rows.map((r) => [r.noteId, r]));
  const startOf = async (n: HeldNote) =>
    (
      await h.scratch.owner<
        { at: Date }[]
      >`select started_at as at from sineobex.encounters where id = ${n.encounterId}`
    )[0]!.at.toISOString();

  describe('notes to finish: the caller’s own drafts', () => {
    it('needs encounters.chart: a role without it is refused, and the refusal is logged', async () => {
      for (const token of [w.kim.token, w.bea.token]) {
        const mark = await auditMark(h);
        expect((await list(token, '/v1/me/notes-to-finish')).status).toBe(403);
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ permission: 'encounters.chart' });
      }
    });

    it('lists every draft the caller acts as the author of, an assigned one included, not an empty one, a finished one or a teammate’s', async () => {
      const r = await list(lou.token, '/v1/me/notes-to-finish');
      expect(r.status).toBe(200);
      expect(r.notes.map((n) => n.noteId).sort()).toEqual(
        [fresh, late, unverifiedRecent, unverifiedLate, noPatient, handed].map((n) => n.noteId).sort(),
      );
      expect(byId(r.notes).get(late.noteId)).toEqual({
        noteId: late.noteId,
        encounterId: late.encounterId,
        patientId: other,
        noteTypeKey: TEST_NOTE_TYPE.key,
        startedAt: await startOf(late),
        overdue: true,
      });
      expect(byId(r.notes).get(noPatient.noteId)).toMatchObject({ patientId: null });
      expectNoneOf(r.body, [...SECRETS, 'Demo Sasha']);
    });

    it('overdue: more than 24 hours since the visit started, or since the server received it when the start was not verified', async () => {
      const rows = byId((await list(lou.token, '/v1/me/notes-to-finish')).notes);
      expect({
        fresh: rows.get(fresh.noteId)!.overdue,
        late: rows.get(late.noteId)!.overdue,
        unverifiedRecent: rows.get(unverifiedRecent.noteId)!.overdue,
        unverifiedLate: rows.get(unverifiedLate.noteId)!.overdue,
      }).toEqual({ fresh: false, late: true, unverifiedRecent: false, unverifiedLate: true });
      // Worked out when read: a day later the fresh one is overdue, with nothing written meanwhile.
      const was = h.clock.now;
      h.clock.advance(24 * HOUR);
      try {
        const token = await h.tokenFor('lou@example.com');
        expect(byId((await list(token, '/v1/me/notes-to-finish')).notes).get(fresh.noteId)!.overdue).toBe(
          true,
        );
      } finally {
        h.clock.set(was);
      }
    });

    it('is logged as a view of the patients it shows, with how many notes, and no answer', async () => {
      const mark = await auditMark(h);
      const r = await list(lou.token, '/v1/me/notes-to-finish');
      const [event] = await expectAudit(h, 'notes_to_finish.viewed', { after: mark, count: 1 });
      expect(event!.patientId).toBeNull();
      expect(event!.details).toMatchObject({ resultCount: r.notes.length });
      expect(event!.details).not.toHaveProperty('count');
      expect([...(event!.details.patientIds as string[])].sort()).toEqual([w.patientId, other].sort());
      expect((await eventsAfter(h, mark)).map((e) => e.action)).toEqual(['notes_to_finish.viewed']);
      await expectAuditClean(h, [...SECRETS, 'Lou (demo)'], mark);
    });
  });

  describe('the team’s incomplete notes', () => {
    it('needs team.manage_users: a role without it is refused, and the refusal is logged', async () => {
      for (const token of [w.ana.token, lou.token]) {
        const mark = await auditMark(h);
        expect((await list(token, '/v1/team/incomplete-notes')).status).toBe(403);
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ permission: 'team.manage_users' });
      }
    });

    it('lists every draft of the team with its author, whether they are still a member, and overdue', async () => {
      const r = await list(w.t.adminToken, '/v1/team/incomplete-notes');
      expect(r.status).toBe(200);
      const rows = byId(r.notes);
      for (const n of [fresh, late, unverifiedRecent, unverifiedLate, noPatient, teammates, departedDraft])
        expect(rows.has(n.noteId), n.noteId).toBe(true);
      for (const n of [empty, done]) expect(rows.has(n.noteId)).toBe(false);
      expect(rows.get(late.noteId)).toEqual({
        noteId: late.noteId,
        encounterId: late.encounterId,
        patientId: other,
        noteTypeKey: TEST_NOTE_TYPE.key,
        startedAt: await startOf(late),
        overdue: true,
        author: { userId: lou.id, displayName: 'Lou (demo)' },
        authorActive: true,
      });
      expect(rows.get(departedDraft.noteId)).toMatchObject({
        author: { userId: departed.id, displayName: 'Gil (demo)' },
        authorActive: false,
        overdue: true,
      });
      expect(rows.get(unverifiedRecent.noteId)!.overdue).toBe(false);
      // An assigned note's author is whoever acts as it now.
      expect(rows.get(handed.noteId)).toMatchObject({ author: { userId: lou.id }, authorActive: true });
      expect(rows.get(teammates.noteId)).toMatchObject({ author: { userId: w.ana.id }, overdue: true });
      expectNoneOf(r.body, [...SECRETS, 'Demo Sasha']);
    });

    it('takes an author filter, by ID', async () => {
      const r = await list(w.t.adminToken, `/v1/team/incomplete-notes?author=${departed.id}`);
      expect(r.status).toBe(200);
      expect(r.notes.map((n) => n.noteId)).toEqual([departedDraft.noteId]);
      const lous = await list(w.t.adminToken, `/v1/team/incomplete-notes?author=${lou.id}`);
      expect(lous.notes.map((n) => n.noteId)).toContain(handed.noteId);
      expect((await list(w.t.adminToken, '/v1/team/incomplete-notes?author=Gil')).status).toBe(422);
    });

    it('is logged as a view of the patients it shows, with how many notes', async () => {
      const mark = await auditMark(h);
      const r = await list(w.t.adminToken, '/v1/team/incomplete-notes');
      const [event] = await expectAudit(h, 'incomplete_notes.viewed', { after: mark, count: 1 });
      expect(event!.patientId).toBeNull();
      expect(event!.details).toMatchObject({ resultCount: r.notes.length });
      expect([...(event!.details.patientIds as string[])].sort()).toEqual(
        [...new Set(r.notes.map((n) => n.patientId).filter((p) => p !== null))].sort(),
      );
      await expectAuditClean(h, [...SECRETS, 'Gil (demo)', 'Lou (demo)'], mark);
    });
  });
});
