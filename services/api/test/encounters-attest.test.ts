import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actBody,
  attest,
  ATTEST_STATEMENT,
  attestationRows,
  chartedVisit,
  correct,
  cosign,
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
  visitAt,
  waitingForAttestation,
  waitingForCosign,
  whileTeamLocked,
  WITH_EXAM,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import {
  clinician,
  CREDENTIAL_FIELDS,
  noteOn,
  setCredential,
  signoffOf,
  TEST_RED_FLAGS_TYPE,
  type HeldNote,
} from './sync-fixtures.ts';

// POST /v1/encounters/{encounterId}/attest (lifecycle 3.7, 5.4, 6.4 rule 4): an attending attests a
// visit's signed notes that wait, online, all or nothing. Each note is checked by attestEffect:
// signed and waiting (else 409 not_waiting), not the caller's (403 is_author), not signed by the
// caller (403 is_signer), a credential that attests (403), every answer that counts seen (403), the
// hash of what they read (409 content_changed). Then a note_attestations row that names the note's
// current signature (the database's key cannot see a sign-off's effect, lifecycle 2.4), one
// note.attested per note, one notice per signer per visit. Every person and value is made up.

describe('phase 4: attest', () => {
  let h: Harness;
  let w: World;

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
  });
  afterAll(() => h.close());

  // The world is shared by every test here, so a person's notices are read for one visit at a time.
  const noticesAbout = async (userId: string, kind: string, encounterId: string) =>
    (await noticesOf(h, userId, kind)).filter((n) => n.recordId === encounterId);

  const unchanged = async (...notes: HeldNote[]) => {
    for (const n of notes) {
      expect(await noteRow(h, n.noteId)).toMatchObject({ status: 'signed', attestation: 'waiting' });
      expect(await attestationRows(h, n.noteId)).toEqual([]);
    }
  };

  describe('who may attest', () => {
    it('needs encounters.chart: a role without it is refused, and the refusal is logged', async () => {
      const v = await waitingForAttestation(w);
      for (const token of [w.kim.token, w.bea.token]) {
        const mark = await auditMark(h);
        const r = await attest(w, { token }, v.visit.encounterId, [v.flags, v.note]);
        expect(r.status).toBe(403);
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ permission: 'encounters.chart' });
      }
      await unchanged(v.flags, v.note);
    });

    it('a credential that cannot attest is refused, logged with the reason’s name', async () => {
      // A resident signs but does not attest; nor does someone with no credential.
      const v = await waitingForAttestation(w, w.nia);
      const none = await clinician(h, w.t, 'noa@example.com', 'Noa (demo)', 'none');
      for (const c of [w.rae, none]) {
        const mark = await auditMark(h);
        const r = await attest(w, c, v.visit.encounterId, [v.flags, v.note]);
        expect(r.status).toBe(403);
        expect(refusal(r.body)).toEqual({
          code: 'cannot_attest',
          noteIds: [v.flags.noteId, v.note.noteId].sort(),
        });
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ reason: 'cannot_attest' });
      }
      await unchanged(v.flags, v.note);
    });

    it('nobody attests a note they act as the author of, even once their credential attests', async () => {
      const v = await waitingForAttestation(w, w.nia);
      await setCredential(h, w.t, w.nia.membershipId, 'attending');
      try {
        const mark = await auditMark(h);
        const r = await attest(w, w.nia, v.visit.encounterId, [v.flags, v.note]);
        expect(r.status).toBe(403);
        expect(refusal(r.body)).toEqual({
          code: 'is_author',
          noteIds: [v.flags.noteId, v.note.noteId].sort(),
        });
        const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
        expect(denied!.details).toMatchObject({ reason: 'is_author' });
      } finally {
        await setCredential(h, w.t, w.nia.membershipId, 'np');
      }
      await unchanged(v.flags, v.note);
    });

    it('nobody attests a note whose current signature is their own: a resident who co-signed and became an attending', async () => {
      const v = await waitingForCosign(w);
      expect((await cosign(w, w.rae, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
      await unchanged(v.flags, v.note);
      await setCredential(h, w.t, w.rae.membershipId, 'attending');
      try {
        const r = await attest(w, w.rae, v.visit.encounterId, [v.flags, v.note]);
        expect(r.status).toBe(403);
        expect(refusal(r.body)).toEqual({
          code: 'is_signer',
          noteIds: [v.flags.noteId, v.note.noteId].sort(),
        });
      } finally {
        await setCredential(h, w.t, w.rae.membershipId, 'resident');
      }
      await unchanged(v.flags, v.note);
      // Another attending may.
      expect((await attest(w, w.ana, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
    });

    it('nobody attests a note with an answer they may not see; a reader who sees it whole may', async () => {
      const v = await waitingForAttestation(w, w.rae, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM);
      const mark = await auditMark(h);
      const r = await attest(w, w.ana, v.visit.encounterId, [v.flags, v.note]);
      expect(r.status).toBe(403);
      expect(refusal(r.body)).toEqual({ code: 'cannot_see_all', noteIds: [v.note.noteId] });
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ reason: 'cannot_see_all' });
      await unchanged(v.flags, v.note);
      expect((await attest(w, w.vic, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
    });

    it('the list holds every waiting note the caller may act on, and may leave out one they may not', async () => {
      const visit = await visitAt(w.rae, w.patientId);
      const flags = await noteOn(w.rae, visit, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
      const hidden = await noteOn(w.rae, visit, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM);
      await finish(w.rae, [flags, 'sign', 'signed'], [hidden, 'sign', 'signed']);
      const short = await attest(w, w.vic, visit.encounterId, [flags]);
      expect(short.status).toBe(409);
      expect(refusal(short.body)).toEqual({ code: 'content_changed', noteIds: [hidden.noteId] });
      await unchanged(flags, hidden);
      // Ana may not see the exam note: the flags note alone is the whole of what she may attest.
      expect((await attest(w, w.ana, visit.encounterId, [flags])).status).toBe(200);
      expect((await noteRow(h, flags.noteId)).attestation).toBe('attested');
      await unchanged(hidden);
    });
  });

  describe('what is refused, and how', () => {
    it('a note that does not wait for attestation: 409 not_waiting, naming it', async () => {
      // Signed by an attending, nothing held; completed and waiting for a co-signer; a draft.
      const signed = await chartedVisit(w, w.ana);
      await finish(w.ana, [signed.flags, 'sign', 'signed'], [signed.note, 'sign', 'signed']);
      const waits = await waitingForCosign(w);
      const draft = await chartedVisit(w, w.rae);
      for (const [encounterId, notes] of [
        [signed.visit.encounterId, [signed.flags, signed.note]],
        [waits.visit.encounterId, [waits.flags, waits.note]],
        [draft.visit.encounterId, [draft.note]],
      ] as [string, HeldNote[]][]) {
        const r = await attest(w, w.vic, encounterId, notes);
        expect(r.status).toBe(409);
        expect(refusal(r.body)).toEqual({ code: 'not_waiting', noteIds: notes.map((n) => n.noteId).sort() });
      }
      expect(await attestationRows(h, signed.note.noteId)).toEqual([]);
    });

    it('a note changed since it was read: 409 content_changed, and nothing is written for any note', async () => {
      const v = await waitingForAttestation(w);
      const read = v.note;
      // Rae corrects it: a resident's correction keeps it signed and waiting (lifecycle 3.6).
      await correct(w.rae, v.note, h, 'care.plan', 'Demo: rest, fluids and a follow-up');
      const mark = await auditMark(h);
      const r = await attest(w, w.ana, v.visit.encounterId, [v.flags, read]);
      expect(r.status).toBe(409);
      expect(refusal(r.body)).toEqual({ code: 'content_changed', noteIds: [read.noteId] });
      await unchanged(v.flags, v.note);
      expect((await eventsAfter(h, mark)).filter((e) => e.action === 'note.attested')).toEqual([]);
      expect(await noticesAbout(w.rae.id, 'note_attested', v.visit.encounterId)).toEqual([]);
    });

    it('a visit the team does not have is 404; a body that is not one is 422', async () => {
      const v = await waitingForAttestation(w);
      expect((await attest(w, w.ana, randomUUID(), [v.flags, v.note])).status).toBe(404);
      const body = await actBody([v.flags, v.note], ATTEST_STATEMENT);
      for (const bad of [
        { ...body, notes: [] },
        { ...body, notes: [{ noteId: v.note.noteId, contentHash: 'not-a-hash' }] },
        { notes: body.notes },
      ]) {
        const r = await post(w, w.ana.token, `/v1/encounters/${v.visit.encounterId}/attest`, bad);
        expect(r.status).toBe(422);
      }
      await unchanged(v.flags, v.note);
    });
  });

  describe('what an attestation writes', () => {
    it('an attestation of the note’s current signature for each note, one event per note, one notice per signer', async () => {
      const v = await waitingForAttestation(w);
      const signatures = await Promise.all(
        [v.flags, v.note].map(async (n) => (await noteRow(h, n.noteId)).signoffId),
      );
      const mark = await auditMark(h);
      const r = await attest(w, w.ana, v.visit.encounterId, [v.flags, v.note]);
      expect(r.status).toBe(200);
      expect(r.body.notes).toEqual(
        expect.arrayContaining([
          { noteId: v.flags.noteId, status: 'signed', attestation: 'attested' },
          { noteId: v.note.noteId, status: 'signed', attestation: 'attested' },
        ]),
      );
      const { npi, ...fields } = CREDENTIAL_FIELDS.attending;
      const events = await expectAudit(h, 'note.attested', { after: mark, count: 2 });
      for (const [i, n] of [v.flags, v.note].entries()) {
        const rows = await attestationRows(h, n.noteId);
        expect(rows).toEqual([
          expect.objectContaining({
            teamId: w.t.teamId,
            noteId: n.noteId,
            signoffId: signatures[i],
            contentHash: await heldHashOf(n),
            attendingUserId: w.ana.id,
            attendingName: 'Ana (demo)',
            attendingNpi: npi,
            attendingFields: fields,
            statementVersion: ATTEST_STATEMENT,
            attestedAt: h.clock.now,
          }),
        ]);
        // Attesting adds a statement below the note and changes nothing else (PRD main 216).
        expect(await noteRow(h, n.noteId)).toMatchObject({
          status: 'signed',
          attestation: 'attested',
          signoffId: signatures[i],
          authorUserId: w.rae.id,
        });
        expect(events[i]).toMatchObject({
          entity: 'encounter_note',
          entityId: n.noteId,
          patientId: w.patientId,
        });
        expect(events[i]!.details).toEqual({ attestationId: rows[0]!.id, signoffId: signatures[i] });
      }
      expect(await noticesAbout(w.rae.id, 'note_attested', v.visit.encounterId)).toEqual([
        { entity: 'encounter', recordId: v.visit.encounterId },
      ]);
      await expectAuditClean(h, [...SECRETS, 'Ana (demo)', 'Rae (demo)'], mark);

      const again = await attest(w, w.ana, v.visit.encounterId, [v.flags, v.note]);
      expect(again.status).toBe(409);
      expect(refusal(again.body).code).toBe('not_waiting');
    });

    it('names the note’s signature, never a later sign-off of the note that signed nothing', async () => {
      // The database's key lets an attestation name any sign-off of its note (lifecycle 2.4): the
      // route names the one the note holds. Here the note's latest sign-offs signed nothing: the
      // author's second sign, and a teammate's sign-off, both kept with no effect.
      const v = await waitingForAttestation(w);
      const signature = (await noteRow(h, v.note.noteId)).signoffId!;
      const repeat = await signoffOf(w.rae, v.note, 'sign');
      const teammate = await signoffOf(w.nia, v.note, 'sign');
      expect((await w.rae.send(repeat)).map((r) => r.details?.effect)).toEqual(['none']);
      expect((await w.nia.send(teammate)).map((r) => r.details?.effect)).toEqual(['none']);
      expect((await signoffRows(h, v.note.noteId)).map((s) => s.id)).toEqual([
        signature,
        repeat.recordId,
        teammate.recordId,
      ]);
      expect((await attest(w, w.ana, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
      expect((await attestationRows(h, v.note.noteId)).map((a) => a.signoffId)).toEqual([signature]);

      // A student's note co-signed by a resident: the co-signature, not the student's sign-off
      // that was saved unsigned.
      const c = await waitingForCosign(w);
      const [unsigned] = await signoffRows(h, c.note.noteId);
      expect(unsigned).toMatchObject({ effect: 'saved_unsigned' });
      expect((await cosign(w, w.rae, c.visit.encounterId, [c.flags, c.note])).status).toBe(200);
      const cosignature = (await noteRow(h, c.note.noteId)).signoffId!;
      expect(cosignature).not.toBe(unsigned!.id);
      const mark = await auditMark(h);
      expect((await attest(w, w.ana, c.visit.encounterId, [c.flags, c.note])).status).toBe(200);
      const [row] = await attestationRows(h, c.note.noteId);
      expect(row!.signoffId).toBe(cosignature);
      const events = await expectAudit(h, 'note.attested', { after: mark, count: 2 });
      expect(events.find((e) => e.entityId === c.note.noteId)!.details).toEqual({
        attestationId: row!.id,
        signoffId: cosignature,
      });
      // The notice goes to the signer of the signature attested: the co-signer, not the student.
      expect(await noticesOf(h, w.rae.id, 'note_attested')).toEqual(
        expect.arrayContaining([{ entity: 'encounter', recordId: c.visit.encounterId }]),
      );
      expect(await noticesOf(h, w.sol.id, 'note_attested')).toEqual([]);
    });

    it('a note attested, corrected and waiting again is attested again: a second row, the first kept', async () => {
      const v = await waitingForAttestation(w);
      expect((await attest(w, w.ana, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
      const { note } = await correct(w.rae, v.note, h, 'care.plan', 'Demo: fluids and rest');
      expect(await noteRow(h, v.note.noteId)).toMatchObject({ status: 'signed', attestation: 'waiting' });
      expect((await attest(w, w.vic, v.visit.encounterId, [note])).status).toBe(200);
      // The harness's clock stands still, so both rows carry the same time: compared as a set.
      const rows = await attestationRows(h, v.note.noteId);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => [r.attendingUserId, r.contentHash])).toEqual(
        expect.arrayContaining([
          [w.ana.id, await heldHashOf(v.note)],
          [w.vic.id, await heldHashOf(note)],
        ]),
      );
      expect((await noteRow(h, v.note.noteId)).attestation).toBe('attested');
    });

    it('takes the team lock before it locks a note or a visit', async () => {
      const v = await waitingForAttestation(w);
      const run = await whileTeamLocked(h, w.t.teamId, () =>
        attest(w, w.ana, v.visit.encounterId, [v.flags, v.note]),
      );
      expect(run.waited).toBe(true);
      expect(run.rowLocks).toBe(0);
      expect(run.answer.status).toBe(200);
    });
  });
});
