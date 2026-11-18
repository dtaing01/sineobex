import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attestDirect,
  chartedVisit,
  correct,
  createWorld,
  eventsAfter,
  expectNoneOf,
  finish,
  get,
  noteRow,
  SECRETS,
  setCredential,
  TEST_MEDICAL_EXAM_TYPE,
  TEST_NOTE_TYPE,
  waitingForAttestation,
  waitingForCosign,
  WITH_EXAM,
  type ChartedVisit,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import { clinician, noteOn, type Clinician, type HeldNote, type Json } from './sync-fixtures.ts';

// GET /v1/team/cosign-queue and GET /v1/team/attestation-queue (lifecycle 3.7, 5.4, 6.4 rule 4):
// team-wide, one row per visit, oldest first, each with its waiting notes. A note with an answer
// the caller may not see, or one they may not act on, is listed with canAct false, so the queue can
// say why. Who signed or attested a note before shows when it came back after a correction. Each
// view is logged with the patients it shows (D53). Every person and value is made up.

interface QueueNote {
  noteId: string;
  noteTypeKey: string;
  author: { userId: string; displayName: string };
  completedAt: string;
  signedBefore: { userId: string; displayName: string } | null;
  attestedBefore: { userId: string; displayName: string } | null;
  canAct: boolean;
}
interface QueueRow {
  encounterId: string;
  patientId: string;
  preferredName: string | null;
  startedAt: string;
  notes: QueueNote[];
}

const at = (h: Harness, hoursAgo: number) =>
  new Date(h.clock.now.getTime() - hoursAgo * 3600_000).toISOString();

describe('phase 4: the co-sign and attestation queues', () => {
  let h: Harness;
  let w: World;
  let other: { id: string; preferredName: string };

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
    other = {
      id: (await createPatient(h, w.t.teamId, w.t.adminId, { preferredName: 'Demo Sasha' })).id,
      preferredName: 'Demo Sasha',
    };
  });
  afterAll(() => h.close());

  const queue = async (c: { token: string }, which: 'cosign' | 'attestation') => {
    const r = await get(w, c.token, `/v1/team/${which}-queue`);
    return { status: r.status, body: r.body, rows: ((r.body as Json).rows ?? []) as QueueRow[] };
  };
  const rowOf = (rows: QueueRow[], v: ChartedVisit | { visit: { encounterId: string } }) =>
    rows.find((r) => r.encounterId === v.visit.encounterId);
  const noteIn = (row: QueueRow | undefined, n: HeldNote) => row?.notes.find((x) => x.noteId === n.noteId);
  const completedAt = async (n: HeldNote) =>
    (
      await h.scratch.owner<
        { at: Date }[]
      >`select completed_at as at from sineobex.encounter_notes where id = ${n.noteId}`
    )[0]!.at.toISOString();
  const person = (c: Clinician) => ({ userId: c.id, displayName: c.displayName });

  describe('the co-sign queue', () => {
    let oldest: ChartedVisit;
    let middle: ChartedVisit;
    let newest: ChartedVisit;
    let returned: ChartedVisit;
    let signed: ChartedVisit;
    let social: HeldNote;

    beforeAll(async () => {
      // Sol's two visits, one with a sensitive exam, and Ana's own complete waiting in between.
      oldest = await waitingForCosign(w, w.sol, undefined, undefined, { startedAt: at(h, 5) });
      middle = await waitingForCosign(w, w.ana, undefined, undefined, { startedAt: at(h, 4) });
      newest = await waitingForCosign(w, w.sol, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM, { startedAt: at(h, 3) });
      // Signed: not waiting. Its Non-Medical note is complete, and never waits.
      signed = await chartedVisit(w, w.rae, undefined, undefined, { startedAt: at(h, 6) });
      await finish(w.rae, [signed.flags, 'sign', 'signed'], [signed.note, 'sign', 'signed']);
      social = await noteOn(w.sol, signed.visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: housing list' });
      await finish(w.sol, [social, 'complete', 'completed']);
      // Nia signed hers, was moved to student, and corrected it: back with a co-signer.
      const nia = await clinician(h, w.t, 'nia-q@example.com', 'Nia Q (demo)', 'np');
      returned = await chartedVisit(w, nia, undefined, undefined, { startedAt: at(h, 2) });
      await finish(nia, [returned.flags, 'sign', 'signed'], [returned.note, 'sign', 'signed']);
      await setCredential(h, w.t, nia.membershipId, 'student');
      await correct({ ...nia, credential: 'student' }, returned.note, h, 'care.plan', 'Demo: fluids');
      expect(await noteRow(h, returned.note.noteId)).toMatchObject({ status: 'completed', signoffId: null });
      // A draft waits for nobody; a visit of another patient shows that patient.
      const draft = await chartedVisit(w, w.sol);
      await noteOn(w.sol, draft.visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: socks' });
      await waitingForCosign(w, w.sol, undefined, undefined, { startedAt: at(h, 1), patientId: other.id });
    });

    it('needs encounters.chart and a credential that signs; each refusal is logged', async () => {
      for (const token of [w.kim.token, w.bea.token]) {
        const mark = await auditMark(h);
        expect((await queue({ token }, 'cosign')).status).toBe(403);
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ permission: 'encounters.chart' });
      }
      const none = await clinician(h, w.t, 'noa@example.com', 'Noa (demo)', 'none');
      for (const c of [w.sol, none]) {
        const mark = await auditMark(h);
        const r = await queue(c, 'cosign');
        expect(r.status).toBe(403);
        expect((r.body as Json).error?.code).toBe('cannot_sign');
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ reason: 'cannot_sign' });
      }
    });

    it('one row per visit with a Medical note waiting, oldest first, with only its waiting notes', async () => {
      const r = await queue(w.vic, 'cosign');
      expect(r.status).toBe(200);
      const mine = r.rows.filter((row) =>
        [oldest, middle, newest, returned, signed].some((v) => v.visit.encounterId === row.encounterId),
      );
      expect(mine.map((row) => row.encounterId)).toEqual(
        [oldest, middle, newest, returned].map((v) => v.visit.encounterId),
      );
      const starts = r.rows.map((row) => row.startedAt);
      expect(starts).toEqual([...starts].sort());
      expect(rowOf(r.rows, oldest)).toEqual({
        encounterId: oldest.visit.encounterId,
        patientId: w.patientId,
        preferredName: w.preferredName,
        startedAt: at(h, 5),
        notes: expect.any(Array),
      });
      expect(
        rowOf(r.rows, oldest)!
          .notes.map((n) => n.noteId)
          .sort(),
      ).toEqual([oldest.flags.noteId, oldest.note.noteId].sort());
      expect(noteIn(rowOf(r.rows, oldest), oldest.note)).toEqual({
        noteId: oldest.note.noteId,
        noteTypeKey: oldest.note.type.key,
        author: person(w.sol),
        completedAt: await completedAt(oldest.note),
        signedBefore: null,
        attestedBefore: null,
        canAct: true,
      });
      // The visit on another patient shows that patient.
      const moved = r.rows.find((row) => row.patientId === other.id);
      expect(moved).toMatchObject({ preferredName: other.preferredName });
      // Signed notes, a complete Non-Medical note and drafts wait for nobody.
      expect(rowOf(r.rows, signed)).toBeUndefined();
      expect(r.rows.flatMap((row) => row.notes).map((n) => n.noteId)).not.toContain(social.noteId);
      expectNoneOf(r.body, SECRETS);
    });

    it('a note with an answer the caller may not see, or one they wrote, is listed with canAct false', async () => {
      // Ana sees no sensitive exam (PLAN-OPEN 12.1 #13), and wrote the middle visit's notes.
      const anas = await queue(w.ana, 'cosign');
      expect(anas.status).toBe(200);
      expect(noteIn(rowOf(anas.rows, newest), newest.note)!.canAct).toBe(false);
      expect(noteIn(rowOf(anas.rows, newest), newest.flags)!.canAct).toBe(true);
      expect(rowOf(anas.rows, middle)!.notes.map((n) => n.canAct)).toEqual([false, false]);
      // Vic sees every answer; a resident co-signs too (PLAN-OPEN 12.1 #6) and sees what Ana sees.
      const vics = await queue(w.vic, 'cosign');
      expect(rowOf(vics.rows, newest)!.notes.map((n) => n.canAct)).toEqual([true, true]);
      expect(rowOf(vics.rows, middle)!.notes.map((n) => n.canAct)).toEqual([true, true]);
      const raes = await queue(w.rae, 'cosign');
      expect(raes.status).toBe(200);
      expect(noteIn(rowOf(raes.rows, newest), newest.note)!.canAct).toBe(false);
      // Nothing of the hidden exam is in the queue.
      expectNoneOf(anas.body, ['Demo: no lesions seen', 'exam.findings']);
    });

    it('a note back after a correction shows who signed it before', async () => {
      const r = await queue(w.ana, 'cosign');
      const nia = await h.scratch.owner<
        { id: string }[]
      >`select id from sineobex.users where email = 'nia-q@example.com'`;
      expect(noteIn(rowOf(r.rows, returned), returned.note)).toMatchObject({
        signedBefore: { userId: nia[0]!.id, displayName: 'Nia Q (demo)' },
        attestedBefore: null,
        canAct: true,
      });
    });

    it('is logged as a view of the patients it shows, with how many rows, and no answer', async () => {
      const mark = await auditMark(h);
      const r = await queue(w.ana, 'cosign');
      const [event] = await expectAudit(h, 'cosign_queue.viewed', { after: mark, count: 1 });
      expect(event!.patientId).toBeNull();
      expect(event!.details).toMatchObject({ resultCount: r.rows.length });
      expect(event!.details).not.toHaveProperty('count');
      expect([...(event!.details.patientIds as string[])].sort()).toEqual(
        [...new Set(r.rows.map((row) => row.patientId))].sort(),
      );
      expect((event!.details.patientIds as string[]).sort()).toEqual([w.patientId, other.id].sort());
      expect((await eventsAfter(h, mark)).map((e) => e.action)).toEqual(['cosign_queue.viewed']);
      await expectAuditClean(h, [...SECRETS, 'Demo Sasha'], mark);
    });
  });

  describe('the attestation queue', () => {
    let first: ChartedVisit;
    let hidden: ChartedVisit;
    let again: ChartedVisit;
    let fourth: ChartedVisit;

    beforeAll(async () => {
      first = await waitingForAttestation(w, w.rae, undefined, undefined, { startedAt: at(h, 30) });
      hidden = await waitingForAttestation(w, w.nia, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM, {
        startedAt: at(h, 29),
      });
      // Attested by Ana, corrected by Rae: waiting again.
      again = await waitingForAttestation(w, w.rae, undefined, undefined, { startedAt: at(h, 28) });
      await attestDirect(h, w.t.teamId, again.note.noteId, w.ana);
      await correct(w.rae, again.note, h, 'care.plan', 'Demo: fluids');
      expect(await noteRow(h, again.note.noteId)).toMatchObject({ status: 'signed', attestation: 'waiting' });
      fourth = await chartedVisit(w, w.nia, undefined, undefined, { startedAt: at(h, 27) });
      await finish(w.nia, [fourth.flags, 'sign', 'signed'], [fourth.note, 'sign', 'signed']);
    });

    it('needs encounters.chart and a credential that attests; each refusal is logged', async () => {
      const mark = await auditMark(h);
      expect((await queue(w.kim, 'attestation')).status).toBe(403);
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ permission: 'encounters.chart' });
      for (const c of [w.rae, w.sol]) {
        const before = await auditMark(h);
        const r = await queue(c, 'attestation');
        expect(r.status).toBe(403);
        expect((r.body as Json).error?.code).toBe('cannot_attest');
        const [refused] = await expectAudit(h, 'access.denied', { after: before, count: 1 });
        expect(refused!.details).toMatchObject({ reason: 'cannot_attest' });
      }
    });

    it('one row per visit with a note waiting, oldest first; a hidden answer gives canAct false', async () => {
      const r = await queue(w.ana, 'attestation');
      expect(r.status).toBe(200);
      const ours = r.rows.filter((row) =>
        [first, hidden, again, fourth].some((v) => v.visit.encounterId === row.encounterId),
      );
      expect(ours.map((row) => row.encounterId)).toEqual(
        [first, hidden, again, fourth].map((v) => v.visit.encounterId),
      );
      const starts = r.rows.map((row) => row.startedAt);
      expect(starts).toEqual([...starts].sort());
      expect(noteIn(rowOf(r.rows, first), first.note)).toEqual({
        noteId: first.note.noteId,
        noteTypeKey: first.note.type.key,
        author: person(w.rae),
        completedAt: await completedAt(first.note),
        signedBefore: null,
        attestedBefore: null,
        canAct: true,
      });
      expect(noteIn(rowOf(r.rows, hidden), hidden.note)!.canAct).toBe(false);
      expect(noteIn(rowOf(r.rows, hidden), hidden.flags)!.canAct).toBe(true);
      const vics = await queue(w.vic, 'attestation');
      expect(noteIn(rowOf(vics.rows, hidden), hidden.note)!.canAct).toBe(true);
      expectNoneOf(r.body, [...SECRETS, 'exam.findings']);
    });

    it('a note attested, corrected and waiting again shows who attested it before', async () => {
      const r = await queue(w.vic, 'attestation');
      expect(noteIn(rowOf(r.rows, again), again.note)).toMatchObject({
        attestedBefore: person(w.ana),
        canAct: true,
      });
      // The flags note was never attested.
      expect(noteIn(rowOf(r.rows, again), again.flags)).toMatchObject({ attestedBefore: null });
    });

    it('is logged as a view of the patients it shows, with how many rows', async () => {
      const mark = await auditMark(h);
      const r = await queue(w.ana, 'attestation');
      const [event] = await expectAudit(h, 'attestation_queue.viewed', { after: mark, count: 1 });
      expect(event!.patientId).toBeNull();
      expect(event!.details).toMatchObject({ resultCount: r.rows.length });
      expect([...(event!.details.patientIds as string[])].sort()).toEqual(
        [...new Set(r.rows.map((row) => row.patientId))].sort(),
      );
      await expectAuditClean(h, SECRETS, mark);
    });
  });
});
