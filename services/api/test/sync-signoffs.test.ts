import { randomUUID } from 'node:crypto';
import { checkAnswer, finishCheck, validate, type ResolvedNoteType } from '@sineobex/forms';
import { checkFile } from '@sineobex/forms/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Credential } from '../src/auth/permissions.ts';
import { noteContentHash } from '../src/encounters/content-hash.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import {
  addMember,
  call,
  CREDENTIAL_FIELDS,
  FakePhone,
  handOver,
  installNoteTypes,
  push,
  register,
  results,
  setupTeam,
  TEST_MEDICAL,
  TEST_NOTE,
  TEST_NOTE_TYPES,
  TEST_RED_FLAGS,
  TEST_RED_FLAGS_TYPE,
  type Team,
} from './sync-fixtures.ts';

type Change = Awaited<ReturnType<FakePhone['change']>>;

// Phase 4's sign-off (lifecycle 4.6): the sync side of every row of the table in 3.4, each refusal
// and its fix, the content hash of 4.5, and the credential a signature is recorded under (3.5).
// signoffEffect itself is held by note-lifecycle.json (encounter-rules.test.ts); these hold what
// the sync code gives it and what it writes. Every person and value is made up.

describe('phase 4 sync: sign-offs', () => {
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

  const TYPES = new Map([...TEST_NOTE_TYPES, TEST_RED_FLAGS_TYPE].map((d) => [d.key, d]));

  /** A member with a credential, and a phone registered to them. */
  async function clinician(email: string, displayName: string, credential: Credential) {
    const member = await addMember(h, t, email, displayName, 'healthcare_staff', credential);
    const phone = await FakePhone.create();
    await register(h, phone, member.token, t.teamId);
    const send = async (...changes: Change[]) =>
      results((await push(h, phone, member.token, t.teamId, changes)).body);
    return { ...member, displayName, credential, phone, send };
  }
  type Who = Awaited<ReturnType<typeof clinician>>;

  /** An admin moves a member to another credential, as the members page does. */
  async function setCredential(membershipId: string, credential: Credential) {
    const r = await call(h, `/v1/team/members/${membershipId}/credential`, {
      method: 'PUT',
      token: t.adminToken,
      teamId: t.teamId,
      json: {
        credential,
        credentialFields: CREDENTIAL_FIELDS[credential],
        reason: 'Demo: credential review',
      },
    });
    expect(r.status).toBe(200);
  }

  interface Visit {
    encounterId: string;
    patientId: string | null;
    summary: string | null;
  }

  /** A visit on the chart. A Medical note needs one that names a patient (4.4). */
  async function visitOf(c: Who, patient: string | null = patientId): Promise<Visit> {
    const create = await c.phone.change({
      entity: 'encounter',
      op: 'create',
      value: { kind: 'medical', ...(patient ? { patientId: patient } : {}) },
    });
    expect((await c.send(create)).map((r) => r.status)).toEqual(['accepted']);
    return { encounterId: create.recordId, patientId: patient, summary: null };
  }

  /** A draft note as its phone holds it: enough to hash it the way the phone does. */
  interface Held extends Visit {
    noteId: string;
    type: ResolvedNoteType;
    answers: Record<string, unknown>;
  }

  async function noteOn(
    c: Who,
    visit: Visit,
    type: { noteTypeKey: string; noteTypeVersion: number },
    answers: Record<string, unknown>,
  ): Promise<Held> {
    const create = await c.phone.change({
      entity: 'encounter_note',
      op: 'create',
      value: { encounterId: visit.encounterId, ...type, data: answers },
    });
    expect((await c.send(create)).map((r) => r.status)).toEqual(['accepted']);
    return { ...visit, noteId: create.recordId, type: TYPES.get(type.noteTypeKey)!, answers };
  }

  /** A visit with the person's Red flags note answered and a draft of [type]. */
  async function chartedVisit(c: Who, type = TEST_MEDICAL, answers: Record<string, unknown> = {}) {
    const visit = await visitOf(c);
    const flags = await noteOn(c, visit, TEST_RED_FLAGS, { 'flags.any': 'no' });
    const note = await noteOn(c, visit, type, { 'care.plan': 'Demo: rest and fluids', ...answers });
    return { visit, flags, note };
  }

  /** The hash a phone sends: over what it holds, as the summary screen drew it (4.5). */
  const hashOf = (n: Held) =>
    noteContentHash({
      noteId: n.noteId,
      encounterId: n.encounterId,
      patientId: n.patientId,
      summary: n.summary,
      definition: n.type,
      answers: n.answers,
    });

  /** A sign-off as the phone makes one; a `sign` claims the credential its saved profile shows. */
  async function signoff(
    c: Who,
    n: Held,
    act: 'complete' | 'sign',
    more: {
      hash?: string;
      claimed?: Credential | null;
      recordId?: string;
      supersedes?: string;
      correctedTime?: string;
      deviceTime?: string;
      clockVerified?: boolean;
    } = {},
  ) {
    const { hash, claimed, ...change } = more;
    return c.phone.change({
      entity: 'note_signoff',
      op: 'create',
      value: {
        noteId: n.noteId,
        act,
        contentHash: hash ?? (await hashOf(n)),
        claimedCredential: claimed !== undefined ? claimed : act === 'sign' ? c.credential : null,
        statementVersion: act === 'sign' ? 'sign-2026-11' : 'complete-2026-11',
      },
      ...change,
    });
  }

  /** The same sign-off record sent again, as the phone's fix path sends it (4.8). */
  const again = (c: Who, n: Held, act: 'complete' | 'sign', refused: Change) =>
    signoff(c, n, act, { recordId: refused.recordId, supersedes: refused.changeId });

  const applied = (c: Change, effect: string, status: string, attestation: string) => ({
    changeId: c.changeId,
    status: 'accepted',
    serverVersion: 1,
    hash: c.valueHash,
    details: { effect, status, attestation, hashMatches: true },
  });
  const refused = (c: Change, problem: string) => ({
    changeId: c.changeId,
    status: 'rejected',
    reason: 'validation',
    message: expect.any(String),
    details: { problem },
  });
  /** Stored with no effect. `hashMatches` goes only to whoever acts as the author: null leaves it out. */
  const noEffect = (
    c: Change,
    reason: string,
    status: string,
    attestation: string,
    hashMatches: boolean | null,
  ) => ({
    changeId: c.changeId,
    status: 'accepted',
    serverVersion: 1,
    hash: c.valueHash,
    details: {
      effect: 'none',
      reason,
      status,
      attestation,
      ...(hashMatches === null ? {} : { hashMatches }),
    },
  });

  const noteRow = async (id: string) =>
    (
      await h.scratch.owner<
        {
          status: string;
          attestation: string;
          completedAt: Date | null;
          completedBy: string | null;
          firstSignedAt: Date | null;
          signoffId: string | null;
          data: Record<string, unknown>;
          fieldVersions: Record<string, number>;
          version: number;
        }[]
      >`
        select status, attestation, completed_at as "completedAt", completed_by as "completedBy",
               first_signed_at as "firstSignedAt", signoff_id as "signoffId", data,
               field_versions as "fieldVersions", version
        from sineobex.encounter_notes where id = ${id}`
    )[0]!;

  const camel = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]),
    );

  /** The sign-off row, every column, by its camel-cased name. */
  const signoffRow = async (id: string) => {
    const [row] = await h.scratch.owner<Record<string, unknown>[]>`
      select * from sineobex.note_signoffs where id = ${id}`;
    return row && camel(row);
  };

  const visitStatus = async (id: string) =>
    (await h.scratch.owner<{ status: string }[]>`select status from sineobex.encounters where id = ${id}`)[0]!
      .status;

  const noticesOn = (recordId: string) =>
    h.scratch.owner<{ userId: string; kind: string; entity: string }[]>`
      select user_id as "userId", kind, entity from sineobex.user_notices where record_id = ${recordId}
      order by created_at, id`;

  const eventsAfter = (mark: string) =>
    h.scratch.owner<{ action: string; entity: string; entityId: string; patientId: string | null }[]>`
      select action, entity, entity_id as "entityId", patient_id as "patientId" from sineobex.audit_events
      where id > ${mark}::bigint order by id`;

  describe('the test-only Red flags note type', () => {
    it('is a definition the export would take: a Medical note marked as the Red flags note, with one required answer', () => {
      expect(checkFile('noteType', TEST_RED_FLAGS_TYPE)).toEqual([]);
      expect(validate(TEST_RED_FLAGS_TYPE, { noteType: () => undefined })).toEqual([]);
      expect(TEST_RED_FLAGS_TYPE).toMatchObject({
        ...{ key: 'test_red_flags', version: 1 },
        kinds: ['medical'],
      });
      expect(TEST_RED_FLAGS_TYPE.auto).toBe('medical');
      expect(TEST_NOTE_TYPES.some((d) => d.auto !== undefined)).toBe(false);
      expect(checkAnswer(TEST_RED_FLAGS_TYPE, 'flags.any', 'no')).toBeNull();
      expect(finishCheck(TEST_RED_FLAGS_TYPE, {}).map((p) => p.path)).toEqual(['flags.any']);
      expect(finishCheck(TEST_RED_FLAGS_TYPE, { 'flags.any': 'yes' })).toEqual([]);
    });
  });

  describe('what a sign-off does (lifecycle 3.4)', () => {
    let lee: Who;
    let dana: Who;
    let rae: Who;
    let sol: Who;

    beforeAll(async () => {
      // Charts, and cannot chart Medical: Non-Medical notes only.
      lee = await clinician('lee@example.com', 'Lee (demo)', 'none');
      dana = await clinician('dana@example.com', 'Dana (demo)', 'attending');
      rae = await clinician('rae@example.com', 'Rae (demo)', 'resident');
      sol = await clinician('sol@example.com', 'Sol (demo)', 'student');
    });

    it('a Non-Medical note is completed: the sign-off row, then the note, in one change with one audit event', async () => {
      const visit = await visitOf(lee, null);
      const note = await noteOn(lee, visit, TEST_NOTE, { 'care.plan': 'Demo: rest and fluids' });
      const before = await noteRow(note.noteId);

      const mark = await auditMark(h);
      const done = await signoff(lee, note, 'complete');
      const [answer] = await lee.send(done);
      expect(answer).toEqual(applied(done, 'completed', 'completed', 'not_needed'));
      const at = new Date(done.deviceTime);
      expect(await noteRow(note.noteId)).toEqual({
        ...before,
        status: 'completed',
        completedAt: at,
        completedBy: lee.id,
        firstSignedAt: null,
        signoffId: null,
        fieldVersions: { ...before.fieldVersions, status: 2 },
        version: before.version + 1,
      });
      expect(await signoffRow(done.recordId)).toMatchObject({
        teamId: t.teamId,
        noteId: note.noteId,
        act: 'complete',
        effect: 'completed',
        contentHash: (done.value as { contentHash: string }).contentHash,
        signerUserId: lee.id,
        signerName: 'Lee (demo)',
        signerCredential: 'none',
        signerNpi: null,
        signerFields: {},
        claimedCredential: null,
        needsAttestation: false,
        statementVersion: 'complete-2026-11',
        signedAt: at,
        signedDeviceTime: at,
        clockVerified: true,
        changeId: done.changeId,
        createdDeviceId: lee.phone.deviceId,
        approvedBy: null,
      });
      const [history] = await h.scratch.owner<Record<string, unknown>[]>`
        select field, version, value, previous_value as "previousValue", kind, changed_by as "changedBy",
               change_id as "changeId"
        from sineobex.field_history where record_id = ${note.noteId} and kind <> 'created'`;
      expect(history).toEqual({
        field: 'status',
        version: 2,
        value: 'completed',
        previousValue: 'draft',
        kind: 'set',
        changedBy: lee.id,
        changeId: done.changeId,
      });
      // One audit event, the note's, naming the sign-off.
      expect(await eventsAfter(mark)).toEqual([
        { action: 'note.completed', entity: 'encounter_note', entityId: note.noteId, patientId: null },
      ]);
      const [event] = await expectAudit(h, 'note.completed', { after: mark, count: 1 });
      expect(event!.details).toEqual({
        changeId: done.changeId,
        signoffId: done.recordId,
        act: 'complete',
        effect: 'completed',
        clockVerified: true,
      });
      expect(await visitStatus(visit.encounterId)).toBe('completed');

      // Sent twice, it answers the same from its receipt, and nothing more is written.
      expect(await lee.send(done)).toEqual([answer]);
      expect(await eventsAfter(mark)).toHaveLength(1);

      // A Non-Medical note is never signed: `sign` is a `complete`, whatever the credential.
      const social = await noteOn(dana, visit, TEST_NOTE, { 'care.plan': 'Demo: housing list' });
      const signs = await signoff(dana, social, 'sign');
      expect(await dana.send(signs)).toEqual([applied(signs, 'completed', 'completed', 'not_needed')]);
      expect(await noteRow(social.noteId)).toMatchObject({ status: 'completed', signoffId: null });
    });

    it('a Medical note: an attending’s sign is signed with nothing held, a resident’s waits for attestation, and complete waits for a co-signer', async () => {
      const ours = await chartedVisit(dana, TEST_MEDICAL, { 'vitals.pulse': 88 });
      const mark = await auditMark(h);
      const flags = await signoff(dana, ours.flags, 'sign');
      const note = await signoff(dana, ours.note, 'sign');
      expect(await dana.send(flags, note)).toEqual([
        applied(flags, 'signed', 'signed', 'not_needed'),
        applied(note, 'signed', 'signed', 'not_needed'),
      ]);
      const at = new Date(note.deviceTime);
      expect(await noteRow(ours.note.noteId)).toMatchObject({
        status: 'signed',
        attestation: 'not_needed',
        completedAt: at,
        completedBy: dana.id,
        firstSignedAt: at,
        signoffId: note.recordId,
      });
      const { npi, ...fields } = CREDENTIAL_FIELDS.attending;
      expect(await signoffRow(note.recordId)).toMatchObject({
        act: 'sign',
        effect: 'signed',
        signerName: 'Dana (demo)',
        signerCredential: 'attending',
        signerNpi: npi,
        signerFields: fields,
        claimedCredential: 'attending',
        needsAttestation: false,
        statementVersion: 'sign-2026-11',
      });
      const signedEvents = await expectAudit(h, 'note.signed', { after: mark, count: 2 });
      expect(signedEvents[1]).toMatchObject({
        entity: 'encounter_note',
        entityId: ours.note.noteId,
        patientId,
        details: {
          changeId: note.changeId,
          signoffId: note.recordId,
          act: 'sign',
          effect: 'signed',
          clockVerified: true,
          credential: 'attending',
          needsAttestation: false,
        },
      });
      expect(signedEvents[1]!.details).not.toHaveProperty('claimedCredential');
      expect(await visitStatus(ours.visit.encounterId)).toBe('signed');

      const hers = await chartedVisit(rae);
      const raeFlags = await signoff(rae, hers.flags, 'sign');
      const raeNote = await signoff(rae, hers.note, 'sign');
      expect(await rae.send(raeFlags, raeNote)).toEqual([
        applied(raeFlags, 'signed', 'signed', 'waiting'),
        applied(raeNote, 'signed', 'signed', 'waiting'),
      ]);
      expect(await noteRow(hers.note.noteId)).toMatchObject({ status: 'signed', attestation: 'waiting' });
      expect(await signoffRow(raeNote.recordId)).toMatchObject({
        signerCredential: 'resident',
        needsAttestation: true,
      });
      const [raeEvent] = (await expectAudit(h, 'note.signed', { after: mark, count: 4 })).slice(3);
      expect(raeEvent!.details).toMatchObject({ credential: 'resident', needsAttestation: true });

      // `complete` on a Medical note never signs, even from someone who can: it waits for a co-signer.
      const waits = await chartedVisit(dana);
      const completes = [
        await signoff(dana, waits.flags, 'complete'),
        await signoff(dana, waits.note, 'complete'),
      ];
      expect(await dana.send(...completes)).toEqual(
        completes.map((c) => applied(c, 'completed', 'completed', 'not_needed')),
      );
      expect(await noteRow(waits.note.noteId)).toMatchObject({
        status: 'completed',
        signoffId: null,
        firstSignedAt: null,
      });
      expect(await visitStatus(waits.visit.encounterId)).toBe('completed');
      await expectAuditClean(h, ['Demo: rest and fluids', 'Dana (demo)'], mark);
    });

    it('sign from a credential that cannot sign is saved unsigned for a co-signer, and the signer is told', async () => {
      const his = await chartedVisit(sol);
      const mark = await auditMark(h);
      // His phone's saved profile still showed resident.
      const flags = await signoff(sol, his.flags, 'complete');
      const note = await signoff(sol, his.note, 'sign', { claimed: 'resident' });
      expect(await sol.send(flags, note)).toEqual([
        applied(flags, 'completed', 'completed', 'not_needed'),
        applied(note, 'saved_unsigned', 'completed', 'not_needed'),
      ]);
      expect(await noteRow(his.note.noteId)).toMatchObject({
        status: 'completed',
        attestation: 'not_needed',
        signoffId: null,
        firstSignedAt: null,
      });
      expect(await signoffRow(note.recordId)).toMatchObject({
        effect: 'saved_unsigned',
        signerCredential: 'student',
        signerNpi: null,
        claimedCredential: 'resident',
        needsAttestation: true,
      });
      expect(await noticesOn(his.note.noteId)).toEqual([
        { userId: sol.id, kind: 'note_saved_unsigned', entity: 'encounter_note' },
      ]);
      expect(await noticesOn(his.flags.noteId)).toEqual([]);
      const [event] = await expectAudit(h, 'note.saved_unsigned', { after: mark, count: 1 });
      expect(event!.details).toMatchObject({
        signoffId: note.recordId,
        act: 'sign',
        effect: 'saved_unsigned',
        credential: 'student',
        claimedCredential: 'resident',
        needsAttestation: true,
      });
      expect(await visitStatus(his.visit.encounterId)).toBe('completed');
    });

    it('a second sign-off of a finished note is stored and changes nothing; its receipt says whether it saw what was signed', async () => {
      const ours = await chartedVisit(dana);
      const first = [await signoff(dana, ours.flags, 'sign'), await signoff(dana, ours.note, 'sign')];
      expect((await dana.send(...first)).map((r) => r.details?.effect)).toEqual(['signed', 'signed']);
      const before = await noteRow(ours.note.noteId);

      const mark = await auditMark(h);
      // The same person from a second phone: what it showed, and something else.
      const same = await signoff(dana, ours.note, 'sign');
      const other = await signoff(dana, ours.note, 'complete', { hash: 'ab'.repeat(32) });
      expect(await dana.send(same, other)).toEqual([
        noEffect(same, 'already_finished', 'signed', 'not_needed', true),
        noEffect(other, 'already_finished', 'signed', 'not_needed', false),
      ]);
      expect(await noteRow(ours.note.noteId)).toEqual(before);
      expect(await signoffRow(same.recordId)).toMatchObject({ effect: 'none', act: 'sign' });
      expect(await signoffRow(other.recordId)).toMatchObject({ effect: 'none', act: 'complete' });
      const events = await expectAudit(h, 'note.signoff_repeated', { after: mark, count: 2 });
      expect(events.map((e) => e.details)).toEqual([
        { changeId: same.changeId, signoffId: same.recordId, reason: 'already_finished', hashMatches: true },
        {
          changeId: other.changeId,
          signoffId: other.recordId,
          reason: 'already_finished',
          hashMatches: false,
        },
      ]);
      expect(await noticesOn(ours.note.noteId)).toEqual([]);
    });

    it('the second phone’s hash is compared with the signature that finished the note, not with the note as it is now', async () => {
      // A Non-Medical note on a visit with no patient, completed from one phone (NOT-7).
      const visit = await visitOf(lee, null);
      const note = await noteOn(lee, visit, TEST_NOTE, { 'care.plan': 'Demo: rest and fluids' });
      const first = await signoff(lee, note, 'complete');
      expect(await lee.send(first)).toEqual([applied(first, 'completed', 'completed', 'not_needed')]);
      // The visit is then given a patient, which is always allowed: the note's hash moves with it.
      const named = await lee.phone.change({
        entity: 'encounter',
        op: 'set',
        recordId: visit.encounterId,
        field: 'patientId',
        value: patientId,
        baseVersion: 1,
      });
      expect((await lee.send(named)).map((r) => r.status)).toEqual(['accepted']);

      // The second phone signed what the first one did: it saw exactly what was signed.
      const same = await signoff(lee, note, 'complete');
      const now = await signoff(lee, { ...note, patientId }, 'complete');
      expect(await lee.send(same, now)).toEqual([
        noEffect(same, 'already_finished', 'completed', 'not_needed', true),
        noEffect(now, 'already_finished', 'completed', 'not_needed', false),
      ]);

      // Reopened, changed and finished again: the later signature is the one compared with.
      const ours = await chartedVisit(dana);
      const waits = [await signoff(dana, ours.flags, 'sign'), await signoff(dana, ours.note, 'complete')];
      expect((await dana.send(...waits)).map((r) => r.details?.effect)).toEqual(['signed', 'completed']);
      const reopen = await dana.phone.change({
        entity: 'encounter_note',
        recordId: ours.note.noteId,
        op: 'set',
        field: 'status',
        value: 'draft',
        baseVersion: 2,
      });
      const plan = await dana.phone.change({
        entity: 'encounter_note',
        recordId: ours.note.noteId,
        op: 'set',
        field: 'data.care.plan',
        value: 'Demo: rest, fluids and a recheck',
        baseVersion: 1,
      });
      expect((await dana.send(reopen, plan)).map((r) => [r.status, r.details ?? null])).toEqual([
        ['accepted', null],
        ['accepted', null],
      ]);
      const edited = { ...ours.note, answers: { 'care.plan': 'Demo: rest, fluids and a recheck' } };
      const again = await signoff(dana, edited, 'complete');
      expect((await dana.send(again)).map((r) => r.details?.effect)).toEqual(['completed']);
      const old = await signoff(dana, ours.note, 'complete');
      const fresh = await signoff(dana, edited, 'complete');
      expect((await dana.send(old, fresh)).map((r) => r.details?.hashMatches)).toEqual([false, true]);
    });

    it('a sign-off from someone who does not act as the author is stored with no effect, and the sender is told', async () => {
      const ours = await chartedVisit(dana);
      const theirs = await signoff(rae, ours.note, 'sign');
      // Whether a hash matches is told to the author only: to Rae it would check any guess (RD-2).
      const guess = await signoff(rae, ours.note, 'sign', { hash: 'ab'.repeat(32) });
      expect(await rae.send(theirs, guess)).toEqual([
        noEffect(theirs, 'not_author', 'draft', 'not_needed', null),
        noEffect(guess, 'not_author', 'draft', 'not_needed', null),
      ]);
      expect(await noteRow(ours.note.noteId)).toMatchObject({ status: 'draft', signoffId: null });
      expect(await signoffRow(theirs.recordId)).toMatchObject({ effect: 'none', signerUserId: rae.id });
      expect(await noticesOn(ours.note.noteId)).toEqual([
        { userId: rae.id, kind: 'change_not_applied', entity: 'encounter_note' },
        { userId: rae.id, kind: 'change_not_applied', entity: 'encounter_note' },
      ]);

      // Assigned to Rae after Dana left (3.8): Rae acts as the author now, and Dana no longer does.
      await h.scratch.owner`
        update sineobex.encounter_notes set assigned_user_id = ${rae.id} where id = ${ours.note.noteId}`;
      const flags = await signoff(dana, ours.flags, 'sign');
      const writers = await signoff(dana, ours.note, 'sign');
      expect(await dana.send(flags, writers)).toEqual([
        applied(flags, 'signed', 'signed', 'not_needed'),
        noEffect(writers, 'not_author', 'draft', 'not_needed', null),
      ]);
      const assignees = await signoff(rae, ours.note, 'sign');
      expect(await rae.send(assignees)).toEqual([applied(assignees, 'signed', 'signed', 'waiting')]);
      // On a finished note too: the first writer, no longer the author, is not told whether it matches.
      const late = await signoff(dana, ours.note, 'sign');
      expect(await dana.send(late)).toEqual([noEffect(late, 'already_finished', 'signed', 'waiting', null)]);
      expect(await noteRow(ours.note.noteId)).toMatchObject({
        status: 'signed',
        completedBy: rae.id,
        signoffId: assignees.recordId,
      });
    });

    it('a note names only a signature of its own, a rule the database cannot see', async () => {
      // Every note the tests above finished: a signoff_id is a sign-off of the note with effect signed.
      const wrong = await h.scratch.owner`
        select n.id from sineobex.encounter_notes n
        left join sineobex.note_signoffs s on s.id = n.signoff_id
        where n.team_id = ${t.teamId} and n.signoff_id is not null
          and (s.effect is distinct from 'signed' or s.note_id <> n.id or n.status <> 'signed')`;
      expect(wrong).toEqual([]);
      const [counts] = await h.scratch.owner<{ signed: number; named: number; none: number }[]>`
        select (select count(*)::int from sineobex.encounter_notes where team_id = ${t.teamId} and status = 'signed') as signed,
               (select count(*)::int from sineobex.encounter_notes where team_id = ${t.teamId} and signoff_id is not null) as named,
               (select count(*)::int from sineobex.note_signoffs where team_id = ${t.teamId} and effect <> 'signed') as none`;
      expect(counts!.signed).toBeGreaterThan(0);
      expect(counts!.named).toBe(counts!.signed);
      expect(counts!.none).toBeGreaterThan(0);

      // The key (0019) sees a note and a sign-off of it, never the sign-off's effect: a completed
      // note named by its own `completed` sign-off as signed is taken. So the sync code is the rule.
      const [row] = await h.scratch.owner<{ noteId: string; id: string }[]>`
        select s.note_id as "noteId", s.id from sineobex.note_signoffs s
        join sineobex.encounter_notes n on n.id = s.note_id
        where s.team_id = ${t.teamId} and s.effect = 'completed' and n.status = 'completed' and n.medical
        limit 1`;
      const rolledBack = new Error('rolled back');
      await expect(
        h.scratch.owner.begin(async (sql) => {
          await sql`
            update sineobex.encounter_notes
            set status = 'signed', first_signed_at = now(), signoff_id = ${row!.id}
            where id = ${row!.noteId}`;
          throw rolledBack;
        }),
      ).rejects.toBe(rolledBack);
    });
  });

  describe('the content hash (lifecycle 4.5)', () => {
    let ash: Who;
    let bo: Who;

    beforeAll(async () => {
      ash = await clinician('ash@example.com', 'Ash (demo)', 'attending');
      bo = await clinician('bo@example.com', 'Bo (demo)', 'attending');
    });

    const entry = (n: number) => `rows.e${String(n).padStart(7, '0')}`;
    const at = '2026-10-20T14:40:00.000Z';

    it('covers the visit’s patient and summary: a sign-off on what changed since is refused, and the same record sent again is taken', async () => {
      const visit = await visitOf(ash);
      const summary = await ash.phone.change({
        entity: 'encounter',
        recordId: visit.encounterId,
        op: 'set',
        field: 'summary',
        value: 'Demo: seen by the river',
      });
      expect((await ash.send(summary)).map((r) => r.status)).toEqual(['accepted']);
      const seen = { ...visit, summary: 'Demo: seen by the river' };
      const flags = await noteOn(ash, seen, TEST_RED_FLAGS, { 'flags.any': 'no' });
      const note = await noteOn(ash, seen, TEST_MEDICAL, { 'care.plan': 'Demo: rest' });
      // Bo rewrites the summary while every note is a draft: the draft rule takes it.
      const rewrite = await bo.phone.change({
        entity: 'encounter',
        recordId: visit.encounterId,
        op: 'set',
        field: 'summary',
        value: 'Demo: seen by the bridge',
        baseVersion: 1,
      });
      expect((await bo.send(rewrite)).map((r) => r.status)).toEqual(['accepted']);

      const mark = await auditMark(h);
      const stale = [await signoff(ash, flags, 'sign'), await signoff(ash, note, 'sign')];
      expect(await ash.send(...stale)).toEqual(stale.map((c) => refused(c, 'content_changed')));
      // Nothing is written but the stored rejection.
      expect(await noteRow(note.noteId)).toMatchObject({ status: 'draft', signoffId: null });
      for (const c of stale) expect(await signoffRow(c.recordId)).toBeUndefined();
      expect((await eventsAfter(mark)).map((e) => e.action)).toEqual(['sync.rejected', 'sync.rejected']);

      // The person looks again and completes: the phone sends the same records with the new hash.
      const now = { summary: 'Demo: seen by the bridge' };
      const fixes = [
        await again(ash, { ...flags, ...now }, 'sign', stale[0]!),
        await again(ash, { ...note, ...now }, 'sign', stale[1]!),
      ];
      expect(await ash.send(...fixes)).toEqual(
        fixes.map((c) => applied(c, 'signed', 'signed', 'not_needed')),
      );
      const settled = await h.scratch.owner<{ resolvedBy: string | null }[]>`
        select resolved_by_change as "resolvedBy" from sineobex.sync_changes
        where change_id in ${h.scratch.owner(stale.map((c) => c.changeId))} order by device_seq`;
      expect(settled).toEqual(fixes.map((c) => ({ resolvedBy: c.changeId })));
      await expectAudit(h, 'sync.rejection_fixed', { after: mark, count: 2 });

      // A visit moved to another patient between what was seen and what is held: refused too.
      const moved = await chartedVisit(ash);
      const other = (await createPatient(h, t.teamId, t.adminId)).id;
      const move = await bo.phone.change({
        entity: 'encounter',
        recordId: moved.visit.encounterId,
        op: 'set',
        field: 'patientId',
        value: other,
        baseVersion: 1,
      });
      expect((await bo.send(move)).map((r) => r.status)).toEqual(['accepted']);
      const old = await signoff(ash, moved.flags, 'sign');
      expect(await ash.send(old)).toEqual([refused(old, 'content_changed')]);
      const fixed = await again(ash, { ...moved.flags, patientId: other }, 'sign', old);
      expect(await ash.send(fixed)).toEqual([applied(fixed, 'signed', 'signed', 'not_needed')]);
    });

    it('is taken over the answers that count, and a finished note keeps only those, each one dropped in its history', async () => {
      const visit = await visitOf(ash);
      const flags = await noteOn(ash, visit, TEST_RED_FLAGS, { 'flags.any': 'no' });
      const answers = {
        'care.plan': 'Demo: dress daily',
        // A clear holds no answer.
        'care.followup': null,
        // Hidden while "Nothing more" is ticked.
        'more.none': true,
        'more.detail': 'Demo: one more thing',
        // A removed entry, and one that is there.
        [`${entry(1)}.entryAt`]: at,
        [`${entry(1)}.n`]: 3,
        [`${entry(1)}.entryRemoved`]: true,
        [`${entry(2)}.entryAt`]: at,
        [`${entry(2)}.n`]: 4,
      };
      const note = await noteOn(ash, visit, TEST_MEDICAL, answers);
      const before = await noteRow(note.noteId);
      // A teammate's answer that does not count changes nothing that is signed.
      const hidden = await bo.phone.change({
        entity: 'encounter_note',
        recordId: note.noteId,
        op: 'set',
        field: 'data.more.detail',
        value: 'Demo: from Bo',
        baseVersion: 1,
      });
      expect((await bo.send(hidden)).map((r) => r.details)).toEqual([{ notCounted: 'hidden_field' }]);
      const held = { ...note, answers: { ...answers, 'more.detail': 'Demo: from Bo' } };

      const signs = [await signoff(ash, flags, 'sign'), await signoff(ash, note, 'sign')];
      expect(await ash.send(...signs)).toEqual(
        signs.map((c) => applied(c, 'signed', 'signed', 'not_needed')),
      );
      expect(await hashOf(held)).toBe(await hashOf(note));

      const counting = {
        'care.plan': 'Demo: dress daily',
        'more.none': true,
        [`${entry(2)}.entryAt`]: at,
        [`${entry(2)}.n`]: 4,
      };
      const dropped: [string, unknown][] = [
        ['care.followup', null],
        ['more.detail', 'Demo: from Bo'],
        [`${entry(1)}.entryAt`, at],
        [`${entry(1)}.n`, 3],
        [`${entry(1)}.entryRemoved`, true],
      ];
      const after = await noteRow(note.noteId);
      expect(after.data).toEqual(counting);
      expect(after.fieldVersions).toEqual({
        ...before.fieldVersions,
        status: 2,
        'data.more.detail': 3,
        ...Object.fromEntries(dropped.filter(([p]) => p !== 'more.detail').map(([p]) => [`data.${p}`, 2])),
      });
      const history = await h.scratch.owner<{ field: string; value: unknown; previousValue: unknown }[]>`
        select field, value, previous_value as "previousValue" from sineobex.field_history
        where record_id = ${note.noteId} and change_id = ${signs[1]!.changeId} and field like 'data.%'`;
      expect([...history].sort((a, b) => (a.field < b.field ? -1 : 1))).toEqual(
        dropped
          .map(([path, value]) => ({ field: `data.${path}`, value: null, previousValue: value }))
          .sort((a, b) => (a.field < b.field ? -1 : 1)),
      );
    });
  });

  describe('refusals: nothing is written, and the same sign-off sent again is applied fresh', () => {
    let cy: Who;

    beforeAll(async () => {
      cy = await clinician('cy@example.com', 'Cy (demo)', 'attending');
    });

    it('content_changed, incomplete and red_flags_first, each fixed by sending the same record again', async () => {
      const visit = await visitOf(cy);
      // The Red flags note the app added, its red-flag question not answered yet. (Not empty: an empty
      // draft's sign-off changes nothing, as below.)
      const flags = await noteOn(cy, visit, TEST_RED_FLAGS, { 'flags.note': 'Demo: asked, no answer yet' });
      const note = await noteOn(cy, visit, TEST_MEDICAL, { 'care.plan': 'Demo: rest' });

      const mark = await auditMark(h);
      const noteFirst = await signoff(cy, note, 'sign', { hash: 'cd'.repeat(32) });
      const flagsFirst = await signoff(cy, flags, 'sign');
      expect(await cy.send(noteFirst, flagsFirst)).toEqual([
        refused(noteFirst, 'content_changed'),
        refused(flagsFirst, 'incomplete'),
      ]);
      // The hash now matches, and the visit's Red flags note is still a draft.
      const noteSecond = await again(cy, note, 'sign', noteFirst);
      expect(await cy.send(noteSecond)).toEqual([refused(noteSecond, 'red_flags_first')]);
      for (const n of [flags, note]) expect(await noteRow(n.noteId)).toMatchObject({ status: 'draft' });
      for (const c of [noteFirst, flagsFirst]) expect(await signoffRow(c.recordId)).toBeUndefined();
      const events = await h.scratch.owner<{ action: string; problem: string }[]>`
        select action, details->>'problem' as problem from sineobex.audit_events
        where id > ${mark}::bigint order by id`;
      expect(events).toEqual(
        ['content_changed', 'incomplete', 'red_flags_first'].map((problem) => ({
          action: 'sync.rejected',
          problem,
        })),
      );

      // One Complete fixes them all: the red-flag answer, then the Red flags note first.
      const answer = await cy.phone.change({
        entity: 'encounter_note',
        recordId: flags.noteId,
        op: 'set',
        field: 'data.flags.any',
        value: 'no',
      });
      const answered = { ...flags, answers: { ...flags.answers, 'flags.any': 'no' } };
      const flagsFix = await again(cy, answered, 'sign', flagsFirst);
      const noteFix = await again(cy, note, 'sign', noteSecond);
      expect(await cy.send(answer, flagsFix, noteFix)).toEqual([
        expect.objectContaining({ status: 'accepted' }),
        applied(flagsFix, 'signed', 'signed', 'not_needed'),
        applied(noteFix, 'signed', 'signed', 'not_needed'),
      ]);
      const open = await h.scratch.owner`
        select change_id from sineobex.sync_changes
        where record_id in ${h.scratch.owner([flagsFirst.recordId, noteFirst.recordId])}
          and status = 'rejected' and resolved_by_change is null`;
      expect(open).toEqual([]);
    });

    it('an empty draft’s sign-off changes nothing, and so settles the refusal of an earlier one', async () => {
      // Review finding SFN-7, as the coordinator decided: a refused sign-off of a note the person then
      // removed (its answers blanked, lifecycle 9.4) is fixed by completing it again, which changes
      // nothing, since an empty draft does not count (3.1). Asked before the finish check and the Red
      // flags note: neither is the person's to fix on a note they removed.
      const visit = await visitOf(cy);
      const note = await noteOn(cy, visit, TEST_MEDICAL, { 'care.plan': 'Demo: rest' });
      const first = await signoff(cy, note, 'sign', { hash: 'cd'.repeat(32) });
      expect(await cy.send(first)).toEqual([refused(first, 'content_changed')]);
      const blank = await cy.phone.change({
        entity: 'encounter_note',
        recordId: note.noteId,
        op: 'set',
        field: 'data.care.plan',
        value: null,
        baseVersion: 1,
      });
      const mark = await auditMark(h);
      const fix = await again(cy, { ...note, answers: { 'care.plan': null } }, 'sign', first);
      expect(await cy.send(blank, fix)).toEqual([
        expect.objectContaining({ status: 'accepted' }),
        noEffect(fix, 'empty', 'draft', 'not_needed', true),
      ]);
      expect(await noteRow(note.noteId)).toMatchObject({ status: 'draft', completedAt: null });
      expect(await signoffRow(fix.recordId)).toMatchObject({ effect: 'none' });
      expect(await noticesOn(note.noteId)).toEqual([]);
      const [event] = await expectAudit(h, 'note.signoff_repeated', { after: mark, count: 1 });
      expect(event).toMatchObject({ details: { reason: 'empty', hashMatches: true } });
      const open = await h.scratch.owner`
        select change_id from sineobex.sync_changes
        where record_id = ${first.recordId} and status = 'rejected' and resolved_by_change is null`;
      expect(open).toEqual([]);
    });

    it('only a finished Red flags note of the visit counts, and a Non-Medical note never waits for one', async () => {
      const elsewhere = await chartedVisit(cy);
      const signed = await signoff(cy, elsewhere.flags, 'sign');
      expect((await cy.send(signed)).map((r) => r.details?.effect)).toEqual(['signed']);

      // This visit's Red flags note is answered but not finished; another visit's is finished.
      const here = await chartedVisit(cy);
      const social = await noteOn(cy, here.visit, TEST_NOTE, { 'care.plan': 'Demo: housing list' });
      const medical = await signoff(cy, here.note, 'complete');
      const nonMedical = await signoff(cy, social, 'complete');
      expect(await cy.send(medical, nonMedical)).toEqual([
        refused(medical, 'red_flags_first'),
        applied(nonMedical, 'completed', 'completed', 'not_needed'),
      ]);
      // A completed Red flags note is finished: one that waits for a co-signer counts.
      const flags = await signoff(cy, here.flags, 'complete');
      const fix = await again(cy, here.note, 'sign', medical);
      expect(await cy.send(flags, fix)).toEqual([
        applied(flags, 'completed', 'completed', 'not_needed'),
        applied(fix, 'signed', 'signed', 'not_needed'),
      ]);
    });
  });

  describe('the credential a sign-off is recorded under, and the Medical gate (lifecycle 3.5, 4.2)', () => {
    /** A time from the server's own clock, for a signature whose time it can trust. */
    const nowIso = () => new Date().toISOString();
    const timed = (time: string) => ({ deviceTime: time, correctedTime: time });

    it('a signature’s time is the clock-corrected one; the phone’s own time is kept beside it', async () => {
      const lou = await clinician('lou@example.com', 'Lou (demo)', 'attending');
      const { flags, note } = await chartedVisit(lou);
      expect((await lou.send(await signoff(lou, flags, 'sign'))).map((r) => r.status)).toEqual(['accepted']);
      // The phone's clock runs three hours slow; its last measured offset corrects it.
      const corrected = nowIso();
      const device = new Date(Date.parse(corrected) - 3 * 3600_000).toISOString();
      const sign = await signoff(lou, note, 'sign', { deviceTime: device, correctedTime: corrected });
      expect(await lou.send(sign)).toEqual([applied(sign, 'signed', 'signed', 'not_needed')]);
      expect(await signoffRow(sign.recordId)).toMatchObject({
        signedAt: new Date(corrected),
        signedDeviceTime: new Date(device),
        signerCredential: 'attending',
        clockVerified: true,
      });
      expect(await noteRow(note.noteId)).toMatchObject({
        completedAt: new Date(corrected),
        firstSignedAt: new Date(corrected),
      });
    });

    it('a note whose create was held is believed from when the server received the create, not when an admin accepted it', async () => {
      const pia = await clinician('pia@example.com', 'Pia (demo)', 'attending');
      const visit = await visitOf(pia);
      const flags = await noteOn(pia, visit, TEST_RED_FLAGS, { 'flags.any': 'no' });
      expect((await pia.send(await signoff(pia, flags, 'sign'))).map((r) => r.status)).toEqual(['accepted']);
      // Her credential is lowered while her phone is offline; her Medical note's create is held.
      await setCredential(pia.membershipId, 'none');
      const answers = { 'care.plan': 'Demo: rest' };
      const create = await pia.phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId: visit.encounterId, ...TEST_MEDICAL, data: answers },
      });
      expect((await pia.send(create)).map((r) => r.reason)).toEqual(['permission']);
      await new Promise((r) => setTimeout(r, 20));
      // She signs it offline while she holds none; then an admin restores her.
      const held: Held = {
        ...visit,
        noteId: create.recordId,
        type: TYPES.get(TEST_MEDICAL.noteTypeKey)!,
        answers,
      };
      const sign = await signoff(pia, held, 'sign', timed(nowIso()));
      await new Promise((r) => setTimeout(r, 20));
      await setCredential(pia.membershipId, 'attending');
      await new Promise((r) => setTimeout(r, 20));
      // The sign-off waits with its note, and an admin accepts both.
      expect((await pia.send(sign)).map((r) => r.reason)).toEqual(['awaiting_review']);
      for (const c of [create, sign]) {
        const [item] = await h.scratch.owner<{ id: string }[]>`
          select id from sineobex.quarantine_items where change_id = ${c.changeId}`;
        const decided = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision: 'accept', reason: 'Demo: checked with Pia' },
        });
        expect(decided.status).toBe(200);
      }
      // Signed after the server had the note, so the time is believed: she held none, which signs nothing.
      expect(await signoffRow(sign.recordId)).toMatchObject({
        effect: 'saved_unsigned',
        signerCredential: 'none',
        clockVerified: true,
      });
    });

    it('signed Monday, promoted Tuesday, synced Wednesday: the signature keeps the credential it was signed under', async () => {
      const kai = await clinician('kai@example.com', 'Kai (demo)', 'resident');
      // Monday: the drafts reach the server, then Kai completes them offline.
      const synced = await chartedVisit(kai);
      const unverified = await chartedVisit(kai);
      const monday = nowIso();
      const flags = await signoff(kai, synced.flags, 'sign', timed(monday));
      const note = await signoff(kai, synced.note, 'sign', timed(monday));
      // A phone that could not check its clock: its time is its own word, and not believed.
      const unchecked = [
        await signoff(kai, unverified.flags, 'sign', { ...timed(monday), clockVerified: false }),
        await signoff(kai, unverified.note, 'sign', { ...timed(monday), clockVerified: false }),
      ];
      // Offline too: a whole visit charted and signed before the server ever saw it.
      const visit = await kai.phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', patientId },
      });
      const offline: Held[] = [];
      const creates: Change[] = [];
      for (const [type, data] of [
        [TEST_RED_FLAGS, { 'flags.any': 'no' }],
        [TEST_MEDICAL, { 'care.plan': 'Demo: rest' }],
      ] as const) {
        const create = await kai.phone.change({
          entity: 'encounter_note',
          op: 'create',
          value: { encounterId: visit.recordId, ...type, data },
        });
        creates.push(create);
        offline.push({
          encounterId: visit.recordId,
          patientId,
          summary: null,
          noteId: create.recordId,
          type: TYPES.get(type.noteTypeKey)!,
          answers: data,
        });
      }
      const offlineSigns = [
        await signoff(kai, offline[0]!, 'sign', timed(monday)),
        await signoff(kai, offline[1]!, 'sign', timed(monday)),
      ];

      // Tuesday: an admin makes Kai an attending.
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(kai.membershipId, 'attending');

      // Wednesday: everything syncs.
      expect(await kai.send(flags, note)).toEqual([
        applied(flags, 'signed', 'signed', 'waiting'),
        applied(note, 'signed', 'signed', 'waiting'),
      ]);
      expect(await signoffRow(note.recordId)).toMatchObject({
        signerCredential: 'resident',
        claimedCredential: 'resident',
        needsAttestation: true,
        signedAt: new Date(monday),
        clockVerified: true,
      });
      expect(await kai.send(...unchecked)).toEqual(
        unchecked.map((c) => applied(c, 'signed', 'signed', 'waiting')),
      );
      expect(await signoffRow(unchecked[1]!.recordId)).toMatchObject({
        signerCredential: 'attending',
        claimedCredential: 'resident',
        clockVerified: false,
      });
      // The note reached the server after the time the signature claims: that time is not
      // believed, so the credential is the one held now, and the claim keeps it waiting.
      const answered = await kai.send(visit, ...creates, ...offlineSigns);
      expect(answered.slice(3)).toEqual([
        applied(offlineSigns[0]!, 'signed', 'signed', 'waiting'),
        applied(offlineSigns[1]!, 'signed', 'signed', 'waiting'),
      ]);
      expect(await signoffRow(offlineSigns[1]!.recordId)).toMatchObject({
        signerCredential: 'attending',
        signerFields: { licenseNumber: 'DEMO-0001', licenseState: 'MI' },
        claimedCredential: 'resident',
        needsAttestation: true,
      });
      const [event] = await h.scratch.owner<{ details: Record<string, unknown> }[]>`
        select details from sineobex.audit_events
        where action = 'note.signed' and details->>'signoffId' = ${offlineSigns[1]!.recordId}`;
      expect(event!.details).toMatchObject({ credential: 'attending', claimedCredential: 'resident' });
    });

    it('a credential lowered while the phone was offline holds the sign-off; an admin’s accept records it as it was signed', async () => {
      const pat = await clinician('pat@example.com', 'Pat (demo)', 'np');
      const charted = await chartedVisit(pat);
      const made = nowIso();
      const signs = [
        await signoff(pat, charted.flags, 'sign', timed(made)),
        await signoff(pat, charted.note, 'sign', timed(made)),
      ];
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(pat.membershipId, 'chw');
      const held = { status: 'rejected', reason: 'permission', quarantined: true };
      expect(await pat.send(...signs)).toEqual(signs.map(() => expect.objectContaining(held)));
      for (const c of signs) expect(await signoffRow(c.recordId)).toBeUndefined();

      const mark = await auditMark(h);
      for (const c of signs) {
        const [item] = await h.scratch.owner<{ id: string }[]>`
          select id from sineobex.quarantine_items where change_id = ${c.changeId}`;
        const decided = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision: 'accept', reason: 'Demo: checked with Pat' },
        });
        expect(decided.status).toBe(200);
      }
      expect(await noteRow(charted.note.noteId)).toMatchObject({ status: 'signed', attestation: 'waiting' });
      expect(await signoffRow(signs[1]!.recordId)).toMatchObject({
        signerCredential: 'np',
        needsAttestation: true,
        approvedBy: t.adminId,
        signerUserId: pat.id,
      });
      const [event] = (await expectAudit(h, 'note.signed', { after: mark, count: 2 })).slice(1);
      expect(event).toMatchObject({
        actorUserId: t.adminId,
        details: { onBehalfOf: pat.id, signoffId: signs[1]!.recordId, credential: 'np' },
      });
    });

    it('an addendum or a correction held behind a held sign-off a reviewer rejects is accepted as if it named none, and so is one sent later', async () => {
      // Review finding PS-2: accept answered cannot_apply note_signoff_missing for good, and the
      // phone had let go of both.
      const zed = await clinician('zed@example.com', 'Zed (demo)', 'np');
      const { flags, note } = await chartedVisit(zed);
      const made = nowIso();
      const s1 = await signoff(zed, flags, 'sign', timed(made));
      const s2 = await signoff(zed, note, 'sign', timed(made));
      const add = await zed.phone.change({
        entity: 'note_addendum',
        op: 'create',
        value: {
          encounterId: note.encounterId,
          noteId: null,
          text: 'Demo: added to the assessment',
          signoffId: s1.recordId,
        },
      });
      const fix = await zed.phone.change({
        entity: 'note_correction',
        op: 'create',
        value: {
          noteId: note.noteId,
          changes: [
            { field: 'data.care.plan', newValue: 'Demo: rest, fluids and a recheck', baseVersion: 1 },
          ],
          reason: 'Demo: the recheck was left out',
          requestedByPatient: false,
          declined: false,
          claimedCredential: null,
          signoffId: s2.recordId,
        },
      });
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(zed.membershipId, 'chw');
      expect((await zed.send(s1, s2, add, fix)).map((r) => [r.status, r.reason, r.quarantined])).toEqual([
        ['rejected', 'permission', true],
        ['rejected', 'permission', true],
        ['rejected', 'awaiting_review', true],
        ['rejected', 'awaiting_review', true],
      ]);
      const decide = async (c: Change, decision: 'accept' | 'reject') => {
        const [item] = await h.scratch.owner<{ id: string }[]>`
          select id from sineobex.quarantine_items where change_id = ${c.changeId}`;
        return call(h, `/v1/team/quarantine/${item!.id}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision, reason: 'Demo: checked with Zed' },
        });
      };
      // While the sign-off waits, the addendum waits with it.
      expect((await decide(add, 'accept')).body.error).toMatchObject({ code: 'waiting_on_record' });
      expect((await decide(s1, 'reject')).status).toBe(200);
      expect((await decide(s2, 'reject')).status).toBe(200);
      // Rejected, the sign-offs named nothing the addendum and the correction need: each is taken as
      // if it named none. The note was never finished, so the correction is an edit of the draft (3.6).
      expect((await decide(add, 'accept')).status).toBe(200);
      expect((await decide(fix, 'accept')).status).toBe(200);
      const [addendum] = await h.scratch.owner<{ noteId: string | null; text: string }[]>`
        select note_id as "noteId", text from sineobex.note_addenda where id = ${add.recordId}`;
      expect(addendum).toEqual({ noteId: null, text: 'Demo: added to the assessment' });
      const [correction] = await h.scratch.owner<{ outcome: string; reason: string }[]>`
        select outcome, reason from sineobex.note_corrections where id = ${fix.recordId}`;
      expect(correction).toEqual({ outcome: 'draft_edit', reason: 'Demo: the recheck was left out' });
      expect(await noteRow(note.noteId)).toMatchObject({ status: 'draft' });
      const [plan] = await h.scratch.owner<{ value: unknown }[]>`
        select data -> 'care.plan' as value from sineobex.encounter_notes where id = ${note.noteId}`;
      expect(plan!.value).toBe('Demo: rest, fluids and a recheck');
      // One sent later, naming a sign-off a reviewer rejected, is taken the same way.
      const later = await zed.phone.change({
        entity: 'note_addendum',
        op: 'create',
        value: {
          encounterId: note.encounterId,
          noteId: note.noteId,
          text: 'Demo: written later',
          signoffId: s2.recordId,
        },
      });
      expect((await zed.send(later)).map((r) => r.status)).toEqual(['accepted']);
      // A sign-off that is simply not on the chart, rejected by no reviewer, is still a missing parent.
      const unknown = await zed.phone.change({
        entity: 'note_addendum',
        op: 'create',
        value: {
          encounterId: note.encounterId,
          noteId: note.noteId,
          text: 'Demo: names nothing known',
          signoffId: '00000000-0000-4000-8000-0000000000ff',
        },
      });
      expect(await zed.send(unknown)).toEqual([
        expect.objectContaining({
          status: 'rejected',
          reason: 'stale_reference',
          details: { problem: 'note_signoff_missing' },
        }),
      ]);
    });

    // Review finding VS-4: withoutRejectedSignoff takes a sign-off as rejected only when it is not on
    // the chart and no held create of it still waits; each clause matters when two changes share
    // one sign-off ID (a held sign-off rejected, and its note completed again under the same ID).
    describe('a sign-off a reviewer rejected, completed again under the same ID', () => {
      const decide = async (c: Change, decision: 'accept' | 'reject') => {
        const [item] = await h.scratch.owner<{ id: string }[]>`
          select id from sineobex.quarantine_items where change_id = ${c.changeId}`;
        return call(h, `/v1/team/quarantine/${item!.id}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision, reason: 'Demo: checked' },
        });
      };
      const addendum = (c: Who, n: Held, signoffId: string) =>
        c.phone.change({
          entity: 'note_addendum',
          op: 'create',
          value: { encounterId: n.encounterId, noteId: n.noteId, text: 'Demo: one more thing', signoffId },
        });

      /** [c]'s sign-off of [note], held for review and rejected; the change and its record ID. */
      async function rejectedSignoff(c: Who) {
        const { flags, note } = await chartedVisit(c);
        const made = nowIso();
        const s1 = await signoff(c, flags, 'sign', timed(made));
        const s2 = await signoff(c, note, 'sign', timed(made));
        await new Promise((r) => setTimeout(r, 5));
        await setCredential(c.membershipId, 'chw');
        expect((await c.send(s1, s2)).map((r) => r.reason)).toEqual(['permission', 'permission']);
        expect((await decide(s1, 'reject')).status).toBe(200);
        expect((await decide(s2, 'reject')).status).toBe(200);
        return { flags, note, s1, s2 };
      }

      it('while its fix waits for review too, what names it waits with it, and is not taken as naming none', async () => {
        const uma = await clinician('uma-vs4@example.com', 'Uma VS-4 (demo)', 'np');
        const { flags, note, s1, s2 } = await rejectedSignoff(uma);
        // Completed again, still with the lowered credential: the fixes are held under the same IDs.
        const made = nowIso();
        const again = [
          await signoff(uma, flags, 'sign', {
            ...timed(made),
            recordId: s1.recordId,
            supersedes: s1.changeId,
          }),
          await signoff(uma, note, 'sign', {
            ...timed(made),
            recordId: s2.recordId,
            supersedes: s2.changeId,
          }),
        ];
        expect((await uma.send(...again)).map((r) => [r.status, r.reason])).toEqual([
          ['rejected', 'permission'],
          ['rejected', 'permission'],
        ]);
        const add = await addendum(uma, note, s2.recordId);
        expect(await uma.send(add)).toEqual([
          expect.objectContaining({ status: 'rejected', reason: 'awaiting_review', quarantined: true }),
        ]);
        const [row] = await h.scratch.owner`select id from sineobex.note_addenda where id = ${add.recordId}`;
        expect(row).toBeUndefined();
      });

      it('once its fix is on the chart, what names it is held to that sign-off as any is, never taken as naming none', async () => {
        const vi = await clinician('vi-vs4@example.com', 'Vi VS-4 (demo)', 'np');
        const { flags, note, s1, s2 } = await rejectedSignoff(vi);
        // Vi's credential is back; completed again, the fixes reach the chart under the same IDs.
        await setCredential(vi.membershipId, 'np');
        const made = nowIso();
        const again = [
          await signoff(vi, flags, 'sign', {
            ...timed(made),
            recordId: s1.recordId,
            supersedes: s1.changeId,
          }),
          await signoff(vi, note, 'sign', { ...timed(made), recordId: s2.recordId, supersedes: s2.changeId }),
        ];
        expect((await vi.send(...again)).map((r) => r.status)).toEqual(['accepted', 'accepted']);
        // An addendum to another note of the visit naming that sign-off is refused, as one naming any
        // sign-off of another note is (REC-3): the rejected held create does not make it name none.
        const add = await addendum(vi, flags, s2.recordId);
        expect(await vi.send(add)).toEqual([
          expect.objectContaining({
            status: 'rejected',
            reason: 'stale_reference',
            details: { problem: 'note_signoff_missing' },
          }),
        ]);
      });
    });

    it('a held sign-off that will not reach the chart tells its sender the note needs completing again: rejected, or refused on accept as the note changed', async () => {
      // Review finding NOT-12: the phone let go of the sign-off when it was held.
      const ned = await clinician('ned@example.com', 'Ned (demo)', 'np');
      const bea = await clinician('bea@example.com', 'Bea (demo)', 'attending');
      const changed = await chartedVisit(ned);
      const other = await chartedVisit(ned);
      const made = nowIso();
      const sent = [
        await signoff(ned, other.flags, 'sign', timed(made)),
        await signoff(ned, changed.note, 'sign', timed(made)),
        await signoff(ned, other.note, 'sign', timed(made)),
        // Not a sign-off: rejected, it tells nobody anything.
        await ned.phone.change({
          entity: 'encounter_note',
          recordId: other.note.noteId,
          op: 'set',
          field: 'data.care.plan',
          value: 'Demo: fluids and rest',
          baseVersion: 1,
        }),
      ];
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(ned.membershipId, 'chw');
      expect(await ned.send(...sent)).toEqual(
        sent.map(() => expect.objectContaining({ reason: 'permission', quarantined: true })),
      );
      // A teammate rewrites the visit's summary while every note is a draft: the note no longer
      // matches what Ned signed.
      const rewrite = await bea.phone.change({
        entity: 'encounter',
        recordId: changed.visit.encounterId,
        op: 'set',
        field: 'summary',
        value: 'Demo: seen by the bridge',
        baseVersion: 0,
      });
      expect((await bea.send(rewrite)).map((r) => r.status)).toEqual(['accepted']);
      const itemOf = async (c: Change) =>
        (
          await h.scratch.owner<{ id: string }[]>`
            select id from sineobex.quarantine_items where change_id = ${c.changeId}`
        )[0]!.id;
      const decide = async (c: Change, decision: 'accept' | 'reject') =>
        call(h, `/v1/team/quarantine/${await itemOf(c)}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision, reason: 'Demo: checked with Ned' },
        });
      // On the held sign-off, by a kind of its own: the phone words it with no state of its own (SRC-2).
      const told = [{ userId: ned.id, kind: 'signoff_not_applied', entity: 'note_signoff' }];

      // Accepted: on the chart, and nobody is told anything.
      expect((await decide(sent[0]!, 'accept')).status).toBe(200);
      expect(await noticesOn(other.flags.noteId)).toEqual([]);
      // Refused on accept, as the note changed: still held, and Ned is told the note needs completing.
      const mark = await auditMark(h);
      const refusedAccept = await decide(sent[1]!, 'accept');
      expect(refusedAccept.status).toBe(409);
      expect(refusedAccept.body.error).toMatchObject({
        code: 'cannot_apply',
        message: expect.stringContaining('The note changed after it was signed'),
        details: { status: 'rejected', reason: 'validation', problem: 'content_changed' },
      });
      expect(await noteRow(changed.note.noteId)).toMatchObject({ status: 'draft', signoffId: null });
      expect(await signoffRow(sent[1]!.recordId)).toBeUndefined();
      expect(await noticesOn(sent[1]!.recordId)).toEqual(told);
      expect(await noticesOn(changed.note.noteId)).toEqual([]);
      const [event] = await expectAudit(h, 'quarantine.accept_refused', { after: mark, count: 1 });
      expect(event).toMatchObject({
        actorUserId: t.adminId,
        entity: 'encounter_note',
        entityId: changed.note.noteId,
        patientId,
        details: { itemId: await itemOf(sent[1]!), changeId: sent[1]!.changeId, problem: 'content_changed' },
      });
      // Rejected then: that sign-off was told already.
      expect((await decide(sent[1]!, 'reject')).status).toBe(200);
      expect(await noticesOn(sent[1]!.recordId)).toEqual(told);
      // A held change that is not a sign-off, rejected, tells nobody; a held sign-off, rejected, its sender.
      expect((await decide(sent[3]!, 'reject')).status).toBe(200);
      expect(await noticesOn(sent[3]!.recordId)).toEqual([]);
      expect((await decide(sent[2]!, 'reject')).status).toBe(200);
      expect(await noticesOn(sent[2]!.recordId)).toEqual(told);
      expect(await noticesOn(other.note.noteId)).toEqual([]);
      expect(await noteRow(other.note.noteId)).toMatchObject({ status: 'draft', signoffId: null });
    });

    it('each held sign-off is told once, whether or not an earlier notice was read', async () => {
      // Review findings SRC-1 and SRC-5: told by note, a second held Complete rejected before the
      // phone's read of the first notice arrived told nobody, and a late reject of the first one was
      // taken by the phone for the second, still held.
      const uma = await clinician('uma@example.com', 'Uma (demo)', 'np');
      const viv = await clinician('viv@example.com', 'Viv (demo)', 'attending');
      const charted = await chartedVisit(uma);
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(uma.membershipId, 'chw');
      const itemOf = async (c: Change) =>
        (
          await h.scratch.owner<{ id: string }[]>`
            select id from sineobex.quarantine_items where change_id = ${c.changeId}`
        )[0]!.id;
      const decide = async (c: Change, decision: 'accept' | 'reject') =>
        call(h, `/v1/team/quarantine/${await itemOf(c)}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision, reason: 'Demo: checked with Uma' },
        });
      const told = (signoffId: string) =>
        h.scratch.owner<{ kind: string; entity: string; read: boolean }[]>`
          select kind, entity, read_at is not null as read from sineobex.user_notices
          where user_id = ${uma.id} and record_id = ${signoffId} order by created_at, id`;
      const once = { kind: 'signoff_not_applied', entity: 'note_signoff' };
      const held = async () => {
        const s = await signoff(uma, charted.flags, 'sign');
        expect(await uma.send(s)).toEqual([expect.objectContaining({ quarantined: true })]);
        return s;
      };

      // Held, rejected: told. Completed again, held again, and rejected before the first notice is
      // read: told again, on the second sign-off.
      const first = await held();
      expect((await decide(first, 'reject')).status).toBe(200);
      const second = await held();
      expect((await decide(second, 'reject')).status).toBe(200);
      expect(await told(first.recordId)).toEqual([{ ...once, read: false }]);
      expect(await told(second.recordId)).toEqual([{ ...once, read: false }]);
      expect(await noticesOn(charted.flags.noteId)).toEqual([]);

      // Held, its accept refused as the note changed: told, and the person reads it.
      const third = await held();
      const edit = await viv.phone.change({
        entity: 'encounter',
        recordId: charted.visit.encounterId,
        op: 'set',
        field: 'summary',
        value: 'Demo: seen at the bridge',
        baseVersion: 0,
      });
      expect((await viv.send(edit)).map((r) => r.status)).toEqual(['accepted']);
      expect((await decide(third, 'accept')).status).toBe(409);
      const [notice] = await h.scratch.owner<{ id: string }[]>`
        select id from sineobex.user_notices where record_id = ${third.recordId}`;
      const read = await call(h, `/v1/team/notices/${notice!.id}/read`, {
        method: 'POST',
        token: uma.token,
        teamId: t.teamId,
      });
      expect(read.status).toBe(200);
      // Completed again and held: still pending, a later sign-off of the same note.
      const fourth = await held();
      // The reviewer rejects the third later, as the refused accept invites: that sign-off was told
      // already, read or not, and nothing names the fourth, which is still held.
      expect((await decide(third, 'reject')).status).toBe(200);
      expect(await told(third.recordId)).toEqual([{ ...once, read: true }]);
      expect(await told(fourth.recordId)).toEqual([]);
      const [pending] = await h.scratch.owner<{ status: string }[]>`
        select status from sineobex.quarantine_items where change_id = ${fourth.changeId}`;
      expect(pending!.status).toBe('pending');
    });

    it('a held sign-off’s notice names its note, rejected or refused on accept; no other notice names one', async () => {
      // D104: the notice names the held sign-off, which waits in the review queue and is never in the
      // sync read, so a phone that never held it (a second phone, or one erased at a synced sign-out)
      // finds the note by the notice alone.
      const ivy = await clinician('ivy@example.com', 'Ivy (demo)', 'np');
      const jon = await clinician('jon@example.com', 'Jon (demo)', 'attending');
      const rejected = await chartedVisit(ivy);
      const changed = await chartedVisit(ivy);
      const sent = [await signoff(ivy, rejected.flags, 'sign'), await signoff(ivy, changed.flags, 'sign')];
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(ivy.membershipId, 'chw');
      expect(await ivy.send(...sent)).toEqual(sent.map(() => expect.objectContaining({ quarantined: true })));
      // A teammate rewrites one visit's summary, so its Red flags note no longer matches what Ivy
      // signed, and signs Ivy's other note of it, which tells Jon about that note.
      const rewrite = await jon.phone.change({
        entity: 'encounter',
        recordId: changed.visit.encounterId,
        op: 'set',
        field: 'summary',
        value: 'Demo: seen under the bridge',
        baseVersion: 0,
      });
      const theirs = await signoff(jon, changed.note, 'sign');
      expect((await jon.send(rewrite, theirs)).map((r) => r.status)).toEqual(['accepted', 'accepted']);
      const itemOf = async (c: Change) =>
        (
          await h.scratch.owner<{ id: string }[]>`
            select id from sineobex.quarantine_items where change_id = ${c.changeId}`
        )[0]!.id;
      const decide = async (c: Change, decision: 'accept' | 'reject') =>
        call(h, `/v1/team/quarantine/${await itemOf(c)}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision, reason: 'Demo: checked with Ivy' },
        });
      expect((await decide(sent[0]!, 'reject')).status).toBe(200);
      expect((await decide(sent[1]!, 'accept')).status).toBe(409);

      const listed = async (c: Who) =>
        (await call(h, '/v1/team/notices', { token: c.token, teamId: t.teamId })).body as unknown;
      const notice = (kind: string, entity: string, recordId: string, noteId: string | null) => ({
        id: expect.any(String),
        kind,
        entity,
        recordId,
        noteId,
        // Only a flag change's notice names its patient (phase 5).
        patientId: null,
        createdAt: expect.any(String),
        readAt: null,
      });
      // Newest first: the refused accept's, then the reject's.
      expect(await listed(ivy)).toEqual([
        notice('signoff_not_applied', 'note_signoff', sent[1]!.recordId, changed.flags.noteId),
        notice('signoff_not_applied', 'note_signoff', sent[0]!.recordId, rejected.flags.noteId),
      ]);
      expect(await listed(jon)).toEqual([
        notice('change_not_applied', 'encounter_note', changed.note.noteId, null),
      ]);
      // Of every notice written here, only a held sign-off's names a note.
      expect(
        await h.scratch.owner`select distinct kind from sineobex.user_notices where note_id is not null`,
      ).toEqual([{ kind: 'signoff_not_applied' }]);
    });

    // Review finding VS-6: a held correction taken as naming none (PS-2) can still be refused at
    // accept, and its phone let go of it when it was held.
    it('a held correction refused at accept, or rejected, tells its sender, naming the note, with no text of it', async () => {
      const zed = await clinician('zed-vs6@example.com', 'Zed VS-6 (demo)', 'np');
      const tea = await clinician('tea-vs6@example.com', 'Tea VS-6 (demo)', 'attending');
      const { flags, note } = await chartedVisit(zed);
      const made = nowIso();
      const s1 = await signoff(zed, flags, 'sign', timed(made));
      const s2 = await signoff(zed, note, 'sign', timed(made));
      const correction = (plan: string) =>
        zed.phone.change({
          entity: 'note_correction',
          op: 'create',
          value: {
            noteId: note.noteId,
            changes: [{ field: 'data.care.plan', newValue: plan, baseVersion: 1 }],
            reason: 'Demo: the recheck was left out',
            requestedByPatient: false,
            declined: false,
            claimedCredential: null,
            signoffId: s2.recordId,
          },
        });
      const fix = await correction('Demo: rest, fluids and a recheck');
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(zed.membershipId, 'chw');
      expect((await zed.send(s1, s2, fix)).map((r) => [r.status, r.reason])).toEqual([
        ['rejected', 'permission'],
        ['rejected', 'permission'],
        ['rejected', 'awaiting_review'],
      ]);
      const decide = async (c: Change, decision: 'accept' | 'reject') => {
        const [item] = await h.scratch.owner<{ id: string }[]>`
          select id from sineobex.quarantine_items where change_id = ${c.changeId}`;
        return call(h, `/v1/team/quarantine/${item!.id}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision, reason: 'Demo: checked with Zed' },
        });
      };
      expect((await decide(s1, 'reject')).status).toBe(200);
      expect((await decide(s2, 'reject')).status).toBe(200);
      // A teammate edits the draft's answer: the correction's version is gone.
      const teas = await tea.phone.change({
        entity: 'encounter_note',
        recordId: note.noteId,
        op: 'set',
        field: 'data.care.plan',
        value: 'Demo: teammate plan',
        baseVersion: 1,
      });
      expect((await tea.send(teas)).map((r) => r.status)).toEqual(['accepted']);
      const mark = await auditMark(h);
      const refused = await decide(fix, 'accept');
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({
        code: 'cannot_apply',
        details: { problem: 'field_changed' },
      });
      const told = await h.scratch.owner<{ kind: string; entity: string; noteId: string | null }[]>`
        select kind, entity, note_id as "noteId" from sineobex.user_notices
        where user_id = ${zed.id} and record_id = ${fix.recordId}`;
      expect(told).toEqual([
        { kind: 'correction_not_applied', entity: 'note_correction', noteId: note.noteId },
      ]);
      expect(await eventsAfter(mark)).toEqual([
        expect.objectContaining({
          action: 'quarantine.accept_refused',
          entity: 'encounter_note',
          entityId: note.noteId,
        }),
      ]);
      // The item stays pending; the reject that follows tells nobody twice.
      expect((await decide(fix, 'reject')).status).toBe(200);
      expect(await noticesOn(fix.recordId)).toHaveLength(1);
      // The notice holds no text of the correction, and is listed with its note.
      const listed = (await call(h, '/v1/team/notices', { token: zed.token, teamId: t.teamId }))
        .body as unknown as { kind: string; noteId: string | null }[];
      expect(listed.filter((n) => n.kind === 'correction_not_applied')).toEqual([
        expect.objectContaining({ entity: 'note_correction', recordId: fix.recordId, noteId: note.noteId }),
      ]);
      expect(JSON.stringify(listed)).not.toContain('Demo');
      // A held correction rejected outright tells its sender too.
      const again = await correction('Demo: rest and a recheck');
      expect((await zed.send(again)).map((r) => r.status)).toEqual(['rejected']);
      expect((await decide(again, 'reject')).status).toBe(200);
      expect(await noticesOn(again.recordId)).toEqual([
        { userId: zed.id, kind: 'correction_not_applied', entity: 'note_correction' },
      ]);
    });

    it('a held sign-off’s time is checked against when its push arrived, not when an admin accepted it', async () => {
      const quinn = await clinician('quinn@example.com', 'Quinn (demo)', 'np');
      const charted = await chartedVisit(quinn);
      const flags = await signoff(quinn, charted.flags, 'sign');
      expect((await quinn.send(flags)).map((r) => r.details?.effect)).toEqual(['signed']);
      const made = nowIso();
      const sign = await signoff(quinn, charted.note, 'sign', timed(made));
      await new Promise((r) => setTimeout(r, 5));
      await setCredential(quinn.membershipId, 'chw');
      expect(await quinn.send(sign)).toEqual([
        expect.objectContaining({ reason: 'permission', quarantined: true }),
      ]);
      // As if the push had arrived ten minutes before the time its signature claims: a phone clock
      // running ahead. Accepted now, that time would be believed; it was not when it arrived.
      const [item] = await h.scratch.owner<{ id: string; receivedAt: Date }[]>`
        update sineobex.quarantine_items set received_at = ${new Date(Date.parse(made) - 10 * 60_000)}
        where change_id = ${sign.changeId} returning id, received_at as "receivedAt"`;
      const decided = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'accept', reason: 'Demo: checked with Quinn' },
      });
      expect(decided.status).toBe(200);
      // So the credential is the one held now, which cannot sign.
      expect(await signoffRow(sign.recordId)).toMatchObject({
        effect: 'saved_unsigned',
        signerCredential: 'chw',
        receivedAt: item!.receivedAt,
        approvedBy: t.adminId,
      });
      expect(await noteRow(charted.note.noteId)).toMatchObject({ status: 'completed', signoffId: null });
    });

    it('a removed signer’s sign-off, handed over, applies on accept under the membership as it is now', async () => {
      // Rio signs offline as a resident, and is removed from the team before the phone syncs
      // (4.6, "From a removed person"; review finding NOT-11).
      const rio = await clinician('rio@example.com', 'Rio (demo)', 'resident');
      const charted = await chartedVisit(rio);
      const flags = await signoff(rio, charted.flags, 'sign');
      expect((await rio.send(flags)).map((r) => r.details?.effect)).toEqual(['signed']);
      const sign = await signoff(rio, charted.note, 'sign', timed(nowIso()));
      const removed = await call(h, `/v1/team/members/${rio.membershipId}/remove`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { reason: 'Left the program' },
      });
      expect(removed.status).toBe(200);
      expect((await handOver(h, rio.phone, [sign])).status).toBe(200);
      expect(await signoffRow(sign.recordId)).toBeUndefined();

      const [item] = await h.scratch.owner<{ id: string; receivedAt: Date }[]>`
        select id, received_at as "receivedAt" from sineobex.quarantine_items where change_id = ${sign.changeId}`;
      const mark = await auditMark(h);
      const decided = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'accept', reason: 'Demo: Rio signed it before leaving' },
      });
      expect(decided.status).toBe(200);
      expect(await signoffRow(sign.recordId)).toMatchObject({
        effect: 'signed',
        signerUserId: rio.id,
        signerCredential: 'resident',
        needsAttestation: true,
        approvedBy: t.adminId,
        receivedAt: item!.receivedAt,
      });
      expect(await noteRow(charted.note.noteId)).toMatchObject({
        status: 'signed',
        attestation: 'waiting',
        completedBy: rio.id,
        signoffId: sign.recordId,
      });
      const [event] = await expectAudit(h, 'note.signed', { after: mark, count: 1 });
      expect(event).toMatchObject({
        actorUserId: t.adminId,
        details: {
          onBehalfOf: rio.id,
          signoffId: sign.recordId,
          credential: 'resident',
          needsAttestation: true,
        },
      });
    });
  });

  describe('what a sign-off names, and what it is', () => {
    let fay: Who;
    let kim: Who;

    beforeAll(async () => {
      fay = await clinician('fay@example.com', 'Fay (demo)', 'attending');
      // Charts, and cannot chart Medical.
      kim = await clinician('kim@example.com', 'Kim (demo)', 'chw');
    });

    it('a note the team holds, or it is refused stale_reference; a held note’s sign-off waits with it', async () => {
      const visit = await visitOf(fay);
      const missing: Held = {
        ...visit,
        noteId: randomUUID(),
        type: TYPES.get('test_note')!,
        answers: {},
      };
      const stray = await signoff(fay, missing, 'complete');
      expect(await fay.send(stray)).toEqual([
        expect.objectContaining({
          status: 'rejected',
          reason: 'stale_reference',
          details: { problem: 'encounter_note_missing' },
        }),
      ]);

      // Kim's Medical note is held by the gate; its sign-off waits for the same decision.
      const create = await kim.phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId: visit.encounterId, ...TEST_MEDICAL, data: {} },
      });
      const heldNote: Held = {
        ...visit,
        noteId: create.recordId,
        type: TYPES.get('test_medical')!,
        answers: {},
      };
      const waits = await signoff(kim, heldNote, 'complete');
      expect(await kim.send(create, waits)).toEqual([
        expect.objectContaining({ status: 'rejected', reason: 'permission', quarantined: true }),
        expect.objectContaining({ status: 'rejected', reason: 'awaiting_review', quarantined: true }),
      ]);
    });

    it('is create-only, and its value is checked before anything is read', async () => {
      const visit = await visitOf(fay, null);
      const note = await noteOn(fay, visit, TEST_NOTE, { 'care.plan': 'Demo: rest' });
      const done = await signoff(fay, note, 'complete');
      expect((await fay.send(done)).map((r) => r.status)).toEqual(['accepted']);
      const value = done.value as Record<string, unknown>;
      const bad = async (v: Record<string, unknown>) =>
        fay.phone.change({ entity: 'note_signoff', op: 'create', value: { ...value, ...v } });
      const changes = [
        await fay.phone.change({
          entity: 'note_signoff',
          recordId: done.recordId,
          op: 'set',
          field: 'effect',
          value: 'signed',
        }),
        // A complete signs nothing, so it claims no credential.
        await bad({ claimedCredential: 'attending' }),
        await bad({ contentHash: 'AB'.repeat(32) }),
        await bad({ act: 'cosign' }),
        await bad({ statementVersion: 'Sign 2026' }),
        await bad({ signedAt: '2026-10-20T14:50:00.000Z' }),
      ];
      const answered = await fay.send(...changes);
      expect(answered.map((r) => [r.status, r.reason])).toEqual(
        changes.map(() => ['rejected', 'validation']),
      );
      expect(answered[0]!.details).toEqual({ problem: 'unknown_field' });
      expect(
        answered.slice(1).map((r) => (r.details!.problems as { path: string }[]).map((p) => p.path)),
      ).toEqual([['claimedCredential'], ['contentHash'], ['act'], ['statementVersion'], ['']]);
    });

    it('a note with no version has no type to hash it by: definition_error, and the queue goes on', async () => {
      const visit = await visitOf(fay, null);
      const noteId = randomUUID();
      await h.scratch.owner`
        insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, data)
        values (${noteId}, ${t.teamId}, ${visit.encounterId}, 'wound_care', ${fay.id}, '{"plan": "Demo: dress daily"}')`;
      const preview: Held = { ...visit, noteId, type: TYPES.get('test_note')!, answers: {} };
      const stuck = await signoff(fay, preview, 'complete');
      const next = await signoff(
        fay,
        await noteOn(fay, visit, TEST_NOTE, { 'care.plan': 'Demo: rest' }),
        'complete',
      );
      expect(await fay.send(stuck, next)).toEqual([
        refused(stuck, 'definition_error'),
        applied(next, 'completed', 'completed', 'not_needed'),
      ]);
      expect(await signoffRow(stuck.recordId)).toBeUndefined();
    });
  });
});
