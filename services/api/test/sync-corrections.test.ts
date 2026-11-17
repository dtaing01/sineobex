import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import {
  clinician,
  finishNote,
  installNoteTypes,
  noteOn,
  setCredential,
  setupTeam,
  signoffOf,
  TEST_NOTE_TYPES,
  TEST_RED_FLAGS_TYPE,
  visitOf,
  type Change,
  type Clinician,
  type Team,
  type Visit,
} from './sync-fixtures.ts';

// Phase 4's addenda and corrections through sync (lifecycle 3.6, 4.7): an addendum is taken in
// every state of its note; a correction runs its steps in order, changes several answers together
// and leaves a signature as the table of 3.6 says. Every person and value is made up.

const [TEST_NOTE_TYPE, TEST_MEDICAL_TYPE] = TEST_NOTE_TYPES as [
  (typeof TEST_NOTE_TYPES)[number],
  (typeof TEST_NOTE_TYPES)[number],
];

describe('phase 4 sync: addenda and corrections', () => {
  let h: Harness;
  let t: Team;
  let patientId: string;

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
    await installNoteTypes(h, t.teamId, [TEST_RED_FLAGS_TYPE]);
    patientId = (await createPatient(h, t.teamId, t.adminId)).id;
  });
  afterAll(() => h.close());

  const who = (email: string, name: string, credential: Parameters<typeof clinician>[4], role?: string) =>
    clinician(h, t, email, name, credential, role);

  /** A Medical note signed or completed by [c], after the visit's Red flags note (lifecycle 4.6). */
  async function finishedMedical(
    c: Clinician,
    act: 'complete' | 'sign',
    effect: string,
    answers: Record<string, unknown> = { 'care.plan': 'Demo: rest and fluids' },
    visit?: Visit,
  ) {
    const at = visit ?? (await visitOf(c, patientId));
    const flags = await noteOn(c, at, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
    await finishNote(
      c,
      flags,
      c.credential === 'student' ? 'complete' : 'sign',
      c.credential === 'student' ? 'completed' : 'signed',
    );
    const note = await noteOn(c, at, TEST_MEDICAL_TYPE, answers);
    await finishNote(c, note, act, effect);
    return note;
  }

  const camel = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]),
    );

  const rejectedAs = (c: Change, reason: string, details: Record<string, unknown>) => ({
    changeId: c.changeId,
    status: 'rejected',
    reason,
    message: expect.any(String),
    details,
  });

  describe('addenda (lifecycle 4.7)', () => {
    let dana: Clinician;
    let lee: Clinician;
    let kim: Clinician;

    beforeAll(async () => {
      dana = await who('dana@example.com', 'Dana (demo)', 'attending');
      // Charts, and cannot chart Medical.
      lee = await who('lee@example.com', 'Lee (demo)', 'none');
      // Registers patients and makes referrals: no encounters.chart.
      kim = await who('kim@example.com', 'Kim (demo)', 'chw', 'community_health_worker');
    });

    const addendum = (
      c: Clinician,
      visit: Visit,
      noteId: string | null,
      more: { text?: string; signoffId?: string | null; recordId?: string } & Partial<
        Pick<Change, 'deviceTime' | 'correctedTime' | 'clockVerified'>
      > = {},
    ) => {
      const { text, signoffId, ...change } = more;
      return c.phone.change({
        entity: 'note_addendum',
        op: 'create',
        value: {
          encounterId: visit.encounterId,
          noteId,
          text: text ?? 'Demo: the lab result came back normal',
          signoffId: signoffId ?? null,
        },
        ...change,
      });
    };

    const addendumRow = async (id: string) => {
      const [row] = await h.scratch.owner<Record<string, unknown>[]>`
        select * from sineobex.note_addenda where id = ${id}`;
      return row && camel(row);
    };

    it('is taken in every state of its note, and below the visit itself, from anyone who charts', async () => {
      const visit = await visitOf(dana, patientId);
      const draft = await noteOn(dana, visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: rest' });
      const completed = await noteOn(dana, visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: housing list' });
      await finishNote(dana, completed, 'complete', 'completed');
      const signed = await finishedMedical(dana, 'sign', 'signed', { 'care.plan': 'Demo: fluids' }, visit);

      const mark = await auditMark(h);
      const texts = [
        'Demo: draft addendum',
        'Demo: completed addendum',
        'Demo: signed addendum',
        'Demo: visit addendum',
      ];
      const changes = [
        await addendum(dana, visit, draft.noteId, { text: texts[0] }),
        await addendum(dana, visit, completed.noteId, { text: texts[1] }),
        // An addendum needs no Medical credential: anyone who charts may add one (lifecycle 4.2).
        await addendum(lee, visit, signed.noteId, { text: texts[2] }),
        await addendum(dana, visit, null, { text: texts[3] }),
      ];
      const answers = [
        ...(await dana.send(changes[0]!, changes[1]!)),
        ...(await lee.send(changes[2]!)),
        ...(await dana.send(changes[3]!)),
      ];
      expect(answers).toEqual(
        changes.map((c) => ({
          changeId: c.changeId,
          status: 'accepted',
          serverVersion: 1,
          hash: c.valueHash,
        })),
      );

      const at = new Date(changes[0]!.deviceTime);
      expect(await addendumRow(changes[2]!.recordId)).toEqual({
        id: changes[2]!.recordId,
        teamId: t.teamId,
        encounterId: visit.encounterId,
        noteId: signed.noteId,
        text: texts[2],
        writtenAt: at,
        clockVerified: true,
        authorUserId: lee.id,
        authorName: 'Lee (demo)',
        authorCredential: 'none',
        createdDeviceId: lee.phone.deviceId,
        changeId: changes[2]!.changeId,
        createdAt: expect.any(Date),
      });
      expect(await addendumRow(changes[3]!.recordId)).toMatchObject({
        noteId: null,
        authorCredential: 'attending',
      });
      // Nothing of the notes changed: an addendum is beside a note, never in it.
      const notes = await h.scratch.owner<{ id: string; status: string }[]>`
        select id, status from sineobex.encounter_notes where id in ${h.scratch.owner([draft.noteId, completed.noteId, signed.noteId])}
        order by status`;
      expect(notes.map((n) => n.status).sort()).toEqual(['completed', 'draft', 'signed']);

      const events = await expectAudit(h, 'addendum.added', { after: mark, count: 4 });
      expect(events[2]).toMatchObject({
        actorUserId: lee.id,
        entity: 'note_addendum',
        entityId: changes[2]!.recordId,
        patientId,
        details: {
          changeId: changes[2]!.changeId,
          clockVerified: true,
          encounterId: visit.encounterId,
          noteId: signed.noteId,
        },
      });
      expect(events[3]!.details).toMatchObject({ noteId: null });
      await expectAuditClean(h, texts, mark);

      // Sent again, it answers from its receipt and writes nothing more.
      expect(await lee.send(changes[2]!)).toEqual([answers[2]]);
      await expectAudit(h, 'addendum.added', { after: mark, count: 4 });
    });

    it('records its author as they were when it was written, as a signature does (lifecycle 3.5)', async () => {
      const rae = await who('rae@example.com', 'Rae (demo)', 'resident');
      const visit = await visitOf(rae, patientId);
      // Written now, by a phone whose clock was checked: a time the server can believe.
      const now = new Date().toISOString();
      const written = await addendum(rae, visit, null, { deviceTime: now, correctedTime: now });
      const unchecked = await addendum(rae, visit, null, { deviceTime: now, clockVerified: false });
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(h, t, rae.membershipId, 'attending');
      expect((await rae.send(written, unchecked)).map((r) => r.status)).toEqual(['accepted', 'accepted']);
      expect(await addendumRow(written.recordId)).toMatchObject({
        authorCredential: 'resident',
        clockVerified: true,
      });
      // A time the server cannot believe is no time at all: the credential held now.
      expect(await addendumRow(unchecked.recordId)).toMatchObject({
        authorCredential: 'attending',
        clockVerified: false,
      });
    });

    it('names a note of its visit: another visit’s note answers stale_reference before the insert, as a missing one does', async () => {
      const visit = await visitOf(dana, patientId);
      const other = await visitOf(dana, patientId);
      const theirs = await noteOn(dana, other, TEST_NOTE_TYPE, {});
      const ours = await noteOn(dana, visit, TEST_NOTE_TYPE, {});
      const changes = [
        await addendum(dana, visit, theirs.noteId),
        await addendum(dana, { ...visit, encounterId: randomUUID() }, null),
        await addendum(dana, visit, randomUUID()),
        await addendum(dana, visit, ours.noteId, { signoffId: randomUUID() }),
        // Its IDs are read as IDs, whatever their case.
        await addendum(
          dana,
          { ...visit, encounterId: visit.encounterId.toUpperCase() },
          ours.noteId.toUpperCase(),
        ),
      ];
      const answers = await dana.send(...changes);
      expect(answers.slice(0, 4)).toEqual([
        rejectedAs(changes[0]!, 'stale_reference', { problem: 'encounter_note_missing' }),
        rejectedAs(changes[1]!, 'stale_reference', { problem: 'encounter_missing' }),
        rejectedAs(changes[2]!, 'stale_reference', { problem: 'encounter_note_missing' }),
        rejectedAs(changes[3]!, 'stale_reference', { problem: 'note_signoff_missing' }),
      ]);
      // A refusal never stops the queue.
      expect(answers[4]).toMatchObject({ status: 'accepted' });
      for (const c of changes.slice(0, 4)) expect(await addendumRow(c.recordId)).toBeUndefined();

      // Sent again with the visit of its note, the same record is taken and settles the refusal.
      const fixed = await dana.phone.change({
        entity: 'note_addendum',
        op: 'create',
        recordId: changes[0]!.recordId,
        supersedes: changes[0]!.changeId,
        value: { ...(changes[0]!.value as object), encounterId: other.encounterId },
      });
      expect(await dana.send(fixed)).toEqual([expect.objectContaining({ status: 'accepted' })]);
      expect(await addendumRow(fixed.recordId)).toMatchObject({
        encounterId: other.encounterId,
        noteId: theirs.noteId,
      });
      const [refusal] = await h.scratch.owner<{ resolvedByChange: string | null }[]>`
        select resolved_by_change as "resolvedByChange" from sineobex.sync_changes where change_id = ${changes[0]!.changeId}`;
      expect(refusal!.resolvedByChange).toBe(fixed.changeId);
    });

    it('waits behind its sign-off: an addendum naming a held sign-off is held with it; one without encounters.chart is held', async () => {
      const ash = await who('ash@example.com', 'Ash (demo)', 'np');
      const visit = await visitOf(ash, patientId);
      const flags = await noteOn(ash, visit, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
      const note = await noteOn(ash, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: rest' });
      await setCredential(h, t, ash.membershipId, 'chw');
      // The sign-off of a Medical note is held by the gate (lifecycle 4.2); the addendum is not gated,
      // and waits for the same decision.
      const signs = await signoffOf(ash, flags, 'sign');
      const below = await addendum(ash, visit, flags.noteId, { signoffId: signs.recordId });
      const plain = await addendum(ash, visit, note.noteId);
      expect(await ash.send(signs, below, plain)).toEqual([
        expect.objectContaining({ status: 'rejected', reason: 'permission', quarantined: true }),
        expect.objectContaining({ status: 'rejected', reason: 'awaiting_review', quarantined: true }),
        expect.objectContaining({ status: 'accepted' }),
      ]);
      expect(await addendumRow(below.recordId)).toBeUndefined();

      const fromKim = await addendum(kim, visit, null);
      expect(await kim.send(fromKim)).toEqual([
        expect.objectContaining({ status: 'rejected', reason: 'permission', quarantined: true }),
      ]);
      expect(await addendumRow(fromKim.recordId)).toBeUndefined();
    });

    it('is create-only, and its value is checked before anything is read', async () => {
      const visit = await visitOf(dana, null);
      const taken = await addendum(dana, visit, null);
      expect((await dana.send(taken)).map((r) => r.status)).toEqual(['accepted']);
      const value = taken.value as Record<string, unknown>;
      const bad = (v: Record<string, unknown>) =>
        dana.phone.change({ entity: 'note_addendum', op: 'create', value: { ...value, ...v } });
      const { signoffId: _, ...noSignoff } = value;
      const changes = [
        await dana.phone.change({
          entity: 'note_addendum',
          recordId: taken.recordId,
          op: 'set',
          field: 'text',
          value: 'Demo: changed',
        }),
        await bad({ text: ' Demo: leading space' }),
        await bad({ text: 'D'.repeat(4001) }),
        await bad({ text: '' }),
        await bad({ noteId: 'not-an-id' }),
        await bad({ writtenAt: '2026-10-20T14:50:00.000Z' }),
        await dana.phone.change({ entity: 'note_addendum', op: 'create', value: noSignoff }),
      ];
      const answered = await dana.send(...changes);
      expect(answered.map((r) => [r.status, r.reason])).toEqual(
        changes.map(() => ['rejected', 'validation']),
      );
      expect(answered[0]!.details).toEqual({ problem: 'unknown_field' });
      expect(
        answered.slice(1).map((r) => (r.details!.problems as { path: string }[]).map((p) => p.path)),
      ).toEqual([['text'], ['text'], ['text'], ['noteId'], [''], ['signoffId']]);
      // The longest text is taken.
      const longest = await bad({ text: 'D'.repeat(4000) });
      expect((await dana.send(longest)).map((r) => r.status)).toEqual(['accepted']);
    });
  });
});
