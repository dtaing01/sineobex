import { randomUUID } from 'node:crypto';
import { effectiveAnswers, finishCheck, validate, type ResolvedNoteType } from '@sineobex/forms';
import { checkFile } from '@sineobex/forms/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '../src/auth/permissions.ts';
import { applyInSavepoint, type ApplyActor } from '../src/sync/apply.ts';
import type { SyncChangeInput } from '../src/sync/schemas.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import {
  call,
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
  type HeldNote,
  type Team,
  type Visit,
} from './sync-fixtures.ts';

// Phase 4's addenda and corrections through sync (lifecycle 3.6, 4.7): an addendum is taken in
// every state of its note; a correction runs its steps in order, changes several answers together
// and leaves a signature as the table of 3.6 says. Every person and value is made up.

const [TEST_NOTE_TYPE, TEST_MEDICAL_TYPE] = TEST_NOTE_TYPES as [ResolvedNoteType, ResolvedNoteType];

/**
 * A test-only Medical note type in which one answer opens another, as "EMS activated" does: Yes
 * makes the time it was called required (lifecycle 4.7). Installed in this file's team only.
 */
const TEST_EMS_TYPE: ResolvedNoteType = {
  key: 'test_ems',
  version: 1,
  title: 'Test EMS note',
  kinds: ['medical'],
  group: 'clinical',
  sensitivity: 'none',
  sections: [
    {
      id: 'ems',
      title: 'EMS',
      fields: [
        {
          id: 'activated',
          kind: 'choice',
          label: 'EMS activated?',
          many: false,
          options: [
            { code: 'no', label: 'No' },
            { code: 'yes', label: 'Yes' },
          ],
          required: true,
        },
        {
          id: 'called',
          kind: 'text',
          label: 'Time EMS was called',
          lines: 'one',
          maxLength: 20,
          required: true,
          showWhen: { field: 'ems.activated', is: 'yes' },
        },
      ],
    },
  ],
} as ResolvedNoteType;

describe('phase 4 sync: addenda and corrections', () => {
  let h: Harness;
  let t: Team;
  let patientId: string;

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
    await installNoteTypes(h, t.teamId, [TEST_RED_FLAGS_TYPE, TEST_EMS_TYPE]);
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
    type = TEST_MEDICAL_TYPE,
  ) {
    const at = visit ?? (await visitOf(c, patientId));
    const flags = await noteOn(c, at, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
    await finishNote(
      c,
      flags,
      c.credential === 'student' ? 'complete' : 'sign',
      c.credential === 'student' ? 'completed' : 'signed',
    );
    const note = await noteOn(c, at, type, answers);
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

    it('names a sign-off of its own note, or with no note of a note of its visit: any other is refused as a missing one is', async () => {
      const visit = await visitOf(dana, patientId);
      const other = await visitOf(dana, patientId);
      const draft = await noteOn(dana, visit, TEST_NOTE_TYPE, {});
      const done = await noteOn(dana, visit, TEST_NOTE_TYPE, {});
      const elsewhere = await noteOn(dana, other, TEST_NOTE_TYPE, {});
      const ours = await finishNote(dana, done, 'complete', 'completed');
      const theirs = await finishNote(dana, elsewhere, 'complete', 'completed');
      const changes = [
        await addendum(dana, visit, draft.noteId, { signoffId: ours.recordId }),
        await addendum(dana, visit, null, { signoffId: theirs.recordId }),
        await addendum(dana, visit, done.noteId, { signoffId: ours.recordId }),
        await addendum(dana, visit, null, { signoffId: ours.recordId }),
      ];
      const answers = await dana.send(...changes);
      expect(answers.slice(0, 2)).toEqual([
        rejectedAs(changes[0]!, 'stale_reference', { problem: 'note_signoff_missing' }),
        rejectedAs(changes[1]!, 'stale_reference', { problem: 'note_signoff_missing' }),
      ]);
      expect(answers.slice(2).map((r) => r.status)).toEqual(['accepted', 'accepted']);
      for (const c of changes.slice(0, 2)) expect(await addendumRow(c.recordId)).toBeUndefined();
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
  describe('corrections (lifecycle 3.6, 4.7)', () => {
    let cora: Clinician;
    let dev: Clinician;
    let ren: Clinician;
    let sol: Clinician;
    let pat: Clinician;

    beforeAll(async () => {
      // Charts, and cannot chart Medical: Non-Medical notes only.
      cora = await who('cora@example.com', 'Cora (demo)', 'none');
      dev = await who('dev@example.com', 'Dev (demo)', 'attending');
      ren = await who('ren@example.com', 'Ren (demo)', 'resident');
      sol = await who('sol@example.com', 'Sol (demo)', 'student');
      // Co-signs and attests others' notes.
      pat = await who('pat@example.com', 'Pat (demo)', 'attending');
    });

    /** One answer a correction changes: its new value and the version of it the person saw. */
    const answer = (path: string, newValue: unknown, baseVersion = 1) => ({
      field: `data.${path}`,
      newValue,
      baseVersion,
    });

    const correction = (
      c: Clinician,
      n: { noteId: string },
      changes: { field: string; newValue: unknown; baseVersion: number }[],
      more: {
        reason?: string;
        requestedByPatient?: boolean;
        declined?: boolean;
        claimedCredential?: string | null;
        signoffId?: string | null;
        recordId?: string;
        supersedes?: string;
        deviceTime?: string;
        correctedTime?: string;
        clockVerified?: boolean;
      } = {},
    ) => {
      const { reason, requestedByPatient, declined, claimedCredential, signoffId, ...change } = more;
      return c.phone.change({
        entity: 'note_correction',
        op: 'create',
        value: {
          noteId: n.noteId,
          changes,
          reason: reason ?? 'Demo: the wrong field was picked',
          requestedByPatient: requestedByPatient ?? false,
          declined: declined ?? false,
          claimedCredential: claimedCredential !== undefined ? claimedCredential : c.credential,
          signoffId: signoffId ?? null,
        },
        ...change,
      });
    };

    /** The same correction record sent again, as the phone's fix path sends it. */
    const again = (
      c: Clinician,
      refused: Change,
      changes: { field: string; newValue: unknown; baseVersion: number }[],
    ) =>
      c.phone.change({
        entity: 'note_correction',
        op: 'create',
        recordId: refused.recordId,
        supersedes: refused.changeId,
        value: { ...(refused.value as Record<string, unknown>), changes },
      });

    const taken = (c: Change, outcome: string, status: string, attestation: string) => ({
      changeId: c.changeId,
      status: 'accepted',
      serverVersion: 1,
      hash: c.valueHash,
      details: { outcome, status, attestation },
    });

    const noteRow = async (id: string) =>
      (
        await h.scratch.owner<
          {
            status: string;
            attestation: string;
            signoffId: string | null;
            firstSignedAt: Date | null;
            completedAt: Date | null;
            data: Record<string, unknown>;
            fieldVersions: Record<string, number>;
            version: number;
          }[]
        >`
          select status, attestation, signoff_id as "signoffId", first_signed_at as "firstSignedAt",
                 completed_at as "completedAt", data, field_versions as "fieldVersions", version
          from sineobex.encounter_notes where id = ${id}`
      )[0]!;

    const correctionRow = async (id: string) => {
      const [row] = await h.scratch.owner<Record<string, unknown>[]>`
        select * from sineobex.note_corrections where id = ${id}`;
      return row && camel(row);
    };

    const historyBy = (noteId: string, changeId: string) =>
      h.scratch.owner<Record<string, unknown>[]>`
        select id::text as id, field, version, value, previous_value as "previousValue", kind,
               changed_by as "changedBy", approved_by as "approvedBy"
        from sineobex.field_history where record_id = ${noteId} and change_id = ${changeId} order by id`;

    const noticesOn = (recordId: string, after = new Date(0)) =>
      h.scratch.owner<{ userId: string; kind: string; entity: string }[]>`
        select user_id as "userId", kind, entity from sineobex.user_notices
        where record_id = ${recordId} and created_at > ${after} order by created_at, id`;

    /** Someone else co-signs [n] online, as L2's route will: the sign-off row, then the note (0019). */
    async function cosign(n: HeldNote, by: Clinician): Promise<string> {
      const id = randomUUID();
      await h.scratch.owner`
        insert into sineobex.note_signoffs (id, team_id, note_id, act, effect, content_hash, signer_user_id,
          signer_name, signer_credential, signer_npi, needs_attestation, statement_version, signed_at, clock_verified)
        values (${id}, ${t.teamId}, ${n.noteId}, 'cosign', 'signed', ${'c'.repeat(64)}, ${by.id}, ${by.displayName},
          ${by.credential}, '1234567893', false, 'cosign-2026-11', now(), true)`;
      await h.scratch.owner`
        update sineobex.encounter_notes set status = 'signed', signoff_id = ${id}, first_signed_at = now(),
          attestation = 'not_needed'
        where id = ${n.noteId}`;
      return id;
    }

    /** An attending attests [n]'s current signature online, as L2's route will. */
    async function attest(n: HeldNote, by: Clinician) {
      await h.scratch.owner`
        insert into sineobex.note_attestations (team_id, note_id, signoff_id, content_hash, attending_user_id,
          attending_name, attending_npi, statement_version)
        select team_id, id, signoff_id, ${'a'.repeat(64)}, ${by.id}, ${by.displayName}, '1234567893', 'attest-2026-11'
        from sineobex.encounter_notes where id = ${n.noteId}`;
      await h.scratch
        .owner`update sineobex.encounter_notes set attestation = 'attested' where id = ${n.noteId}`;
    }

    it('the test-only EMS note type is one the export would take: Yes makes the time required', () => {
      expect(checkFile('noteType', TEST_EMS_TYPE)).toEqual([]);
      expect(validate(TEST_EMS_TYPE, { noteType: () => undefined })).toEqual([]);
      expect(finishCheck(TEST_EMS_TYPE, { 'ems.activated': 'no' })).toEqual([]);
      expect(finishCheck(TEST_EMS_TYPE, { 'ems.activated': 'yes' }).map((p) => p.path)).toEqual([
        'ems.called',
      ]);
    });

    it('a finished note’s answers are corrected together: each written as corrected, the row keeps old and new, and the note shows the new', async () => {
      const visit = await visitOf(cora, patientId);
      const note = await noteOn(cora, visit, TEST_NOTE_TYPE, {
        'care.plan': 'Demo: rest',
        'vitals.pulse': 80,
      });
      await finishNote(cora, note, 'complete', 'completed');
      const before = await noteRow(note.noteId);

      const mark = await auditMark(h);
      const reason = 'Demo: pulse taken twice, second reading';
      const fix = await correction(
        cora,
        note,
        [
          answer('care.plan', 'Demo: rest and fluids'),
          answer('vitals.pulse', 88),
          // An answer the note did not hold is corrected in as well.
          answer('care.followup', 'Demo: clinic on Tuesday', 0),
        ],
        { reason },
      );
      const [receipt] = await cora.send(fix);
      expect(receipt).toEqual(taken(fix, 'corrected', 'completed', 'not_needed'));

      expect(await noteRow(note.noteId)).toEqual({
        ...before,
        data: {
          'care.plan': 'Demo: rest and fluids',
          'vitals.pulse': 88,
          'care.followup': 'Demo: clinic on Tuesday',
        },
        fieldVersions: {
          ...before.fieldVersions,
          'data.care.plan': 2,
          'data.vitals.pulse': 2,
          'data.care.followup': 1,
        },
        version: before.version + 1,
      });
      const history = await historyBy(note.noteId, fix.changeId);
      expect(history.map(({ id: _, ...row }) => row)).toEqual([
        {
          field: 'data.care.plan',
          version: 2,
          value: 'Demo: rest and fluids',
          previousValue: 'Demo: rest',
          kind: 'corrected',
          changedBy: cora.id,
          approvedBy: null,
        },
        {
          field: 'data.vitals.pulse',
          version: 2,
          value: 88,
          previousValue: 80,
          kind: 'corrected',
          changedBy: cora.id,
          approvedBy: null,
        },
        {
          field: 'data.care.followup',
          version: 1,
          value: 'Demo: clinic on Tuesday',
          previousValue: null,
          kind: 'corrected',
          changedBy: cora.id,
          approvedBy: null,
        },
      ]);
      expect(await correctionRow(fix.recordId)).toEqual({
        id: fix.recordId,
        teamId: t.teamId,
        noteId: note.noteId,
        changes: [
          {
            field: 'data.care.plan',
            oldValue: 'Demo: rest',
            newValue: 'Demo: rest and fluids',
            historyId: history[0]!.id,
          },
          { field: 'data.vitals.pulse', oldValue: 80, newValue: 88, historyId: history[1]!.id },
          {
            field: 'data.care.followup',
            oldValue: null,
            newValue: 'Demo: clinic on Tuesday',
            historyId: history[2]!.id,
          },
        ],
        outcome: 'corrected',
        reason,
        requestedByPatient: false,
        correctorUserId: cora.id,
        correctorName: 'Cora (demo)',
        correctorCredential: 'none',
        claimedCredential: 'none',
        correctedAt: new Date(fix.deviceTime),
        clockVerified: true,
        createdDeviceId: cora.phone.deviceId,
        changeId: fix.changeId,
        createdAt: expect.any(Date),
      });

      const [event] = await expectAudit(h, 'note.corrected', { after: mark, count: 1 });
      expect(event).toMatchObject({
        actorUserId: cora.id,
        entity: 'encounter_note',
        entityId: note.noteId,
        patientId,
      });
      expect(event!.details).toEqual({
        changeId: fix.changeId,
        correctionId: fix.recordId,
        fields: ['data.care.plan', 'data.vitals.pulse', 'data.care.followup'],
        outcome: 'corrected',
        requestedByPatient: false,
        credential: 'none',
        statusAfter: 'completed',
        attestationAfter: 'not_needed',
        clockVerified: true,
      });
      await expectAuditClean(h, [reason, 'Demo: rest and fluids', 'Demo: clinic'], mark);

      // Sent again, it answers from its receipt and writes nothing more.
      expect(await cora.send(fix)).toEqual([receipt]);
      await expectAudit(h, 'note.corrected', { after: mark, count: 1 });
      expect((await noteRow(note.noteId)).version).toBe(before.version + 1);
    });

    it('the corrector’s credential decides what is left of a signature: each row of the table in 3.6', async () => {
      // An attending's own note: unchanged, signed, and the same signature.
      const own = await finishedMedical(dev, 'sign', 'signed');
      const ownBefore = await noteRow(own.noteId);
      // A resident's note waits for attestation, and waits again after a correction.
      const waits = await finishedMedical(ren, 'sign', 'signed');
      // A resident's note an attending attested: it waits for attestation again, and the attester is told.
      const attested = await finishedMedical(ren, 'sign', 'signed');
      await attest(attested, pat);
      // A student's note an attending co-signed: back to waiting for a co-signer, and the co-signer is told.
      const cosigned = await finishedMedical(sol, 'complete', 'completed');
      const cosignId = await cosign(cosigned, pat);
      // A student's note waiting for a co-signer: unchanged.
      const pending = await finishedMedical(sol, 'complete', 'completed');
      // An attested note its attending corrects: still attested, since the attending signs it.
      const kept = await finishedMedical(dev, 'sign', 'signed');
      await attest(kept, pat);
      const since = new Date();

      const fixes = [
        await correction(dev, own, [answer('care.plan', 'Demo: fluids and rest')]),
        await correction(ren, waits, [answer('care.plan', 'Demo: fluids and rest')]),
        await correction(ren, attested, [answer('care.plan', 'Demo: fluids and rest')]),
        await correction(sol, cosigned, [answer('care.plan', 'Demo: fluids and rest')]),
        await correction(sol, pending, [answer('care.plan', 'Demo: fluids and rest')]),
        await correction(dev, kept, [answer('care.plan', 'Demo: fluids and rest')]),
      ];
      expect(await dev.send(fixes[0]!, fixes[5]!)).toEqual([
        taken(fixes[0]!, 'corrected', 'signed', 'not_needed'),
        taken(fixes[5]!, 'corrected', 'signed', 'attested'),
      ]);
      expect(await ren.send(fixes[1]!, fixes[2]!)).toEqual([
        taken(fixes[1]!, 'corrected', 'signed', 'waiting'),
        taken(fixes[2]!, 'corrected', 'signed', 'waiting'),
      ]);
      expect(await sol.send(fixes[3]!, fixes[4]!)).toEqual([
        taken(fixes[3]!, 'corrected', 'completed', 'not_needed'),
        taken(fixes[4]!, 'corrected', 'completed', 'not_needed'),
      ]);

      expect(await noteRow(own.noteId)).toMatchObject({
        status: 'signed',
        attestation: 'not_needed',
        signoffId: ownBefore.signoffId,
        fieldVersions: { ...ownBefore.fieldVersions, 'data.care.plan': 2 },
      });
      expect(await noteRow(waits.noteId)).toMatchObject({ status: 'signed', attestation: 'waiting' });
      expect(await noteRow(attested.noteId)).toMatchObject({ status: 'signed', attestation: 'waiting' });
      const student = await noteRow(cosigned.noteId);
      expect(student).toMatchObject({ status: 'completed', attestation: 'not_needed', signoffId: null });
      // Ever signed, so it can never be reopened (0018).
      expect(student.firstSignedAt).not.toBeNull();
      expect(await noteRow(pending.noteId)).toMatchObject({ status: 'completed', signoffId: null });
      // The status moved only where the signature went, and its history says so.
      const moved = await historyBy(cosigned.noteId, fixes[3]!.changeId);
      expect(moved.map((r) => [r.field, r.kind, r.value, r.previousValue])).toEqual([
        ['data.care.plan', 'corrected', 'Demo: fluids and rest', 'Demo: rest and fluids'],
        ['status', 'set', 'completed', 'signed'],
      ]);
      expect((await historyBy(own.noteId, fixes[0]!.changeId)).map((r) => r.field)).toEqual([
        'data.care.plan',
      ]);
      expect(await correctionRow(fixes[3]!.recordId)).toMatchObject({ correctorCredential: 'student' });
      const [signature] = await h.scratch.owner<{ id: string }[]>`
        select id from sineobex.note_signoffs where id = ${cosignId}`;
      expect(signature).toBeDefined();

      // "A note you signed was corrected. It needs your review again."
      expect(await noticesOn(attested.noteId, since)).toEqual([
        { userId: pat.id, kind: 'note_corrected', entity: 'encounter_note' },
      ]);
      expect(await noticesOn(cosigned.noteId, since)).toEqual([
        { userId: pat.id, kind: 'note_corrected', entity: 'encounter_note' },
      ]);
      for (const n of [own, waits, pending, kept]) expect(await noticesOn(n.noteId, since)).toEqual([]);
      const [event] = await h.scratch.owner<{ details: Record<string, unknown> }[]>`
        select details from sineobex.audit_events
        where action = 'note.corrected' and details->>'correctionId' = ${fixes[3]!.recordId}`;
      expect(event!.details).toMatchObject({
        credential: 'student',
        statusAfter: 'completed',
        attestationAfter: 'not_needed',
      });
    });

    it('the corrector’s credential is found as a signature’s is: corrected Monday, promoted Tuesday, synced Wednesday', async () => {
      const kai = await who('kai@example.com', 'Kai (demo)', 'resident');
      const note = await finishedMedical(kai, 'sign', 'signed');
      await attest(note, pat);
      // Monday: Kai corrects the note offline, on a phone whose clock was checked.
      const monday = new Date().toISOString();
      const fix = await correction(kai, note, [answer('care.plan', 'Demo: fluids')], {
        deviceTime: monday,
        correctedTime: monday,
      });
      // Tuesday: an admin makes Kai an attending.
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(h, t, kai.membershipId, 'attending');
      // Wednesday: it syncs. Corrected as a resident, the note waits for attestation again.
      expect(await kai.send(fix)).toEqual([taken(fix, 'corrected', 'signed', 'waiting')]);
      expect(await correctionRow(fix.recordId)).toMatchObject({
        correctorCredential: 'resident',
        claimedCredential: 'resident',
        correctedAt: new Date(monday),
      });
    });

    describe('each step, in the order of 4.7', () => {
      it('1. whoever does not act as the author is told, and nothing changes: before the Medical gate', async () => {
        const note = await finishedMedical(dev, 'sign', 'signed');
        const before = await noteRow(note.noteId);
        const since = new Date();
        const mark = await auditMark(h);
        const fromPat = await correction(pat, note, [answer('care.plan', 'Demo: other plan')]);
        // Cora may not chart a Medical note; not being its author answers first, and nothing is held.
        const fromCora = await correction(cora, note, [answer('care.plan', 'Demo: other plan')]);
        expect(await pat.send(fromPat)).toEqual([taken(fromPat, 'not_author', 'signed', 'not_needed')]);
        expect(await cora.send(fromCora)).toEqual([taken(fromCora, 'not_author', 'signed', 'not_needed')]);
        expect(await noteRow(note.noteId)).toEqual(before);
        expect(await correctionRow(fromPat.recordId)).toMatchObject({
          outcome: 'not_author',
          changes: [
            {
              field: 'data.care.plan',
              oldValue: 'Demo: rest and fluids',
              newValue: 'Demo: other plan',
              historyId: null,
            },
          ],
          correctorUserId: pat.id,
          correctorCredential: 'attending',
        });
        expect(await historyBy(note.noteId, fromPat.changeId)).toEqual([]);
        // "Only the note's author can do that. Nothing was changed."
        expect(await noticesOn(note.noteId, since)).toEqual([
          { userId: pat.id, kind: 'change_not_applied', entity: 'encounter_note' },
          { userId: cora.id, kind: 'change_not_applied', entity: 'encounter_note' },
        ]);
        const events = await expectAudit(h, 'note.corrected', { after: mark, count: 2 });
        expect(events[0]!.details).toMatchObject({ outcome: 'not_author', statusAfter: 'signed' });
      });

      it('3. the Medical gate holds a correction from someone who may no longer chart one; an admin’s accept applies it', async () => {
        const noa = await who('noa@example.com', 'Noa (demo)', 'np');
        const note = await finishedMedical(noa, 'sign', 'signed');
        await setCredential(h, t, noa.membershipId, 'chw');
        const fix = await correction(noa, note, [answer('care.plan', 'Demo: fluids')]);
        expect(await noa.send(fix)).toEqual([
          expect.objectContaining({ status: 'rejected', reason: 'permission', quarantined: true }),
        ]);
        expect(await correctionRow(fix.recordId)).toBeUndefined();
        expect((await noteRow(note.noteId)).data['care.plan']).toBe('Demo: rest and fluids');

        const [item] = await h.scratch.owner<{ id: string }[]>`
          select id from sineobex.quarantine_items where change_id = ${fix.changeId}`;
        const decided = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision: 'accept', reason: 'Demo: checked with Noa' },
        });
        expect(decided.status).toBe(200);
        // Recorded under the credential Noa holds now, which cannot sign: the note waits for a co-signer.
        expect(await correctionRow(fix.recordId)).toMatchObject({
          outcome: 'corrected',
          correctorCredential: 'chw',
        });
        expect(await noteRow(note.noteId)).toMatchObject({ status: 'completed', signoffId: null });
        expect(await historyBy(note.noteId, fix.changeId)).toEqual([
          expect.objectContaining({
            field: 'data.care.plan',
            kind: 'corrected',
            changedBy: noa.id,
            approvedBy: t.adminId,
          }),
          expect.objectContaining({ field: 'status', kind: 'set', approvedBy: t.adminId }),
        ]);
        // Noa's phone still showed np: the event names the claim beside what was recorded.
        const [event] = await h.scratch.owner<{ actorUserId: string; details: Record<string, unknown> }[]>`
          select actor_user_id as "actorUserId", details from sineobex.audit_events
          where action = 'note.corrected' and details->>'correctionId' = ${fix.recordId}`;
        expect(event).toMatchObject({
          actorUserId: t.adminId,
          details: { onBehalfOf: noa.id, credential: 'chw', claimedCredential: 'np' },
        });
      });

      it('4. a declined amendment request is stored and the note is unchanged; only a request is declined', async () => {
        const note = await finishedMedical(dev, 'sign', 'signed');
        const before = await noteRow(note.noteId);
        const mark = await auditMark(h);
        const declined = await correction(
          dev,
          note,
          [answer('care.plan', 'Demo: what the patient asked for')],
          {
            requestedByPatient: true,
            declined: true,
            reason: 'Demo: the plan was recorded as given',
          },
        );
        const notARequest = await correction(dev, note, [answer('care.plan', 'Demo: other')], {
          declined: true,
        });
        const accepted = await correction(dev, note, [answer('care.plan', 'Demo: as the patient asked')], {
          requestedByPatient: true,
        });
        const answers = await dev.send(declined, notARequest, accepted);
        expect(answers[0]).toEqual(taken(declined, 'declined', 'signed', 'not_needed'));
        expect(answers[1]).toMatchObject({ status: 'rejected', reason: 'validation' });
        expect((answers[1]!.details!.problems as { path: string }[]).map((p) => p.path)).toEqual([
          'declined',
        ]);
        expect(answers[2]).toEqual(taken(accepted, 'corrected', 'signed', 'not_needed'));
        expect(await correctionRow(declined.recordId)).toMatchObject({
          outcome: 'declined',
          requestedByPatient: true,
          changes: [
            {
              field: 'data.care.plan',
              oldValue: 'Demo: rest and fluids',
              newValue: 'Demo: what the patient asked for',
              historyId: null,
            },
          ],
        });
        expect(await historyBy(note.noteId, declined.changeId)).toEqual([]);
        expect(await correctionRow(accepted.recordId)).toMatchObject({
          outcome: 'corrected',
          requestedByPatient: true,
        });
        expect((await noteRow(note.noteId)).version).toBe(before.version + 1);
        const [event] = await expectAudit(h, 'note.amendment_declined', { after: mark, count: 1 });
        expect(event!.details).toMatchObject({
          correctionId: declined.recordId,
          fields: ['data.care.plan'],
          outcome: 'declined',
          requestedByPatient: true,
        });
        await expectAuditClean(h, ['Demo: what the patient asked for', 'Demo: the plan was recorded'], mark);
      });

      it('5. each new value is one the note type takes, named by its field; checked before the version', async () => {
        const visit = await visitOf(cora, patientId);
        const note = await noteOn(cora, visit, TEST_NOTE_TYPE, { 'vitals.pulse': 80 });
        await finishNote(cora, note, 'complete', 'completed');
        const changes = [
          await correction(cora, note, [answer('care.plan', 'Demo: fine', 0), answer('vitals.pulse', 400)]),
          await correction(cora, note, [answer('nope.here', 'Demo: x', 0)]),
          // A version the person did not see, and a value the type refuses: the value answers.
          await correction(cora, note, [answer('vitals.pulse', 'fast', 7)]),
        ];
        expect(await cora.send(...changes)).toEqual([
          rejectedAs(changes[0]!, 'validation', { problem: 'out_of_range', field: 'data.vitals.pulse' }),
          rejectedAs(changes[1]!, 'validation', { problem: 'unknown_path', field: 'data.nope.here' }),
          rejectedAs(changes[2]!, 'validation', { problem: 'wrong_type', field: 'data.vitals.pulse' }),
        ]);
        for (const c of changes) expect(await correctionRow(c.recordId)).toBeUndefined();
        expect((await noteRow(note.noteId)).data).toEqual({ 'vitals.pulse': 80 });
      });

      it('6 and 7. an answer that moved since is field_changed: Correct again is taken, Leave it is no change', async () => {
        const visit = await visitOf(cora, patientId);
        const note = await noteOn(cora, visit, TEST_NOTE_TYPE, {
          'vitals.pulse': 80,
          'care.plan': 'Demo: rest',
        });
        await finishNote(cora, note, 'complete', 'completed');
        // Two phones correct the same answer from what each saw: the first is taken.
        const first = await correction(cora, note, [answer('vitals.pulse', 88)]);
        const second = await correction(cora, note, [
          answer('vitals.pulse', 92),
          answer('care.plan', 'Demo: fluids'),
        ]);
        const third = await correction(cora, note, [answer('vitals.pulse', 84)]);
        expect(await cora.send(first, second, third)).toEqual([
          taken(first, 'corrected', 'completed', 'not_needed'),
          rejectedAs(second, 'validation', { problem: 'field_changed', field: 'data.vitals.pulse' }),
          rejectedAs(third, 'validation', { problem: 'field_changed', field: 'data.vitals.pulse' }),
        ]);
        expect(await correctionRow(second.recordId)).toBeUndefined();

        // Correct again: the same record, with the version now seen.
        const correctAgain = await again(cora, second, [
          answer('vitals.pulse', 92, 2),
          answer('care.plan', 'Demo: fluids'),
        ]);
        // Leave it: the same record, with the answer the note holds.
        const leaveIt = await again(cora, third, [answer('vitals.pulse', 92, 3)]);
        const before = await noteRow(note.noteId);
        expect(await cora.send(correctAgain)).toEqual([
          taken(correctAgain, 'corrected', 'completed', 'not_needed'),
        ]);
        const after = await noteRow(note.noteId);
        expect(after.data).toEqual({ 'vitals.pulse': 92, 'care.plan': 'Demo: fluids' });
        expect(after.version).toBe(before.version + 1);
        expect(await cora.send(leaveIt)).toEqual([taken(leaveIt, 'no_change', 'completed', 'not_needed')]);
        expect(await noteRow(note.noteId)).toEqual(after);
        expect(await historyBy(note.noteId, leaveIt.changeId)).toEqual([]);
        expect(await correctionRow(leaveIt.recordId)).toMatchObject({
          outcome: 'no_change',
          changes: [{ field: 'data.vitals.pulse', oldValue: 92, newValue: 92, historyId: null }],
        });
        // Each fix settles the refusal it was sent for.
        const refusals = await h.scratch.owner<{ changeId: string; resolvedByChange: string | null }[]>`
          select change_id as "changeId", resolved_by_change as "resolvedByChange" from sineobex.sync_changes
          where change_id in ${h.scratch.owner([second.changeId, third.changeId])} order by device_seq`;
        expect(refusals).toEqual([
          { changeId: second.changeId, resolvedByChange: correctAgain.changeId },
          { changeId: third.changeId, resolvedByChange: leaveIt.changeId },
        ]);
        // The same value at a version the person did not see is still field_changed: step 6 comes first.
        const stale = await correction(cora, note, [answer('vitals.pulse', 92, 2)]);
        expect(await cora.send(stale)).toEqual([
          rejectedAs(stale, 'validation', { problem: 'field_changed', field: 'data.vitals.pulse' }),
        ]);
      });

      it('8. one answer opens another: corrected alone it fails the finish check, together with the other it is taken', async () => {
        const note = await finishedMedical(
          dev,
          'sign',
          'signed',
          { 'ems.activated': 'no' },
          undefined,
          TEST_EMS_TYPE,
        );
        const before = await noteRow(note.noteId);
        const alone = await correction(dev, note, [answer('ems.activated', 'yes')]);
        const together = await correction(dev, note, [
          answer('ems.activated', 'yes'),
          answer('ems.called', 'Demo: 14:20', 0),
        ]);
        expect(await dev.send(alone, together)).toEqual([
          rejectedAs(alone, 'validation', { problem: 'incomplete' }),
          taken(together, 'corrected', 'signed', 'not_needed'),
        ]);
        expect(await correctionRow(alone.recordId)).toBeUndefined();
        expect((await noteRow(note.noteId)).data).toEqual({
          'ems.activated': 'yes',
          'ems.called': 'Demo: 14:20',
        });
        expect((await noteRow(note.noteId)).version).toBe(before.version + 1);
      });

      it('2. a note reopened since is edited as a draft, by the draft rule; a declined request still changes nothing', async () => {
        const note = await finishedMedical(sol, 'complete', 'completed', {
          'care.plan': 'Demo: rest',
          'vitals.pulse': 80,
        });
        const reopen = await sol.phone.change({
          entity: 'encounter_note',
          recordId: note.noteId,
          op: 'set',
          field: 'status',
          value: 'draft',
          baseVersion: 2,
        });
        expect((await sol.send(reopen)).map((r) => r.status)).toEqual(['accepted']);
        // Someone else's edit to the draft since the person looked.
        const edit = await sol.phone.change({
          entity: 'encounter_note',
          recordId: note.noteId,
          op: 'set',
          field: 'data.care.plan',
          value: 'Demo: rest and fluids',
          baseVersion: 1,
        });
        expect((await sol.send(edit)).map((r) => r.status)).toEqual(['accepted']);
        const before = await noteRow(note.noteId);
        const mark = await auditMark(h);

        const changes = [
          await correction(sol, note, [
            answer('vitals.pulse', 84),
            answer('care.allergies', 'Demo: none known', 3),
          ]),
          // The plan the person saw has changed since: never overwritten silently.
          await correction(sol, note, [answer('care.plan', 'Demo: fluids')]),
          await correction(sol, note, [answer('vitals.pulse', 90, 2)], {
            requestedByPatient: true,
            declined: true,
          }),
          // A draft's answers are checked against its type, as any set of them is.
          await correction(sol, note, [answer('vitals.pulse', 999, 2)]),
        ];
        expect(await sol.send(...changes)).toEqual([
          taken(changes[0]!, 'draft_edit', 'draft', 'not_needed'),
          rejectedAs(changes[1]!, 'validation', { problem: 'field_changed', field: 'data.care.plan' }),
          taken(changes[2]!, 'declined', 'draft', 'not_needed'),
          rejectedAs(changes[3]!, 'validation', { problem: 'out_of_range', field: 'data.vitals.pulse' }),
        ]);
        const after = await noteRow(note.noteId);
        expect(after).toMatchObject({
          status: 'draft',
          data: {
            'care.plan': 'Demo: rest and fluids',
            'vitals.pulse': 84,
            'care.allergies': 'Demo: none known',
          },
          fieldVersions: { ...before.fieldVersions, 'data.vitals.pulse': 2, 'data.care.allergies': 1 },
          version: before.version + 1,
        });
        // The person saw the pulse; the allergies were blank, so they fill.
        expect((await historyBy(note.noteId, changes[0]!.changeId)).map((r) => [r.field, r.kind])).toEqual([
          ['data.vitals.pulse', 'set'],
          ['data.care.allergies', 'filled_blank'],
        ]);
        expect(await correctionRow(changes[0]!.recordId)).toMatchObject({ outcome: 'draft_edit' });
        const events = await expectAudit(h, 'note.corrected', { after: mark, count: 1 });
        expect(events[0]!.details).toMatchObject({ outcome: 'draft_edit', statusAfter: 'draft' });
      });

      it('a draft edit to a Medical note is held by the gate as any set of it is', async () => {
        const vic = await who('vic@example.com', 'Vic (demo)', 'pa');
        const visit = await visitOf(vic, patientId);
        const note = await noteOn(vic, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: rest' });
        await setCredential(h, t, vic.membershipId, 'none');
        const fix = await correction(vic, note, [answer('care.plan', 'Demo: fluids')]);
        expect(await vic.send(fix)).toEqual([
          expect.objectContaining({ status: 'rejected', reason: 'permission', quarantined: true }),
        ]);
        expect((await noteRow(note.noteId)).data).toEqual({ 'care.plan': 'Demo: rest' });
      });
    });

    it('a correction can hide an answer, which stays in the note and counts again once shown', async () => {
      const visit = await visitOf(cora, patientId);
      const note = await noteOn(cora, visit, TEST_NOTE_TYPE, { 'more.detail': 'Demo: walks with a cane' });
      await finishNote(cora, note, 'complete', 'completed');
      const hide = await correction(cora, note, [answer('more.none', true, 0)]);
      expect(await cora.send(hide)).toEqual([taken(hide, 'corrected', 'completed', 'not_needed')]);
      const hidden = (await noteRow(note.noteId)).data;
      expect(hidden).toEqual({ 'more.detail': 'Demo: walks with a cane', 'more.none': true });
      expect(effectiveAnswers(TEST_NOTE_TYPE, hidden)).toEqual({ 'more.none': true });
      const show = await correction(cora, note, [answer('more.none', null)]);
      expect(await cora.send(show)).toEqual([taken(show, 'corrected', 'completed', 'not_needed')]);
      const shown = (await noteRow(note.noteId)).data;
      expect(effectiveAnswers(TEST_NOTE_TYPE, shown)).toMatchObject({
        'more.detail': 'Demo: walks with a cane',
      });
    });

    it('names a sign-off of its own note: another note’s is refused as a missing one is, and the draft is not edited', async () => {
      const visit = await visitOf(dev, patientId);
      const draft = await noteOn(dev, visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: before' });
      const done = await noteOn(dev, visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: done' });
      const signed = await finishNote(dev, done, 'complete', 'completed');
      const wrong = await correction(dev, draft, [answer('care.plan', 'Demo: after')], {
        signoffId: signed.recordId,
      });
      const right = await correction(dev, done, [answer('care.plan', 'Demo: done today')], {
        signoffId: signed.recordId,
      });
      const [refused, taken] = await dev.send(wrong, right);
      expect(refused).toEqual(rejectedAs(wrong, 'stale_reference', { problem: 'note_signoff_missing' }));
      expect(taken!.details).toMatchObject({ outcome: 'corrected' });
      expect(await correctionRow(wrong.recordId)).toBeUndefined();
      const [row] = await h.scratch.owner<{ data: Record<string, unknown> }[]>`
        select data from sineobex.encounter_notes where id = ${draft.noteId}`;
      expect(row!.data).toEqual({ 'care.plan': 'Demo: before' });
    });

    it('needs encounters.chart, names a note the team holds, and waits behind its sign-off', async () => {
      const visit = await visitOf(dev, patientId);
      const note = await noteOn(dev, visit, TEST_NOTE_TYPE, {});
      // A community health worker charts nothing, so corrects nothing: held for review.
      const wes = await who('wes@example.com', 'Wes (demo)', 'chw', 'community_health_worker');
      const fromWes = await correction(wes, note, [answer('care.plan', 'Demo: x', 0)]);
      expect(await wes.send(fromWes)).toEqual([
        expect.objectContaining({ status: 'rejected', reason: 'permission', quarantined: true }),
      ]);
      expect(await correctionRow(fromWes.recordId)).toBeUndefined();
      const changes = [
        await correction(dev, { noteId: randomUUID() }, [answer('care.plan', 'Demo: x', 0)]),
        await correction(dev, note, [answer('care.plan', 'Demo: x', 0)], { signoffId: randomUUID() }),
      ];
      expect(await dev.send(...changes)).toEqual([
        rejectedAs(changes[0]!, 'stale_reference', { problem: 'encounter_note_missing' }),
        rejectedAs(changes[1]!, 'stale_reference', { problem: 'note_signoff_missing' }),
      ]);

      // A sign-off held by the gate holds the correction made behind it.
      const uma = await who('uma@example.com', 'Uma (demo)', 'resident');
      const at = await visitOf(uma, patientId);
      const flags = await noteOn(uma, at, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
      await setCredential(h, t, uma.membershipId, 'chw');
      const signs = await signoffOf(uma, flags, 'sign');
      const behind = await correction(uma, flags, [answer('flags.note', 'Demo: none', 0)], {
        signoffId: signs.recordId,
      });
      expect(await uma.send(signs, behind)).toEqual([
        expect.objectContaining({ status: 'rejected', reason: 'permission', quarantined: true }),
        expect.objectContaining({ status: 'rejected', reason: 'awaiting_review', quarantined: true }),
      ]);
    });

    it('a phase 2 note with no version has no type to check a correction by: definition_error, and the queue goes on', async () => {
      const visit = await visitOf(cora, null);
      const noteId = randomUUID();
      await h.scratch.owner`
        insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, data, status,
          completed_at, completed_by)
        values (${noteId}, ${t.teamId}, ${visit.encounterId}, 'wound_care', ${cora.id}, '{"plan": "Demo: dress daily"}',
          'completed', now(), ${cora.id})`;
      const stuck = await correction(cora, { noteId }, [answer('plan', 'Demo: dress twice daily')]);
      const next = await noteOn(cora, visit, TEST_NOTE_TYPE, {});
      await finishNote(cora, next, 'complete', 'completed');
      const fix = await correction(cora, next, [answer('care.plan', 'Demo: rest', 0)]);
      expect(await cora.send(stuck, fix)).toEqual([
        rejectedAs(stuck, 'validation', { problem: 'definition_error' }),
        taken(fix, 'corrected', 'completed', 'not_needed'),
      ]);
      expect(await correctionRow(stuck.recordId)).toBeUndefined();
    });

    it('adds no answer past the bound on a note’s answers; an answer it holds is corrected', async () => {
      const visit = await visitOf(cora, patientId);
      const note = await noteOn(cora, visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: rest' });
      await finishNote(cora, note, 'complete', 'completed');
      // As if the note held the most answers a note may: their versions are what the bound counts.
      await h.scratch.owner`
        update sineobex.encounter_notes
        set field_versions = field_versions || (
          select jsonb_object_agg('data.extra.n' || i, 1) from generate_series(1, 999) i)
        where id = ${note.noteId}`;
      const adds = await correction(cora, note, [answer('care.followup', 'Demo: clinic', 0)]);
      const fixes = await correction(cora, note, [answer('care.plan', 'Demo: fluids')]);
      expect(await cora.send(adds, fixes)).toEqual([
        rejectedAs(adds, 'validation', { problem: 'too_many_fields' }),
        taken(fixes, 'corrected', 'completed', 'not_needed'),
      ]);
    });

    it('opens its note to the guard of 0018 for its own write only, not for the rest of the push', async () => {
      const visit = await visitOf(cora, patientId);
      const note = await noteOn(cora, visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: rest' });
      await finishNote(cora, note, 'complete', 'completed');
      const fix = await correction(cora, note, [answer('care.plan', 'Demo: fluids')]);
      const actor: ApplyActor = {
        teamId: t.teamId,
        authorId: cora.id,
        approvedBy: null,
        deviceId: cora.phone.deviceId,
        permissions: new Set(PERMISSION_KEYS),
        holdForReview: true,
        now: h.clock.now,
      };
      // A push applies every change in one transaction: what the next change finds.
      const after = await h.db.tx({ teamId: t.teamId, userId: cora.id }, async (tx) => {
        const result = await applyInSavepoint(
          tx,
          async () => {},
          actor,
          fix as SyncChangeInput,
          fix.valueHash,
        );
        const [setting] = await tx<{ value: string | null }[]>`
          select current_setting('app.note_correction', true) as value`;
        return { result, setting: setting!.value };
      });
      expect(after.result).toMatchObject({ status: 'accepted', details: { outcome: 'corrected' } });
      expect(after.setting ?? '').toBe('');
      expect((await noteRow(note.noteId)).data).toEqual({ 'care.plan': 'Demo: fluids' });
    });

    it('is create-only, and its value is checked before anything is read', async () => {
      const visit = await visitOf(cora, null);
      const note = await noteOn(cora, visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: rest' });
      await finishNote(cora, note, 'complete', 'completed');
      const good = await correction(cora, note, [answer('care.plan', 'Demo: fluids')]);
      expect(await cora.send(good)).toEqual([taken(good, 'corrected', 'completed', 'not_needed')]);
      const value = good.value as Record<string, unknown>;
      const bad = (v: Record<string, unknown>) =>
        cora.phone.change({ entity: 'note_correction', op: 'create', value: { ...value, ...v } });
      const { signoffId: _, ...noSignoff } = value;
      const eleven = Array.from({ length: 11 }, (_, i) => answer(`extra.${'abcdefg'[i % 7]}${i}`, 'Demo', 0));
      const changes = [
        await cora.phone.change({
          entity: 'note_correction',
          recordId: good.recordId,
          op: 'set',
          field: 'reason',
          value: 'Demo: other reason',
        }),
        await bad({ changes: [] }),
        await bad({ changes: eleven }),
        await bad({ changes: [{ field: 'status', newValue: 'draft', baseVersion: 1 }] }),
        await bad({ changes: [answer('care.plan', 'Demo: a'), answer('care.plan', 'Demo: b')] }),
        await bad({ changes: [{ field: 'data.care.plan', baseVersion: 1 }] }),
        await bad({ changes: [{ ...answer('care.plan', 'Demo: a'), at: 'now' }] }),
        await bad({ changes: [answer('care.plan', 'Demo: a', -1)] }),
        await bad({ reason: 'No' }),
        await bad({ reason: 'Demo: reason ' }),
        await bad({ claimedCredential: 'surgeon' }),
        await cora.phone.change({ entity: 'note_correction', op: 'create', value: noSignoff }),
      ];
      const answered = await cora.send(...changes);
      expect(answered.map((r) => [r.status, r.reason])).toEqual(
        changes.map(() => ['rejected', 'validation']),
      );
      expect(answered[0]!.details).toEqual({ problem: 'unknown_field' });
      expect(
        answered.slice(1).map((r) => (r.details!.problems as { path: string }[]).map((p) => p.path)),
      ).toEqual([
        ['changes'],
        ['changes'],
        ['changes.0.field'],
        ['changes'],
        ['changes.0.newValue'],
        ['changes.0'],
        ['changes.0.baseVersion'],
        ['reason'],
        ['reason'],
        ['claimedCredential'],
        ['signoffId'],
      ]);
      // The record ID of a stored correction is taken: sent with a new change, it is refused.
      const reused = await cora.phone.change({
        entity: 'note_correction',
        op: 'create',
        recordId: good.recordId,
        value: { ...value, reason: 'Demo: once more' },
      });
      expect(await cora.send(reused)).toEqual([
        rejectedAs(reused, 'validation', { problem: 'record_exists' }),
      ]);
    });
  });
});
