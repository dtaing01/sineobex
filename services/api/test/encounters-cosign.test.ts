import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actBody,
  assignTo,
  chartedVisit,
  correct,
  cosign,
  COSIGN_STATEMENT,
  createWorld,
  eventsAfter,
  finish,
  get,
  heldHashOf,
  noteRow,
  noticesOf,
  post,
  refusal,
  rejoin,
  removeMember,
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

  const finishedBy = async (n: HeldNote) =>
    (
      await h.scratch.owner<{ completedAt: Date; completedBy: string }[]>`
        select completed_at, completed_by from sineobex.encounter_notes where id = ${n.noteId}`
    )[0];

  // The world is shared by every test here, so a person's notices are read for one visit at a time.
  const noticesAbout = async (userId: string, kind: string, encounterId: string) =>
    (await noticesOf(h, userId, kind)).filter((n) => n.recordId === encounterId);

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

    it('whoever a note was assigned to acts as its author: refused is_author, and told when it is co-signed', async () => {
      // Review finding LAC-1: every other is_author test used the note's own author.
      const stu = await clinician(h, w.t, 'stu@example.com', 'Stu (demo)', 'student');
      const v = await waitingForCosign(w, stu);
      await removeMember(w, stu.membershipId);
      for (const n of [v.flags, v.note]) await assignTo(w, n.noteId, w.rae.id);
      const mark = await auditMark(h);
      const r = await cosign(w, w.rae, v.visit.encounterId, [v.flags, v.note]);
      expect(r.status).toBe(403);
      expect(refusal(r.body)).toEqual({ code: 'is_author', noteIds: [v.flags.noteId, v.note.noteId].sort() });
      // Worded for everyone it covers: an assignee is never told they wrote it.
      expect((r.body as { error?: { message?: string } }).error?.message).toBe(
        'You can’t co-sign a note you wrote, completed or act as the author of.',
      );
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ reason: 'is_author' });
      await unchanged(v.flags, v.note);
      // Someone else co-signs: "your note was co-signed" goes to whoever acts as the author now.
      expect((await cosign(w, w.ana, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
      expect(await noticesAbout(w.rae.id, 'note_cosigned', v.visit.encounterId)).toHaveLength(1);
      expect(await noticesAbout(stu.id, 'note_cosigned', v.visit.encounterId)).toEqual([]);
    });

    it('nor does the note’s writer, once it was assigned away and they came back with a credential that signs', async () => {
      // Review findings LPM-1, LAC-3: the second person must not be the first (3.7).
      const ida = await clinician(h, w.t, 'ida@example.com', 'Ida (demo)', 'student');
      const v = await waitingForCosign(w, ida);
      await removeMember(w, ida.membershipId);
      for (const n of [v.flags, v.note]) await assignTo(w, n.noteId, w.rae.id);
      const back = await rejoin(w, 'ida@example.com', 'Ida (demo)', 'resident');
      const r = await cosign(w, back, v.visit.encounterId, [v.flags, v.note]);
      expect(r.status).toBe(403);
      expect(refusal(r.body)).toEqual({ code: 'is_author', noteIds: [v.flags.noteId, v.note.noteId].sort() });
      await unchanged(v.flags, v.note);
      // The queue says so too: the act's own rule.
      const queue = await get(w, back.token, '/v1/team/cosign-queue');
      const row = (queue.body.rows as { encounterId: string; notes: { canAct: boolean }[] }[]).find(
        (x) => x.encounterId === v.visit.encounterId,
      )!;
      expect(row.notes.map((n) => n.canAct)).toEqual([false, false]);
    });

    it('nor does whoever completed it as its assignee, once it was assigned on and they came back', async () => {
      // Written by one student, completed by another it was assigned to, then assigned on again.
      const una = await clinician(h, w.t, 'una@example.com', 'Una (demo)', 'student');
      const kit = await clinician(h, w.t, 'kit@example.com', 'Kit (demo)', 'student');
      const v = await chartedVisit(w, una);
      await removeMember(w, una.membershipId);
      for (const n of [v.flags, v.note]) await assignTo(w, n.noteId, kit.id);
      await finish(kit, [v.flags, 'complete', 'completed'], [v.note, 'sign', 'saved_unsigned']);
      await removeMember(w, kit.membershipId);
      for (const n of [v.flags, v.note]) await assignTo(w, n.noteId, w.rae.id);
      const back = await rejoin(w, 'kit@example.com', 'Kit (demo)', 'resident');
      const r = await cosign(w, back, v.visit.encounterId, [v.flags, v.note]);
      expect(r.status).toBe(403);
      expect(refusal(r.body)).toEqual({ code: 'is_author', noteIds: [v.flags.noteId, v.note.noteId].sort() });
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

    it('a note the caller may not read at all does not wait for them, whatever its state', async () => {
      // Review finding LAC-5: Eli charts and holds no patients.view, so he reads no Medical note.
      // A 403 for a waiting note and a 409 for a signed one would tell him which is which.
      const waits = await waitingForCosign(w);
      const signed = await chartedVisit(w, w.rae);
      await finish(w.rae, [signed.flags, 'sign', 'signed'], [signed.note, 'sign', 'signed']);
      const mark = await auditMark(h);
      const answers = [];
      for (const v of [waits, signed]) {
        const r = await cosign(w, w.eli, v.visit.encounterId, [v.note]);
        answers.push([r.status, refusal(r.body)]);
      }
      expect(answers).toEqual([
        [409, { code: 'not_waiting', noteIds: [waits.note.noteId] }],
        [409, { code: 'not_waiting', noteIds: [signed.note.noteId] }],
      ]);
      expect(await eventsAfter(h, mark)).toEqual([]);
      await unchanged(waits.flags, waits.note);
    });

    it('refusals of several notes: the first in the rule’s order is answered, and one about the caller is logged', async () => {
      // Review finding LAC-7: Sid, a student who is not the author, names a visit's waiting notes
      // and a note that no longer waits. not_waiting comes first in the rule's order, so it is the
      // answer; his cannot_sign is logged all the same, naming its notes.
      const sid = await clinician(h, w.t, 'sid@example.com', 'Sid (demo)', 'student');
      const v = await waitingForCosign(w);
      const done = await waitingForCosign(w);
      expect((await cosign(w, w.ana, done.visit.encounterId, [done.flags, done.note])).status).toBe(200);
      const mark = await auditMark(h);
      const r = await cosign(w, sid, v.visit.encounterId, [v.flags, v.note, done.note]);
      expect(r.status).toBe(409);
      expect(refusal(r.body)).toEqual({ code: 'not_waiting', noteIds: [done.note.noteId] });
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied).toMatchObject({ entity: 'encounter', entityId: v.visit.encounterId });
      expect(denied!.details).toEqual({
        reason: 'cannot_sign',
        route: '/v1/encounters/:encounterId/cosign',
        noteIds: [v.flags.noteId, v.note.noteId],
      });
      expect((await eventsAfter(h, mark)).map((e) => e.action)).toEqual(['access.denied']);
      await unchanged(v.flags, v.note);
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
      expect(await noticesAbout(w.sol.id, 'note_cosigned', v.visit.encounterId)).toEqual([]);
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

  describe('what is logged of a refusal', () => {
    it('a state conflict, a body it cannot take and a visit the team does not have write no audit event', async () => {
      // The coordinator's decision on review finding LPM-2: a refusal about access (403) is logged as
      // access.denied with the reason's name; a 409, a 422 and a 404 are not, as in phases 1 to 3.
      const v = await waitingForCosign(w);
      const read = v.note;
      await correct(w.sol, v.note, h, 'care.plan', 'Demo: soup and a blanket');
      const signed = await chartedVisit(w, w.rae);
      await finish(w.rae, [signed.flags, 'sign', 'signed'], [signed.note, 'sign', 'signed']);
      const mark = await auditMark(h);
      const answers = [
        await cosign(w, w.ana, v.visit.encounterId, [v.flags, read]),
        await cosign(w, w.ana, signed.visit.encounterId, [signed.note]),
        await cosign(w, w.ana, randomUUID(), [v.flags, v.note]),
        await post(w, w.ana.token, path(v.visit.encounterId), { notes: [] }),
      ];
      expect(answers.map((r) => [r.status, refusal(r.body).code])).toEqual([
        [409, 'content_changed'],
        [409, 'not_waiting'],
        [404, 'not_found'],
        [422, 'validation_failed'],
      ]);
      expect(await eventsAfter(h, mark)).toEqual([]);
    });
  });

  describe('what a co-sign writes', () => {
    it('an attending: a cosign sign-off for each note, the notes signed with nothing held, one event per note, one notice per author', async () => {
      const v = await waitingForCosign(w);
      const before = await noteRow(h, v.note.noteId);
      const finished = await finishedBy(v.note);
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
      // Who completed the note and when stay: the sync finds the signature that finished it by them
      // (lifecycle 4.6). The status moved as a field does, so a phone that holds the note learns it.
      expect(await finishedBy(v.note)).toEqual(finished);
      const after = await noteRow(h, v.note.noteId);
      expect(after.version).toBe(before.version + 1);
      expect(after.fieldVersions.status).toBe((before.fieldVersions.status ?? 0) + 1);
      expect(
        await h.scratch.owner`
          select value, previous_value as "previousValue", kind, changed_by as "changedBy" from sineobex.field_history
          where record_id = ${v.note.noteId} and field = 'status' and version = ${after.fieldVersions.status!}`,
      ).toEqual([{ value: 'signed', previousValue: 'completed', kind: 'set', changedBy: w.ana.id }]);

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
      expect(await noticesAbout(w.sol.id, 'note_cosigned', v.visit.encounterId)).toEqual([
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

    it('does not wait for the visit’s Red flags note: one reopened to a draft leaves the other to be co-signed', async () => {
      // The coordinator's decision on review finding LAC-6: the Red flags rule governs finishing a
      // note (red_flags_first), and a co-sign adds a signature to content already finished.
      const v = await waitingForCosign(w);
      const flags = await noteRow(h, v.flags.noteId);
      const reopen = await w.sol.phone.change({
        entity: 'encounter_note',
        op: 'set',
        recordId: v.flags.noteId,
        field: 'status',
        value: 'draft',
        baseVersion: flags.fieldVersions.status ?? 0,
      });
      expect((await w.sol.send(reopen)).map((r) => r.status)).toEqual(['accepted']);
      expect((await noteRow(h, v.flags.noteId)).status).toBe('draft');
      const r = await cosign(w, w.ana, v.visit.encounterId, [v.note]);
      expect(r.status).toBe(200);
      expect((await noteRow(h, v.note.noteId)).status).toBe('signed');
      expect((await noteRow(h, v.flags.noteId)).status).toBe('draft');
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

    it('records the credential the caller holds once the team lock is theirs, not the one read before', async () => {
      // Review finding LAC-4: an admin's demotion to resident takes the team lock first and commits
      // while Pat's co-sign waits for it.
      const pat = await clinician(h, w.t, 'pat@example.com', 'Pat (demo)', 'attending');
      const v = await waitingForCosign(w);
      const body = await actBody([v.flags, v.note], COSIGN_STATEMENT);
      const { waited, answer } = await whileTeamLocked(
        h,
        w.t.teamId,
        () => post(w, pat.token, path(v.visit.encounterId), body),
        (sql) => sql`
          update sineobex.team_memberships set credential = 'resident',
            credential_fields = ${sql.json(CREDENTIAL_FIELDS.resident)}
          where id = ${pat.membershipId}`,
      );
      expect(waited).toBe(true);
      expect(answer.status).toBe(200);
      const [row] = (await signoffRows(h, v.note.noteId)).filter((s) => s.act === 'cosign');
      const { npi, ...fields } = CREDENTIAL_FIELDS.resident;
      expect(row).toMatchObject({
        signerCredential: 'resident',
        signerNpi: npi,
        signerFields: fields,
        needsAttestation: true,
      });
      expect((await noteRow(h, v.note.noteId)).attestation).toBe('waiting');
    });

    it('refuses a caller removed while it waited for the team lock, logged, and writes nothing', async () => {
      const lee = await clinician(h, w.t, 'lee@example.com', 'Lee (demo)', 'attending');
      const v = await waitingForCosign(w);
      const body = await actBody([v.flags, v.note], COSIGN_STATEMENT);
      const mark = await auditMark(h);
      const { answer } = await whileTeamLocked(
        h,
        w.t.teamId,
        () => post(w, lee.token, path(v.visit.encounterId), body),
        (sql) => sql`
          update sineobex.team_memberships set status = 'removed', removed_at = now()
          where id = ${lee.membershipId}`,
      );
      expect(answer.status).toBe(403);
      expect(answer.body.error?.code).toBe('not_a_member');
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ reason: 'not_a_member' });
      await unchanged(v.flags, v.note);
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
