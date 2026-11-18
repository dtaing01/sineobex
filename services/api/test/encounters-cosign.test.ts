import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actBody,
  chartedVisit,
  correct,
  cosign,
  COSIGN_STATEMENT,
  createWorld,
  eventsAfter,
  finish,
  heldHashOf,
  noteRow,
  noticesOf,
  post,
  refusal,
  SECRETS,
  signoffRows,
  TEST_MEDICAL_EXAM_TYPE,
  TEST_NOTE_TYPE,
  visitAt,
  visitStatus,
  waitingForCosign,
  whileTeamLocked,
  WITH_EXAM,
  WITHOUT_EXAM,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import {
  CREDENTIAL_FIELDS,
  clinician,
  noteOn,
  setCredential,
  TEST_RED_FLAGS_TYPE,
  type HeldNote,
} from './sync-fixtures.ts';

// POST /v1/encounters/{encounterId}/cosign (lifecycle 3.7, 5.3, 6.4 rule 4): a second person signs
// a visit's waiting Medical notes in one action, online. Each note is checked by cosignEffect: a
// Medical note that is completed (else 409 not_waiting), not the caller's (403), a credential that
// signs (403), every answer that counts seen (403), the hash of what they read (409
// content_changed). All or nothing. Then a sign-off row and the note signed, one note.cosigned per
// note, one notice per author per visit. Every person and value is made up.

describe('phase 4: co-sign', () => {
  let h: Harness;
  let w: World;

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
  });
  afterAll(() => h.close());

  const path = (encounterId: string) => `/v1/encounters/${encounterId}/cosign`;
  const unchanged = async (...notes: HeldNote[]) => {
    for (const n of notes) {
      expect(await noteRow(h, n.noteId)).toMatchObject({ status: 'completed', signoffId: null });
      expect((await signoffRows(h, n.noteId)).filter((s) => s.act === 'cosign')).toEqual([]);
    }
  };

  describe('who may co-sign', () => {
    it('needs encounters.chart: a role without it is refused, and the refusal is logged', async () => {
      const v = await waitingForCosign(w);
      for (const token of [w.kim.token, w.bea.token]) {
        const mark = await auditMark(h);
        const r = await cosign(w, { token }, v.visit.encounterId, [v.flags, v.note]);
        expect(r.status).toBe(403);
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ permission: 'encounters.chart' });
      }
      await unchanged(v.flags, v.note);
    });

    it('a credential that cannot sign is refused, logged with the reason’s name', async () => {
      // Ana completes her own Medical notes for a co-signer; a student and a member with no
      // credential chart, but neither signs.
      const v = await waitingForCosign(w, w.ana);
      const none = await clinician(h, w.t, 'noa@example.com', 'Noa (demo)', 'none');
      for (const c of [w.sol, none]) {
        const mark = await auditMark(h);
        const r = await cosign(w, c, v.visit.encounterId, [v.flags, v.note]);
        expect(r.status).toBe(403);
        expect(refusal(r.body)).toEqual({
          code: 'cannot_sign',
          noteIds: [v.flags.noteId, v.note.noteId].sort(),
        });
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ reason: 'cannot_sign' });
      }
      await unchanged(v.flags, v.note);
    });

    it('nobody co-signs a note they act as the author of', async () => {
      const v = await waitingForCosign(w, w.ana);
      const mark = await auditMark(h);
      const r = await cosign(w, w.ana, v.visit.encounterId, [v.flags, v.note]);
      expect(r.status).toBe(403);
      expect(refusal(r.body)).toEqual({ code: 'is_author', noteIds: [v.flags.noteId, v.note.noteId].sort() });
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ reason: 'is_author' });
      await unchanged(v.flags, v.note);
    });

    it('nobody co-signs a note with an answer they may not see; a reader who sees it whole may', async () => {
      // Ana holds no patients.view_sensitive_exams (PLAN-OPEN 12.1 #13): the note waits for Vic.
      const v = await waitingForCosign(w, w.sol, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM);
      const mark = await auditMark(h);
      const r = await cosign(w, w.ana, v.visit.encounterId, [v.flags, v.note]);
      expect(r.status).toBe(403);
      expect(refusal(r.body)).toEqual({ code: 'cannot_see_all', noteIds: [v.note.noteId] });
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ reason: 'cannot_see_all' });
      await unchanged(v.flags, v.note);
      // The same type with nothing hidden from her is hers to co-sign.
      const plain = await waitingForCosign(w, w.sol, TEST_MEDICAL_EXAM_TYPE, WITHOUT_EXAM);
      expect((await cosign(w, w.ana, plain.visit.encounterId, [plain.flags, plain.note])).status).toBe(200);
      expect((await cosign(w, w.vic, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
    });

    it('the list holds every waiting note the caller may act on, and may leave out one they may not', async () => {
      // A visit with a note Ana may co-sign and one she may not see whole.
      const visit = await visitAt(w.sol, w.patientId);
      const flags = await noteOn(w.sol, visit, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
      const hidden = await noteOn(w.sol, visit, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM);
      const open = await noteOn(w.sol, visit, TEST_MEDICAL_EXAM_TYPE, WITHOUT_EXAM);
      await finish(
        w.sol,
        [flags, 'complete', 'completed'],
        [hidden, 'sign', 'saved_unsigned'],
        [open, 'sign', 'saved_unsigned'],
      );
      // One she may act on is missing: the visit changed since she read it.
      const short = await cosign(w, w.ana, visit.encounterId, [flags]);
      expect(short.status).toBe(409);
      expect(refusal(short.body)).toEqual({ code: 'content_changed', noteIds: [open.noteId] });
      await unchanged(flags, hidden, open);
      // Every note she may act on: signed; the one she may not see waits for someone who can.
      const r = await cosign(w, w.ana, visit.encounterId, [flags, open]);
      expect(r.status).toBe(200);
      expect((await noteRow(h, open.noteId)).status).toBe('signed');
      expect((await noteRow(h, flags.noteId)).status).toBe('signed');
      await unchanged(hidden);
      expect(await visitStatus(h, visit.encounterId)).toBe('completed');
    });
  });

  describe('what is refused, and how', () => {
    it('a note that is not waiting for a co-signer: 409 not_waiting, naming it', async () => {
      // A signed note, a Non-Medical note that is complete, a draft, and a note of another visit.
      const signed = await chartedVisit(w, w.rae);
      await finish(w.rae, [signed.flags, 'sign', 'signed'], [signed.note, 'sign', 'signed']);
      const social = await noteOn(w.sol, signed.visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: housing list' });
      await finish(w.sol, [social, 'complete', 'completed']);
      const draft = await chartedVisit(w, w.sol);
      const elsewhere = await waitingForCosign(w);
      for (const [encounterId, notes] of [
        [signed.visit.encounterId, [signed.note]],
        [signed.visit.encounterId, [social]],
        [draft.visit.encounterId, [draft.flags, draft.note]],
        [signed.visit.encounterId, [elsewhere.note]],
      ] as [string, HeldNote[]][]) {
        const r = await cosign(w, w.ana, encounterId, notes);
        expect(r.status).toBe(409);
        expect(refusal(r.body)).toEqual({ code: 'not_waiting', noteIds: notes.map((n) => n.noteId).sort() });
      }
      await unchanged(elsewhere.note);
      expect((await noteRow(h, draft.note.noteId)).status).toBe('draft');
    });

    it('a note changed since it was read: 409 content_changed, and nothing is written for any note', async () => {
      const v = await waitingForCosign(w);
      // Sol corrects the note after Ana loaded the visit; Ana's page still holds the old answers.
      const read = v.note;
      await correct(w.sol, v.note, h, 'care.plan', 'Demo: rest, fluids and a follow-up');
      const mark = await auditMark(h);
      const r = await cosign(w, w.ana, v.visit.encounterId, [v.flags, read]);
      expect(r.status).toBe(409);
      expect(refusal(r.body)).toEqual({ code: 'content_changed', noteIds: [read.noteId] });
      // The flags note matched, and is not signed either: all or nothing.
      await unchanged(v.flags, v.note);
      expect((await eventsAfter(h, mark)).filter((e) => e.action === 'note.cosigned')).toEqual([]);
      expect(await noticesOf(h, w.sol.id, 'note_cosigned')).toEqual([]);
    });

    it('a visit the team does not have is 404; a body that is not one is 422', async () => {
      const v = await waitingForCosign(w);
      expect((await cosign(w, w.ana, randomUUID(), [v.flags, v.note])).status).toBe(404);
      const body = await actBody([v.flags, v.note], COSIGN_STATEMENT);
      for (const bad of [
        { ...body, notes: [] },
        { ...body, notes: [{ noteId: v.note.noteId, contentHash: 'not-a-hash' }] },
        { notes: body.notes },
        { ...body, statementVersion: 'Cosign 2026' },
      ]) {
        const r = await post(w, w.ana.token, path(v.visit.encounterId), bad);
        expect(r.status).toBe(422);
      }
      await unchanged(v.flags, v.note);
    });
  });

  describe('what a co-sign writes', () => {
    it('an attending: a cosign sign-off for each note, the notes signed with nothing held, one event per note, one notice per author', async () => {
      const v = await waitingForCosign(w);
      const before = await noteRow(h, v.note.noteId);
      const mark = await auditMark(h);
      const r = await cosign(w, w.ana, v.visit.encounterId, [v.flags, v.note]);
      expect(r.status).toBe(200);
      expect(r.body.notes).toEqual(
        expect.arrayContaining([
          { noteId: v.flags.noteId, status: 'signed', attestation: 'not_needed' },
          { noteId: v.note.noteId, status: 'signed', attestation: 'not_needed' },
        ]),
      );
      const { npi, ...fields } = CREDENTIAL_FIELDS.attending;
      for (const n of [v.flags, v.note]) {
        const [row] = (await signoffRows(h, n.noteId)).filter((s) => s.act === 'cosign');
        expect(row).toMatchObject({
          teamId: w.t.teamId,
          noteId: n.noteId,
          act: 'cosign',
          effect: 'signed',
          contentHash: await heldHashOf(n),
          signerUserId: w.ana.id,
          signerName: 'Ana (demo)',
          signerCredential: 'attending',
          signerNpi: npi,
          signerFields: fields,
          claimedCredential: null,
          needsAttestation: false,
          statementVersion: COSIGN_STATEMENT,
          signedAt: h.clock.now,
          signedDeviceTime: null,
          clockVerified: true,
          changeId: null,
          approvedBy: null,
        });
        expect(await noteRow(h, n.noteId)).toMatchObject({
          status: 'signed',
          attestation: 'not_needed',
          signoffId: row!.id,
          firstSignedAt: h.clock.now,
          // A co-sign changes no answer, and the student stays the author.
          data: n === v.note ? before.data : expect.anything(),
          authorUserId: w.sol.id,
          assignedUserId: null,
        });
      }
      expect(await visitStatus(h, v.visit.encounterId)).toBe('signed');

      const events = await expectAudit(h, 'note.cosigned', { after: mark, count: 2 });
      for (const [i, n] of [v.flags, v.note].entries()) {
        const [row] = (await signoffRows(h, n.noteId)).filter((s) => s.act === 'cosign');
        expect(events[i]).toMatchObject({
          entity: 'encounter_note',
          entityId: n.noteId,
          patientId: w.patientId,
        });
        expect(events[i]!.details).toEqual({
          signoffId: row!.id,
          credential: 'attending',
          needsAttestation: false,
        });
      }
      // Each author is told once for the visit, with no text.
      expect(await noticesOf(h, w.sol.id, 'note_cosigned')).toEqual([
        { entity: 'encounter', recordId: v.visit.encounterId },
      ]);
      await expectAuditClean(h, [...SECRETS, 'Ana (demo)', 'Sol (demo)'], mark);

      // Done once: a second co-sign finds nothing waiting.
      const again = await cosign(w, w.ana, v.visit.encounterId, [v.flags, v.note]);
      expect(again.status).toBe(409);
      expect(refusal(again.body).code).toBe('not_waiting');
    });

    it('a resident co-signs too, and the notes then wait for attestation (PLAN-OPEN 12.1 #6)', async () => {
      const v = await waitingForCosign(w);
      const mark = await auditMark(h);
      const r = await cosign(w, w.rae, v.visit.encounterId, [v.flags, v.note]);
      expect(r.status).toBe(200);
      for (const n of [v.flags, v.note]) {
        expect(await noteRow(h, n.noteId)).toMatchObject({ status: 'signed', attestation: 'waiting' });
        const [row] = (await signoffRows(h, n.noteId)).filter((s) => s.act === 'cosign');
        expect(row).toMatchObject({
          signerCredential: 'resident',
          needsAttestation: true,
          signerUserId: w.rae.id,
        });
      }
      const events = await expectAudit(h, 'note.cosigned', { after: mark, count: 2 });
      expect(events.map((e) => e.details)).toEqual([
        expect.objectContaining({ credential: 'resident', needsAttestation: true }),
        expect.objectContaining({ credential: 'resident', needsAttestation: true }),
      ]);
    });

    it('a note signed before, and back with a co-signer after a correction, keeps its first signature time', async () => {
      const v = await chartedVisit(w, w.rae);
      await finish(w.rae, [v.flags, 'sign', 'signed'], [v.note, 'sign', 'signed']);
      const first = (await noteRow(h, v.note.noteId)).firstSignedAt;
      expect(first).not.toBeNull();
      // Rae is moved to student: her correction clears her signature, and the note waits again.
      await setCredential(h, w.t, w.rae.membershipId, 'student');
      try {
        const { note } = await correct(
          { ...w.rae, credential: 'student' },
          v.note,
          h,
          'care.plan',
          'Demo: fluids',
        );
        expect(await noteRow(h, v.note.noteId)).toMatchObject({ status: 'completed', signoffId: null });
        const r = await cosign(w, w.ana, v.visit.encounterId, [note]);
        expect(r.status).toBe(200);
        expect(await noteRow(h, v.note.noteId)).toMatchObject({ status: 'signed', firstSignedAt: first });
      } finally {
        await setCredential(h, w.t, w.rae.membershipId, 'resident');
      }
    });

    it('takes the team lock before it locks a note or a visit', async () => {
      const v = await waitingForCosign(w);
      const run = await whileTeamLocked(h, w.t.teamId, () =>
        cosign(w, w.ana, v.visit.encounterId, [v.flags, v.note]),
      );
      expect(run.waited).toBe(true);
      expect(run.rowLocks).toBe(0);
      expect(run.answer.status).toBe(200);
    });

    it('the lock check catches a writer that locks a note before the team lock', async () => {
      // The check above, and its copies in the attest and assign tests, would pass for a route that
      // took no lock at all only if it never waited: this holds that it sees the wrong order.
      const v = await waitingForCosign(w);
      const writer = (noteFirst: boolean) => async () => {
        const conn = await h.scratch.owner.reserve();
        const note = () =>
          conn`select id from sineobex.encounter_notes where id = ${v.note.noteId} for no key update`;
        try {
          await conn`begin`;
          if (noteFirst) await note();
          await conn`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${w.t.teamId}::uuid::text, 0))`;
          if (!noteFirst) await note();
          await conn`commit`;
        } finally {
          conn.release();
        }
      };
      const wrong = await whileTeamLocked(h, w.t.teamId, writer(true));
      expect(wrong.waited).toBe(true);
      expect(wrong.rowLocks).toBeGreaterThan(0);
      const right = await whileTeamLocked(h, w.t.teamId, writer(false));
      expect(right.waited).toBe(true);
      expect(right.rowLocks).toBe(0);
    });
  });
});
