import { randomUUID } from 'node:crypto';
import { validate, type ResolvedNoteType } from '@sineobex/forms';
import { checkFile } from '@sineobex/forms/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit } from './patient-fixtures.ts';
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
  TEST_ASSESS_TYPE,
  TEST_RED_FLAGS_TYPE,
  TEST_RESTRICTED_TYPE,
  TEST_RESTRICTED_TYPES,
  TEST_SENSITIVE_TYPE,
  visitOf,
  type Change,
  type Clinician,
  type HeldNote,
  type Team,
} from './sync-fixtures.ts';

// Who may read and change what in a note, through sync (lifecycle 4.4, 6.4): the sync read leaves
// out what the reader may not see, with its versions and marks; what hangs off a note goes with it;
// a set of an answer the sender may not see is held for review; a note's snapshot shows its state.
// Every person and value is made up.

const [TEST_NOTE_TYPE, TEST_MEDICAL_TYPE] = TEST_NOTE_TYPES as [ResolvedNoteType, ResolvedNoteType];

interface Snapshot {
  entity: string;
  id: string;
  status: string;
  attributes: Record<string, unknown>;
  fields: Record<
    string,
    { value: unknown; version: number; changedBy: string | null; changedAt: string | null }
  >;
}

const E1 = 'e0000001';
const E2 = 'e0000002';
const AT = '2026-10-20T14:50:00Z';

/** A note on test_restricted with something in each kind of section. */
const ANSWERS: Record<string, unknown> = {
  'general.notes': 'Demo: walked over from the shelter',
  'exam.findings': 'Demo: no lesions seen',
  'moud.dose': 'Demo: 8 mg',
  'meds.given': 'Demo: none today',
  'systems.seen': ['heart', 'gu'],
  // A diagnosis whose code is on the sensitive list, and one whose code is not.
  [`dx.${E1}.entryAt`]: AT,
  [`dx.${E1}.diagnosis.code`]: 'F11.20',
  [`dx.${E1}.diagnosis.label`]: 'Demo: opioid use',
  [`dx.${E1}.note`]: 'Demo: talk again next week',
  [`dx.${E2}.entryAt`]: AT,
  [`dx.${E2}.diagnosis.code`]: 'J02.9',
  [`dx.${E2}.diagnosis.label`]: 'Demo: sore throat',
};
const ALL = Object.keys(ANSWERS)
  .map((path) => `data.${path}`)
  .sort();
const without = (...gone: string[]) =>
  ALL.filter((field) => !gone.some((g) => field === `data.${g}` || field.startsWith(`data.${g}.`)));

describe('phase 4 sync: who may read and change what in a note', () => {
  let h: Harness;
  let t: Team;
  let patientId: string;
  /** Attending, Healthcare Staff: the author. */
  let ana: Clinician;
  /** Healthcare Staff, no credential: no sensitive exams, no treatment records, no ordering. */
  let ben: Clinician;
  /** Healthcare Staff, a student: charts Medical, so reads treatment records; does not order. */
  let sky: Clinician;
  /** A custom role with patients.view and encounters.chart only: nothing sensitive. */
  let dee: Clinician;
  /** A custom role with encounters.chart alone: no patients.view, so no Medical note. */
  let eli: Clinician;
  const admin = () => ({ token: t.adminToken });

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
    await installNoteTypes(h, t.teamId, [...TEST_RESTRICTED_TYPES, TEST_RED_FLAGS_TYPE]);
    patientId = (await createPatient(h, t.teamId, t.adminId)).id;
    const role = async (name: string, permissions: string[]) => {
      const r = await call(h, '/v1/team/roles', {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { name, permissions },
      });
      expect(r.status).toBe(201);
      return r.body.key as string;
    };
    ana = await clinician(h, t, 'ana@example.com', 'Ana (demo)', 'attending');
    ben = await clinician(h, t, 'ben@example.com', 'Ben (demo)', 'none');
    sky = await clinician(h, t, 'sky@example.com', 'Sky (demo)', 'student');
    dee = await clinician(
      h,
      t,
      'dee@example.com',
      'Dee (demo)',
      'none',
      await role('Outreach charting', ['patients.view', 'encounters.chart']),
    );
    eli = await clinician(
      h,
      t,
      'eli@example.com',
      'Eli (demo)',
      'none',
      await role('Charting only', ['encounters.chart']),
    );
  });
  afterAll(() => h.close());

  async function read(token: string, refs: { entity: string; id: string }[]) {
    const r = await call(h, '/v1/sync/records', {
      method: 'POST',
      token,
      teamId: t.teamId,
      json: { records: refs },
    });
    return {
      status: r.status,
      records: (r.body.records ?? []) as Snapshot[],
      missing: (r.body.missing ?? []) as { entity: string; id: string }[],
    };
  }
  const noteRef = (n: { noteId: string }) => ({ entity: 'encounter_note', id: n.noteId });
  const noteAs = async (c: { token: string }, n: { noteId: string }) => {
    const r = await read(c.token, [noteRef(n)]);
    expect(r.status).toBe(200);
    return r.records[0];
  };
  const answerFields = (s: Snapshot | undefined) =>
    Object.keys(s!.fields)
      .filter((f) => f.startsWith('data.'))
      .sort();

  const noteRow = async (id: string) =>
    (
      await h.scratch.owner<{ status: string; data: Record<string, unknown>; completedAt: Date | null }[]>`
        select status, data, completed_at as "completedAt" from sineobex.encounter_notes where id = ${id}`
    )[0]!;

  const held = { status: 'rejected', reason: 'permission', quarantined: true };

  it('the test-only note types are definitions the export would take', () => {
    for (const definition of TEST_RESTRICTED_TYPES) {
      expect(checkFile('noteType', definition), definition.key).toEqual([]);
      expect(validate(definition, { noteType: () => undefined }), definition.key).toEqual([]);
    }
    expect(TEST_RESTRICTED_TYPE.kinds).toContain('non_medical');
    expect(TEST_SENSITIVE_TYPE.sensitivity).toBe('sensitive');
  });

  describe('the sync read of a note (lifecycle 4.4, 6.4)', () => {
    it('a teammate’s copy lists only the answers they may see: one they may not leaves no value, version or mark', async () => {
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, ANSWERS);

      // Whoever acts as the author reads all of it.
      expect(answerFields(await noteAs(ana, n))).toEqual(ALL);
      // No key for sensitive exams, and no treatment record without a credential that charts
      // Medical. The picker keeps what it may show, at the answer's version.
      const bens = await noteAs(ben, n);
      expect(answerFields(bens)).toEqual(without('exam', 'moud'));
      expect(bens!.fields['data.systems.seen']).toEqual({
        value: ['heart'],
        version: 1,
        changedBy: ana.id,
        changedAt: expect.any(String),
      });
      expect(bens!.fields['data.general.notes']).toMatchObject({
        value: ANSWERS['general.notes'],
        version: 1,
        changedBy: ana.id,
      });
      // A section an ordering credential changes is read by everyone (6.4, rule 5).
      expect(bens!.fields['data.meds.given']).toMatchObject({ value: ANSWERS['meds.given'] });
      expect(bens!.status).toBe('draft');
      // A student charts Medical: the treatment record, not the exam.
      expect(answerFields(await noteAs(sky, n))).toEqual(without('exam'));
      // The Program Admin holds every key and no clinical credential: the exam, not the treatment record.
      const admins = await noteAs(admin(), n);
      expect(answerFields(admins)).toEqual(without('moud'));
      expect(admins!.fields['data.systems.seen']).toMatchObject({ value: ['heart', 'gu'] });
      // Without patients.view_sensitive a sensitive diagnosis takes its whole entry with it.
      expect(answerFields(await noteAs(dee, n))).toEqual(without('exam', 'moud', `dx.${E1}`));
    });

    it('a teammate’s copy is versioned and dated by what it shows: a change only to a hidden answer moves neither', async () => {
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, ANSWERS);
      const stamp = async (c: { token: string }) => {
        const s = (await noteAs(c, n)) as Snapshot & { version: number; updatedAt: string };
        return { version: s.version, updatedAt: s.updatedAt };
      };
      const set = (field: string, value: unknown, at = new Date(Date.now() + 5).toISOString()) =>
        ana.phone.change({
          entity: 'encounter_note',
          recordId: n.noteId,
          op: 'set',
          field,
          value,
          baseVersion: 1,
          deviceTime: at,
          correctedTime: at,
        });
      const before = await stamp(ben);
      const anas = await stamp(ana);

      // Ana edits only the exam, which Ben may not see (RD-6): his copy has no mark that it changed.
      expect(
        (await ana.send(await set('data.exam.findings', 'Demo: a small rash'))).map((r) => r.status),
      ).toEqual(['accepted']);
      expect(await stamp(ben)).toEqual(before);
      // The author's own copy moves, as it always has.
      expect((await stamp(ana)).version).toBe(anas.version + 1);

      // A change Ben is shown moves both: to that field's version and time, which his copy shows.
      const at = new Date(Date.now() + 10).toISOString();
      const shown = await set('data.general.notes', 'Demo: came by bus', at);
      expect((await ana.send(shown)).map((r) => r.status)).toEqual(['accepted']);
      expect(await stamp(ben)).toEqual({ version: 2, updatedAt: at });
    });

    it('the author’s own draft is sent whole, hidden answers included; everyone else, and a finished note, gets what counts', async () => {
      const answers = {
        'care.plan': 'Demo: rest and fluids',
        'care.followup': '',
        'more.none': true,
        // Hidden while more.none is ticked: kept, and shown again once it is not.
        'more.detail': 'Demo: kept for later',
      };
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_NOTE_TYPE, answers);
      const own = await noteAs(ana, n);
      expect(answerFields(own)).toEqual([
        'data.care.followup',
        'data.care.plan',
        'data.more.detail',
        'data.more.none',
      ]);
      expect(own!.fields['data.more.detail']).toMatchObject({ value: 'Demo: kept for later', version: 1 });
      // A blank is no answer, and a hidden one does not count.
      expect(answerFields(await noteAs(ben, n))).toEqual(['data.care.plan', 'data.more.none']);

      await finishNote(
        ana,
        { ...n, answers: { 'care.plan': answers['care.plan'], 'more.none': true } },
        'complete',
        'completed',
      );
      expect(answerFields(await noteAs(ana, n))).toEqual(['data.care.plan', 'data.more.none']);
    });

    it('a note the reader may not read is missing, like one the team does not have', async () => {
      const visit = await visitOf(ana, patientId);
      const talk = await noteOn(ana, visit, TEST_SENSITIVE_TYPE, {
        'talk.notes': 'Demo: talked about sleep',
      });
      const medical = await noteOn(ana, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: fluids' });
      const both = [noteRef(talk), noteRef(medical)];
      expect((await read(ben.token, both)).records.map((r) => r.id)).toEqual([talk.noteId, medical.noteId]);
      // A sensitive note type needs patients.view_sensitive.
      expect(await read(dee.token, both)).toMatchObject({
        records: [{ id: medical.noteId }],
        missing: [noteRef(talk)],
      });
      // A Medical note needs patients.view, as the problem list does (D37).
      expect(await read(eli.token, both)).toMatchObject({ records: [], missing: both });
      // The community health worker preset charts nothing, so reads no note at all.
      expect((await read(t.chwToken, both)).status).toBe(403);
    });

    it('a note whose definition the server cannot read is missing: what it would hide cannot be told', async () => {
      const visit = await visitOf(ana, patientId);
      // A note naming a version the team does not hold, from before any check: none can be made now.
      const stray = { noteId: randomUUID() };
      await h.scratch.owner`
        insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, note_type_version, author_user_id)
        values (${stray.noteId}, ${t.teamId}, ${visit.encounterId}, 'test_note', 9, ${ana.id})`;
      // A definition the interpreter throws on: two fields that each show only while the other is filled.
      const looped = {
        ...TEST_NOTE_TYPE,
        key: 'test_looped_read',
        sections: [
          {
            id: 'loop',
            title: 'Loop',
            fields: ['a', 'b'].map((id, i) => ({
              id,
              kind: 'text',
              label: id.toUpperCase(),
              lines: 'one',
              maxLength: 200,
              showWhen: { field: `loop.${i === 0 ? 'b' : 'a'}`, filled: true },
            })),
          },
        ],
      } as unknown as ResolvedNoteType;
      await installNoteTypes(h, t.teamId, [looped]);
      const loop = await noteOn(ana, visit, looped, { 'loop.a': 'Demo: round and round' });
      const refs = [noteRef(stray), noteRef(loop)];
      expect(await read(ben.token, refs)).toMatchObject({ records: [], missing: refs });
      // Its author's draft is sent as stored, which reads no definition; one the team lacks is missing.
      expect(await read(ana.token, refs)).toMatchObject({
        records: [{ id: loop.noteId }],
        missing: [refs[0]],
      });
    });

    it('a note’s snapshot shows its state: attestation, who acts as its author, when it was finished and the signature it names', async () => {
      const res = await clinician(h, t, 'res@example.com', 'Res (demo)', 'resident');
      const visit = await visitOf(res, patientId);
      const flags = await noteOn(res, visit, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
      const draft = await noteAs(res, flags);
      expect(draft!.attributes).toEqual({
        encounterId: visit.encounterId,
        noteTypeKey: 'test_red_flags',
        noteTypeVersion: 1,
        attestation: 'not_needed',
        actingAuthorId: res.id,
        completedAt: null,
        signoffId: null,
      });
      const signoff = await finishNote(res, flags, 'sign', 'signed');
      const signed = await noteAs(res, flags);
      expect(signed!.status).toBe('signed');
      expect(signed!.attributes).toMatchObject({
        attestation: 'waiting',
        actingAuthorId: res.id,
        completedAt: (await noteRow(flags.noteId)).completedAt!.toISOString(),
        signoffId: signoff.recordId,
      });
      // Assigned by an admin once the author has left (3.8): the assignee acts as the author.
      await h.scratch
        .owner`update sineobex.encounter_notes set assigned_user_id = ${ana.id} where id = ${flags.noteId}`;
      expect((await noteAs(ana, flags))!.attributes.actingAuthorId).toBe(ana.id);
    });
  });

  describe('what hangs off a note, and referrals (6.4 rule 7)', () => {
    const correctionOf = (c: Clinician, n: HeldNote, path: string, newValue: unknown, baseVersion = 1) =>
      c.phone.change({
        entity: 'note_correction',
        op: 'create',
        value: {
          noteId: n.noteId,
          changes: [{ field: `data.${path}`, newValue, baseVersion }],
          reason: 'Demo: the wrong field was picked',
          requestedByPatient: false,
          declined: false,
          claimedCredential: null,
          signoffId: null,
        },
      });

    it('a sign-off, an addendum and a correction are read by whoever may read their note; a referral with patients.view', async () => {
      const visit = await visitOf(ana, patientId);
      const talk = await noteOn(ana, visit, TEST_SENSITIVE_TYPE, {
        'talk.notes': 'Demo: talked about sleep',
      });
      const signoff = await finishNote(ana, talk, 'complete', 'completed');
      const addendum = await ana.phone.change({
        entity: 'note_addendum',
        op: 'create',
        value: {
          encounterId: visit.encounterId,
          noteId: talk.noteId,
          text: 'Demo: called back',
          signoffId: null,
        },
      });
      const onVisit = await ana.phone.change({
        entity: 'note_addendum',
        op: 'create',
        value: {
          encounterId: visit.encounterId,
          noteId: null,
          text: 'Demo: the van ran late',
          signoffId: null,
        },
      });
      const correction = await correctionOf(ana, talk, 'talk.notes', 'Demo: talked about sleep and food');
      const referral = await ana.phone.change({
        entity: 'referral',
        op: 'create',
        value: {
          patientId,
          referredOn: '2026-10-20',
          details: 'Demo: dental clinic on Main St',
          encounterId: visit.encounterId,
        },
      });
      const sent = await ana.send(addendum, onVisit, correction, referral);
      expect(sent.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
      expect(sent[2]!.details).toMatchObject({ outcome: 'corrected' });

      const offNote = [
        { entity: 'note_signoff', id: signoff.recordId },
        { entity: 'note_addendum', id: addendum.recordId },
        { entity: 'note_correction', id: correction.recordId },
      ];
      const refs = [...offNote, { entity: 'note_addendum', id: onVisit.recordId }];
      const mark = await auditMark(h);
      expect((await read(ben.token, refs)).records.map((r) => r.id)).toEqual(refs.map((r) => r.id));
      await expectAudit(h, 'note.viewed', { after: mark, patientId, count: 4 });
      // Without patients.view_sensitive the note is not read, and nothing that hangs off it; an
      // addendum to the visit itself is read with the visit.
      expect(await read(dee.token, refs)).toMatchObject({
        records: [{ id: onVisit.recordId }],
        missing: offNote,
      });
      // A sign-off, an addendum and a correction need encounters.chart, as their note does.
      for (const ref of refs) expect((await read(t.chwToken, [ref])).status).toBe(403);
      // A referral is a patient's record: read with patients.view, logged as a view of the patient.
      const referralRef = { entity: 'referral', id: referral.recordId };
      const before = await auditMark(h);
      expect((await read(t.chwToken, [referralRef])).records.map((r) => r.id)).toEqual([referral.recordId]);
      await expectAudit(h, 'patient.viewed', { after: before, patientId, count: 1 });
      expect((await read(eli.token, [referralRef])).status).toBe(403);
    });

    it('a Medical visit’s summary and its own addenda are Medical content: read with patients.view, as its notes are', async () => {
      // Eli charts but has no patients.view, so every Medical note is missing for him (D37). The
      // summary of a Medical visit, and an addendum to the visit itself, say as much (RD-7).
      const visitWith = async (kind: 'medical' | 'non_medical') => {
        const create = await ana.phone.change({
          entity: 'encounter',
          op: 'create',
          value: { kind, patientId },
        });
        const summary = await ana.phone.change({
          entity: 'encounter',
          recordId: create.recordId,
          op: 'set',
          field: 'summary',
          value:
            kind === 'medical' ? 'Demo: likely pneumonia; started antibiotics' : 'Demo: dropped off socks',
          baseVersion: 0,
        });
        const addendum = await ana.phone.change({
          entity: 'note_addendum',
          op: 'create',
          value: { encounterId: create.recordId, noteId: null, text: 'Demo: called back', signoffId: null },
        });
        expect((await ana.send(create, summary, addendum)).map((r) => r.status)).toEqual([
          'accepted',
          'accepted',
          'accepted',
        ]);
        return {
          visit: { entity: 'encounter', id: create.recordId },
          addendum: { entity: 'note_addendum', id: addendum.recordId },
        };
      };
      const medical = await visitWith('medical');
      const outreach = await visitWith('non_medical');
      const fieldsOf = (r: { records: Snapshot[] }) => Object.keys(r.records[0]!.fields).sort();

      // Eli: the visit without its summary, and no addendum to it.
      const elis = await read(eli.token, [medical.visit, medical.addendum]);
      expect(elis.records.map((r) => r.id)).toEqual([medical.visit.id]);
      expect(elis.missing).toEqual([medical.addendum]);
      expect(Object.keys(elis.records[0]!.fields)).not.toContain('summary');
      expect(fieldsOf(elis)).toEqual(['kind', 'location', 'locationText', 'patientId']);
      // A Non-Medical visit is his to read whole.
      const plain = await read(eli.token, [outreach.visit, outreach.addendum]);
      expect(plain.records.map((r) => r.id)).toEqual([outreach.visit.id, outreach.addendum.id]);
      expect(plain.records[0]!.fields.summary).toMatchObject({ value: 'Demo: dropped off socks' });
      // Ben reads Medical notes, and so the Medical visit whole.
      const bens = await read(ben.token, [medical.visit, medical.addendum]);
      expect(bens.records.map((r) => r.id)).toEqual([medical.visit.id, medical.addendum.id]);
      expect(bens.records[0]!.fields.summary).toMatchObject({
        value: 'Demo: likely pneumonia; started antibiotics',
      });
    });

    it('a sign-off’s content hash goes only to whoever acts as the author, its signer, and a reader who sees every answer of any note', async () => {
      const role = await call(h, '/v1/team/roles', {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: {
          name: 'Reads every note',
          permissions: [
            'patients.view',
            'encounters.chart',
            'patients.view_sensitive',
            'patients.view_sensitive_exams',
          ],
        },
      });
      expect(role.status).toBe(201);
      const wes = await clinician(
        h,
        t,
        'wes@example.com',
        'Wes (demo)',
        'attending',
        role.body.key as string,
      );
      const visit = await visitOf(ana, patientId);
      // One note with a GU exam, one with none: whether a reader gets the hash says nothing of which.
      const gu = await noteOn(ana, visit, TEST_RESTRICTED_TYPE, {
        'general.notes': 'Demo: walked over',
        'systems.seen': ['heart', 'gu'],
      });
      const plain = await noteOn(ana, visit, TEST_RESTRICTED_TYPE, {
        'general.notes': 'Demo: walked over',
        'systems.seen': ['heart'],
      });
      const signoffs = [
        await finishNote(ana, gu, 'complete', 'completed'),
        await finishNote(ana, plain, 'complete', 'completed'),
      ];
      const refs = signoffs.map((c) => ({ entity: 'note_signoff', id: c.recordId }));
      const hashes = async (c: { token: string }) =>
        (await read(c.token, refs)).records.map((r) => r.attributes.contentHash ?? null);
      const signed = signoffs.map((c) => (c.value as { contentHash: string }).contentHash);
      expect(await hashes(ana)).toEqual(signed);
      expect(await hashes(wes)).toEqual(signed);
      // Shown [heart] on both, Ben could hash each guess of what is hidden against it.
      expect(await hashes(ben)).toEqual([null, null]);
      expect(await hashes(dee)).toEqual([null, null]);
      // The admin holds every key and no credential that charts Medical: a treatment record is hidden.
      expect(await hashes(admin())).toEqual([null, null]);
      // The rest of the sign-off is read as it was.
      const bens = (await read(ben.token, refs)).records;
      expect(bens.map((r) => [r.id, r.attributes.effect, r.attributes.act])).toEqual(
        signoffs.map((c) => [c.recordId, 'completed', 'complete']),
      );
      // Its signer reads it whole, whoever acts as the author now (3.8).
      await h.scratch
        .owner`update sineobex.encounter_notes set assigned_user_id = ${sky.id} where id = ${gu.noteId}`;
      expect((await hashes(ana))[0]).toBe(signed[0]);
      expect((await hashes(sky))[0]).toBe(signed[0]);
    });

    it('a correction is missing for a reader who may not see an answer it changes, in its old value or its new', async () => {
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, ANSWERS);
      await finishNote(ana, n, 'complete', 'completed');
      const plain = await correctionOf(ana, n, 'general.notes', 'Demo: walked over from the park');
      const exam = await correctionOf(ana, n, 'exam.findings', 'Demo: a small rash');
      // Takes GU away: the new value shows nothing sensitive, the old one does.
      const picker = await correctionOf(ana, n, 'systems.seen', ['heart']);
      const dx = await correctionOf(ana, n, `dx.${E1}.note`, 'Demo: talk again in two weeks');
      // Puts it back: now the old value shows nothing sensitive, the new one does.
      const back = await correctionOf(ana, n, 'systems.seen', ['heart', 'gu'], 2);
      const sent = await ana.send(plain, exam, picker, dx, back);
      expect(sent.map((r) => r.details?.outcome)).toEqual([
        'corrected',
        'corrected',
        'corrected',
        'corrected',
        'corrected',
      ]);

      const refs = [plain, exam, picker, dx, back].map((c) => ({
        entity: 'note_correction',
        id: c.recordId,
      }));
      const seen = async (c: { token: string }) => (await read(c.token, refs)).records.map((r) => r.id);
      expect(await seen(ana)).toEqual(refs.map((r) => r.id));
      expect(await seen(admin())).toEqual(refs.map((r) => r.id));
      expect(await seen(ben)).toEqual([plain.recordId, dx.recordId]);
      expect(await seen(dee)).toEqual([plain.recordId]);
    });
  });

  describe('a set of an answer the sender may not see (4.4, 6.4 rule 5)', () => {
    const set = (c: Clinician, n: { noteId: string }, path: string, value: unknown, baseVersion = 1) =>
      c.phone.change({
        entity: 'encounter_note',
        recordId: n.noteId,
        op: 'set',
        field: `data.${path}`,
        value,
        baseVersion,
      });
    /** Held for review, the phone told it may let go of it, and nothing more: no `server` value. */
    const heldOnly = (c: Change) => ({
      changeId: c.changeId,
      hash: c.valueHash,
      ...held,
      message: expect.any(String),
    });

    it('is held for review, with nothing sent back of what the answer holds; the author always sets their own', async () => {
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, ANSWERS);
      const bens = [
        await set(ben, n, 'exam.findings', 'Demo: a small rash'),
        // Not seen, and so a conflict with the answer held there, but held before that is asked.
        await set(ben, n, 'exam.findings', 'Demo: something else', 0),
        await set(ben, n, 'moud.dose', 'Demo: 12 mg'),
        // An ordering credential's section.
        await set(ben, n, 'meds.given', 'Demo: one tablet'),
        // A sensitive option, put there or taken away.
        await set(ben, n, 'systems.seen', ['lungs', 'gu']),
        await set(ben, n, 'systems.seen', ['heart']),
        await set(ben, n, 'general.notes', 'Demo: walked over from the park'),
      ];
      const answers = await ben.send(...bens);
      expect(answers.slice(0, 6)).toEqual(bens.slice(0, 6).map(heldOnly));
      expect(answers[6]).toMatchObject({ status: 'accepted', serverVersion: 2 });
      // On a note whose restricted sections hold nothing: the section alone, or the value sent.
      const bare = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, {
        'general.notes': 'Demo: walked over from the shelter',
        'systems.seen': ['heart'],
      });
      const onBare = [
        await set(ben, bare, 'exam.findings', '', 0),
        await set(ben, bare, 'moud.dose', '', 0),
        await set(ben, bare, 'systems.seen', ['heart', 'gu']),
        await set(ben, bare, 'systems.seen', ['heart', 'lungs']),
      ];
      const bareAnswers = await ben.send(...onBare);
      expect(bareAnswers.slice(0, 3)).toEqual(onBare.slice(0, 3).map(heldOnly));
      expect(bareAnswers[3]).toMatchObject({ status: 'accepted', serverVersion: 2 });
      // A student reads the treatment record, and orders nothing.
      const skys = [
        await set(sky, n, 'moud.dose', 'Demo: 12 mg'),
        await set(sky, n, 'meds.given', 'Demo: one tablet'),
      ];
      const skyAnswers = await sky.send(...skys);
      expect(skyAnswers[0]).toMatchObject({ status: 'accepted', serverVersion: 2 });
      expect(skyAnswers[1]).toEqual(heldOnly(skys[1]!));
      // Without patients.view_sensitive, the entry of a sensitive diagnosis.
      const dees = [
        await set(dee, n, `dx.${E1}.note`, 'Demo: something else'),
        await set(dee, n, `dx.${E2}.note`, 'Demo: rest and fluids', 0),
      ];
      const deeAnswers = await dee.send(...dees);
      expect(deeAnswers[0]).toEqual(heldOnly(dees[0]!));
      expect(deeAnswers[1]).toMatchObject({ status: 'accepted', serverVersion: 1 });
      // ...and any answer of a note they may not read at all.
      const talk = await noteOn(ana, await visitOf(ana, patientId), TEST_SENSITIVE_TYPE, {
        'talk.notes': 'Demo: talked about sleep',
      });
      const onTalk = await set(dee, talk, 'talk.notes', 'Demo: something else');
      expect(await dee.send(onTalk)).toEqual([heldOnly(onTalk)]);
      // Whoever acts as the author sets every answer of their own note.
      const own = await set(ana, n, 'exam.findings', 'Demo: a small rash');
      expect((await ana.send(own))[0]).toMatchObject({ status: 'accepted', serverVersion: 2 });
      expect((await noteRow(n.noteId)).data).toMatchObject({
        'exam.findings': 'Demo: a small rash',
        'moud.dose': 'Demo: 12 mg',
        'meds.given': 'Demo: none today',
        'systems.seen': ['heart', 'gu'],
        [`dx.${E1}.note`]: 'Demo: talk again next week',
      });

      // An admin's accept is the approval: the held change applies as it was sent.
      const [item] = await h.scratch.owner<{ id: string }[]>`
        select id from sineobex.quarantine_items where change_id = ${bens[3]!.changeId}`;
      const decided = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'accept', reason: 'Demo: checked with Ben' },
      });
      expect(decided.status).toBe(200);
      expect((await noteRow(n.noteId)).data).toMatchObject({ 'meds.given': 'Demo: one tablet' });
    });

    it('an answer that does not count is hidden by where it is: beside a sensitive diagnosis, or a pick of a sensitive exam', async () => {
      const assess = {
        [`assess.diagnosis.code`]: 'F11.20',
        [`assess.diagnosis.label`]: 'Demo: opioid use',
        'assess.none': true,
        // Does not count while assess.none is ticked, in the section the diagnosis takes with it.
        'assess.detail': 'Demo: takes it daily under the bridge',
      };
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_ASSESS_TYPE, assess);
      expect(answerFields(await noteAs(dee, n))).toEqual([]);
      // Not seen, and so a conflict, a fill or a write into a section Dee may not see: held.
      const dees = [
        await set(dee, n, 'assess.detail', 'Demo: something else', 0),
        await set(dee, n, 'assess.detail', 'Demo: written blind'),
      ];
      expect(await dee.send(...dees)).toEqual(dees.map(heldOnly));
      expect((await noteRow(n.noteId)).data).toEqual(assess);
      // Ben may see the section: an answer that does not count there is the draft rule's, as before.
      const bens = await set(ben, n, 'assess.detail', 'Demo: from Ben', 0);
      expect((await ben.send(bens))[0]).toMatchObject({ status: 'conflict' });

      // A pick of a sensitive exam's option that does not count, beside a diagnosis that is not sensitive.
      const picked = await noteOn(ana, await visitOf(ana, patientId), TEST_ASSESS_TYPE, {
        [`assess.diagnosis.code`]: 'J02.9',
        'assess.none': true,
        'assess.seen': ['heart', 'gu'],
      });
      const onPicked = [
        await set(ben, picked, 'assess.seen', ['heart'], 0),
        await set(ben, picked, 'assess.seen', ['gu'], 0),
        await set(ben, picked, 'assess.detail', 'Demo: from Ben', 0),
      ];
      const answered = await ben.send(...onPicked);
      expect(answered.slice(0, 2)).toEqual(onPicked.slice(0, 2).map(heldOnly));
      expect(answered[2]).toMatchObject({ status: 'accepted', details: { notCounted: 'hidden_field' } });

      // A correction of the answer that does not count is missing for Dee, and her late change is held.
      await finishNote(
        ana,
        { ...n, answers: { ...assess, 'assess.detail': undefined } },
        'complete',
        'completed',
      );
      const correction = await ana.phone.change({
        entity: 'note_correction',
        op: 'create',
        value: {
          noteId: n.noteId,
          // The finish dropped the answer that did not count, at version 2.
          changes: [
            { field: 'data.assess.detail', newValue: 'Demo: uses daily under the bridge', baseVersion: 2 },
          ],
          reason: 'Demo: left out',
          requestedByPatient: false,
          declined: false,
          claimedCredential: null,
          signoffId: null,
        },
      });
      expect((await ana.send(correction))[0]!.details).toMatchObject({ outcome: 'corrected' });
      expect(await read(dee.token, [{ entity: 'note_correction', id: correction.recordId }])).toMatchObject({
        records: [],
        missing: [{ entity: 'note_correction', id: correction.recordId }],
      });
      expect(
        (await read(ben.token, [{ entity: 'note_correction', id: correction.recordId }])).records,
      ).toHaveLength(1);
      const late = await set(dee, n, 'assess.detail', 'Demo: later', 0);
      expect(await dee.send(late)).toEqual([heldOnly(late)]);
    });

    it('a removal of an entry hidden from the sender, and a write into a removed one that holds a sensitive diagnosis, are held', async () => {
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, {
        'general.notes': 'Demo: walked over from the shelter',
        [`dx.${E1}.entryAt`]: AT,
        [`dx.${E1}.diagnosis.code`]: 'F11.20',
        [`dx.${E2}.entryAt`]: AT,
        [`dx.${E2}.diagnosis.code`]: 'J02.9',
      });
      // Dee's phone still holds E1's ID from before its code became sensitive.
      const dees = [
        await set(dee, n, `dx.${E1}.entryRemoved`, true, 0),
        await set(dee, n, `dx.${E1}.note`, 'Demo: something else', 0),
        // An entry she may see is hers to remove.
        await set(dee, n, `dx.${E2}.entryRemoved`, true, 0),
      ];
      const answered = await dee.send(...dees);
      expect(answered.slice(0, 2)).toEqual(dees.slice(0, 2).map(heldOnly));
      expect(answered[2]).toMatchObject({ status: 'accepted', serverVersion: 1 });
      // Removed by its author, the entry still holds the diagnosis: nothing is written into it blind.
      const removal = await set(ana, n, `dx.${E1}.entryRemoved`, true, 0);
      expect((await ana.send(removal))[0]).toMatchObject({ status: 'accepted' });
      const into = await set(dee, n, `dx.${E1}.note`, 'Demo: written blind', 0);
      expect(await dee.send(into)).toEqual([heldOnly(into)]);
      // Ben, who may see the diagnosis, writes into the removed entry as the draft rule says.
      const bens = await set(ben, n, `dx.${E1}.note`, 'Demo: from Ben', 0);
      expect((await ben.send(bens))[0]).toMatchObject({
        status: 'accepted',
        details: { notCounted: 'removed_entry' },
      });
      expect((await noteRow(n.noteId)).data).toMatchObject({
        [`dx.${E1}.diagnosis.code`]: 'F11.20',
        [`dx.${E1}.entryRemoved`]: true,
        [`dx.${E1}.note`]: 'Demo: from Ben',
      });
    });

    it('a section that needs an ordering credential holds the author’s create, set and correction too, until an admin accepts', async () => {
      // Sky is a student: she charts, and orders nothing. A resident lowered offline is the same.
      const visit = await visitOf(sky, patientId);
      const create = await sky.phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: {
          encounterId: visit.encounterId,
          noteTypeKey: TEST_RESTRICTED_TYPE.key,
          noteTypeVersion: TEST_RESTRICTED_TYPE.version,
          data: { 'general.notes': 'Demo: walked over', 'meds.given': 'Demo: two tablets' },
        },
      });
      const own = await noteOn(sky, visit, TEST_RESTRICTED_TYPE, { 'general.notes': 'Demo: walked over' });
      const sets = [
        await set(sky, own, 'meds.given', 'Demo: one tablet', 0),
        await set(sky, own, 'general.notes', 'Demo: later'),
      ];
      const answered = await sky.send(create, ...sets);
      expect(answered.slice(0, 2)).toEqual([heldOnly(create), heldOnly(sets[0]!)]);
      expect(answered[2]).toMatchObject({ status: 'accepted', serverVersion: 2 });
      expect((await noteRow(own.noteId)).data).toEqual({ 'general.notes': 'Demo: later' });
      const made = await h.scratch
        .owner`select 1 from sineobex.encounter_notes where id = ${create.recordId}`;
      expect(made).toHaveLength(0);
      // A correction of a finished note's Medication section, by its author.
      const finished = await noteOn(ana, visit, TEST_RESTRICTED_TYPE, { 'meds.given': 'Demo: none today' });
      await finishNote(ana, finished, 'complete', 'completed');
      await setCredential(h, t, ana.membershipId, 'student');
      const correction = await ana.phone.change({
        entity: 'note_correction',
        op: 'create',
        value: {
          noteId: finished.noteId,
          changes: [{ field: 'data.meds.given', newValue: 'Demo: one tablet', baseVersion: 1 }],
          reason: 'Demo: the wrong amount',
          requestedByPatient: false,
          declined: false,
          claimedCredential: 'student',
          signoffId: null,
        },
      });
      try {
        expect(await ana.send(correction)).toEqual([heldOnly(correction)]);
      } finally {
        await setCredential(h, t, ana.membershipId, 'attending');
      }
      // An attending orders: the author's own set goes through.
      const anas = await set(ana, finished, 'general.notes', 'Demo: later');
      expect((await ana.send(anas))[0]).toMatchObject({ status: 'accepted' });
      // The admin's accept applies the held set as it was sent.
      const [item] = await h.scratch.owner<{ id: string }[]>`
        select id from sineobex.quarantine_items where change_id = ${sets[0]!.changeId}`;
      const decided = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'accept', reason: 'Demo: checked with Sky' },
      });
      expect(decided.status).toBe(200);
      expect((await noteRow(own.noteId)).data).toMatchObject({ 'meds.given': 'Demo: one tablet' });
    });

    it('whoever acts as the author once a note is assigned reads and sets its hidden answers; the first author no longer does', async () => {
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, ANSWERS);
      expect(answerFields(await noteAs(ana, n))).toEqual(ALL);
      expect(answerFields(await noteAs(ben, n))).toEqual(without('exam', 'moud'));
      // Assigned by an admin once Ana has left (3.8): Ben acts as the author now (review finding RD-9).
      await h.scratch
        .owner`update sineobex.encounter_notes set assigned_user_id = ${ben.id} where id = ${n.noteId}`;
      expect(answerFields(await noteAs(ben, n))).toEqual(ALL);
      expect(answerFields(await noteAs(ana, n))).toEqual(without('exam'));
      const bens = await set(ben, n, 'exam.findings', 'Demo: a small rash');
      const anas = await set(ana, n, 'exam.findings', 'Demo: something else', 2);
      expect((await ben.send(bens))[0]).toMatchObject({ status: 'accepted', serverVersion: 2 });
      expect(await ana.send(anas)).toEqual([heldOnly(anas)]);
      expect((await noteRow(n.noteId)).data).toMatchObject({ 'exam.findings': 'Demo: a small rash' });
    });

    it('any change of a note the sender may not read at all is held, with nothing told of its state', async () => {
      const visit = await visitOf(ana, patientId);
      const talk = await noteOn(ana, visit, TEST_SENSITIVE_TYPE, {
        'talk.notes': 'Demo: talked about sleep',
      });
      await finishNote(ana, talk, 'complete', 'completed');
      // Dee holds the note's ID from before her role was lowered (review finding RD-11).
      const dees = [
        await signoffOf(dee, talk, 'complete'),
        await set(dee, talk, 'status', 'draft', 2),
        await dee.phone.change({
          entity: 'note_correction',
          op: 'create',
          value: {
            noteId: talk.noteId,
            changes: [{ field: 'data.talk.notes', newValue: 'Demo: a guess', baseVersion: 1 }],
            reason: 'Demo: the wrong field was picked',
            requestedByPatient: false,
            declined: false,
            claimedCredential: null,
            signoffId: null,
          },
        }),
        await dee.phone.change({
          entity: 'note_addendum',
          op: 'create',
          value: {
            encounterId: visit.encounterId,
            noteId: talk.noteId,
            text: 'Demo: called back',
            signoffId: null,
          },
        }),
      ];
      expect(await dee.send(...dees)).toEqual(dees.map(heldOnly));
      // Ben may read it: his are answered as before.
      const bens = [await set(ben, talk, 'status', 'draft', 2)];
      expect((await ben.send(...bens))[0]).toMatchObject({
        status: 'accepted',
        details: { outcome: 'history_only' },
      });
      expect((await noteRow(talk.noteId)).status).toBe('completed');
    });

    it('on a finished note too: held, where a late change would send back the answer it keeps', async () => {
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, ANSWERS);
      await finishNote(ana, n, 'complete', 'completed');
      const hidden = await set(ben, n, 'exam.findings', 'Demo: a small rash');
      const plain = await set(ben, n, 'general.notes', 'Demo: later');
      const [a, b] = await ben.send(hidden, plain);
      expect(a).toEqual(heldOnly(hidden));
      expect(b).toMatchObject({
        status: 'accepted',
        server: { value: ANSWERS['general.notes'] },
        details: { outcome: 'history_only', problem: 'note_finished' },
      });
    });
  });

  describe('a retry is answered from its receipt, as the sender may see the field now (4.4, 6.4 rule 2)', () => {
    const set = (c: Clinician, n: { noteId: string }, path: string, value: unknown, baseVersion = 1) =>
      c.phone.change({
        entity: 'encounter_note',
        recordId: n.noteId,
        op: 'set',
        field: `data.${path}`,
        value,
        baseVersion,
      });
    const nothing = { value: null, version: 0, changedBy: null, changedAt: null };

    it('a conflict whose answer was hidden since is sent with a field that holds nothing; one still shown is sent as it is', async () => {
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, {
        'general.notes': 'Demo: walked over from the shelter',
        'systems.seen': ['heart'],
        [`dx.${E2}.entryAt`]: AT,
        [`dx.${E2}.diagnosis.code`]: 'J02.9',
      });
      // Neither saw the answer held there, which they may see: a conflict that shows it.
      const bens = await set(ben, n, 'systems.seen', ['lungs'], 0);
      const dees = await set(dee, n, `dx.${E2}.diagnosis.code`, 'J03.9', 0);
      const plain = await set(ben, n, 'general.notes', 'Demo: from Ben', 0);
      const first = [...(await ben.send(bens, plain)), ...(await dee.send(dees))];
      expect(first.map((r) => [r.status, r.server?.value])).toEqual([
        ['conflict', ['heart']],
        ['conflict', 'Demo: walked over from the shelter'],
        ['conflict', 'J02.9'],
      ]);
      // The author charts a GU exam and a sensitive diagnosis; the answers never reached the phones.
      const anas = [
        await set(ana, n, 'systems.seen', ['heart', 'gu']),
        await set(ana, n, `dx.${E2}.diagnosis.code`, 'F11.20'),
        await set(ana, n, 'general.notes', 'Demo: walked over from the park'),
      ];
      expect((await ana.send(...anas)).map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
      const again = [...(await ben.send(bens, plain)), ...(await dee.send(dees))];
      expect(again[0]).toEqual({
        changeId: bens.changeId,
        status: 'conflict',
        serverVersion: 0,
        server: nothing,
      });
      expect(again[1]).toMatchObject({
        status: 'conflict',
        serverVersion: 2,
        server: { value: 'Demo: walked over from the park', version: 2, changedBy: ana.id },
      });
      expect(again[2]).toEqual({
        changeId: dees.changeId,
        status: 'conflict',
        serverVersion: 0,
        server: nothing,
      });
      // The author's own retry is answered with the field as it is.
      const own = await set(ana, n, 'systems.seen', ['lungs'], 0);
      expect((await ana.send(own))[0]).toMatchObject({
        status: 'conflict',
        server: { value: ['heart', 'gu'] },
      });
      expect((await ana.send(own))[0]).toMatchObject({
        status: 'conflict',
        server: { value: ['heart', 'gu'] },
      });
    });

    it('a late change kept in history is sent with a field that holds nothing once a correction hides it', async () => {
      const n = await noteOn(ana, await visitOf(ana, patientId), TEST_RESTRICTED_TYPE, {
        'general.notes': 'Demo: walked over from the shelter',
        'systems.seen': ['heart'],
      });
      await finishNote(ana, n, 'complete', 'completed');
      const late = await set(ben, n, 'systems.seen', ['lungs']);
      const [kept] = await ben.send(late);
      expect(kept).toMatchObject({
        status: 'accepted',
        server: { value: ['heart'] },
        details: { outcome: 'history_only', problem: 'note_finished' },
      });
      const correction = await ana.phone.change({
        entity: 'note_correction',
        op: 'create',
        value: {
          noteId: n.noteId,
          changes: [{ field: 'data.systems.seen', newValue: ['heart', 'gu'], baseVersion: 1 }],
          reason: 'Demo: the GU exam was left out',
          requestedByPatient: false,
          declined: false,
          claimedCredential: null,
          signoffId: null,
        },
      });
      expect((await ana.send(correction))[0]!.details).toMatchObject({ outcome: 'corrected' });
      expect((await ben.send(late))[0]).toEqual({ ...kept, server: nothing });
    });
  });

  describe('the review queue (lifecycle 6.4 rule 2)', () => {
    it('shows a held change’s value only to a reviewer who may read it; to anyone else, that it is held and nothing more', async () => {
      const role = async (name: string, permissions: string[]) => {
        const r = await call(h, '/v1/team/roles', {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { name, permissions },
        });
        expect(r.status).toBe(201);
        return r.body.key as string;
      };
      const charting = await role('Charting reviewer', [
        'patients.view',
        'encounters.chart',
        'quarantine.review',
      ]);
      const viewing = await role('Viewing reviewer', ['patients.view', 'quarantine.review']);
      const queueOnly = await role('Queue only', ['quarantine.review']);
      const cora = await clinician(h, t, 'cora@example.com', 'Cora (demo)', 'attending', charting);
      const rex = await clinician(h, t, 'rex@example.com', 'Rex (demo)', 'attending', viewing);
      const quinn = await clinician(h, t, 'quinn@example.com', 'Quinn (demo)', 'attending', queueOnly);
      const gus = await clinician(h, t, 'gus@example.com', 'Gus (demo)', 'none');
      const cal = await clinician(h, t, 'cal@example.com', 'Cal (demo)', 'chw', 'community_health_worker');
      const visit = await visitOf(ana, patientId);
      const n = await noteOn(ana, visit, TEST_RESTRICTED_TYPE, ANSWERS);
      const medical = await noteOn(ana, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: fluids' });
      const change = (note: { noteId: string }, path: string, value: unknown) =>
        gus.phone.change({
          entity: 'encounter_note',
          recordId: note.noteId,
          op: 'set',
          field: `data.${path}`,
          value,
          baseVersion: 1,
        });
      // Held by the sensitive set check, and by the Medical gate (Gus charts no Medical note).
      const sent = [
        await change(n, 'exam.findings', 'Demo: a small rash, GU'),
        await change(medical, 'care.plan', 'Demo: rest'),
      ];
      expect((await gus.send(...sent)).map((r) => r.reason)).toEqual(['permission', 'permission']);

      // Held for the role's key: a community health worker charts no note.
      const plain = await cal.phone.change({
        entity: 'encounter_note',
        recordId: n.noteId,
        op: 'set',
        field: 'data.general.notes',
        value: 'Demo: from Cal',
        baseVersion: 1,
      });
      expect((await cal.send(plain)).map((r) => r.reason)).toEqual(['permission']);
      const notes = { changeId: plain.changeId, entity: 'encounter_note' };
      const shownNotes = { ...notes, field: 'data.general.notes', value: 'Demo: from Cal', hidden: false };
      const queueOf = async (c: { token: string }, of: { id: string }) => {
        const r = await call(h, `/v1/team/quarantine?userId=${of.id}`, { token: c.token, teamId: t.teamId });
        expect(r.status).toBe(200);
        return (r.body.items as Record<string, unknown>[]).map((i) => ({
          changeId: i.changeId,
          entity: i.entity,
          field: i.field,
          value: i.value,
          hidden: i.hidden ?? false,
        }));
      };
      const queue = async (c: { token: string }) => {
        const r = await call(h, `/v1/team/quarantine?userId=${gus.id}`, { token: c.token, teamId: t.teamId });
        expect(r.status).toBe(200);
        return (r.body.items as Record<string, unknown>[]).map((i) => ({
          changeId: i.changeId,
          entity: i.entity,
          field: i.field,
          value: i.value,
          hidden: i.hidden ?? false,
        }));
      };
      const exam = { changeId: sent[0]!.changeId, entity: 'encounter_note' };
      const plan = { changeId: sent[1]!.changeId, entity: 'encounter_note' };
      const shownExam = {
        ...exam,
        field: 'data.exam.findings',
        value: 'Demo: a small rash, GU',
        hidden: false,
      };
      const shownPlan = { ...plan, field: 'data.care.plan', value: 'Demo: rest', hidden: false };
      const held = (c: { changeId: string; entity: string }) => ({
        ...c,
        field: null,
        value: null,
        hidden: true,
      });
      expect(await queue(admin())).toEqual([shownExam, shownPlan]);
      // An attending without patients.view_sensitive_exams reads the Medical note, not the exam.
      expect(await queue(cora)).toEqual([held(exam), shownPlan]);
      // A visit's records need encounters.chart, as the sync read does; the queue alone shows nothing.
      expect(await queue(rex)).toEqual([held(exam), held(plan)]);
      expect(await queue(quinn)).toEqual([held(exam), held(plan)]);
      // A note Rex could read but for encounters.chart.
      expect(await queueOf(admin(), cal)).toEqual([shownNotes]);
      expect(await queueOf(cora, cal)).toEqual([shownNotes]);
      expect(await queueOf(rex, cal)).toEqual([held(notes)]);

      // A whole note's create, a sign-off, and a problem with a sensitive code and one without.
      // Held for the role's key: a community health worker charts no note and no problem.
      const kit = await clinician(h, t, 'kit@example.com', 'Kit (demo)', 'chw', 'community_health_worker');
      const create = await kit.phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: {
          encounterId: visit.encounterId,
          noteTypeKey: TEST_RESTRICTED_TYPE.key,
          noteTypeVersion: TEST_RESTRICTED_TYPE.version,
          data: { 'general.notes': 'Demo: walked over', 'systems.seen': ['heart', 'gu'] },
        },
      });
      const signoff = await signoffOf(
        kit,
        { ...medical, answers: { 'care.plan': 'Demo: fluids' } },
        'complete',
      );
      const problems = ['F11.20', 'J02.9'].map((code) =>
        kit.phone.change({
          entity: 'problem',
          op: 'create',
          value: { patientId, title: 'Demo problem', status: 'new', code: { system: 'icd10cm', code } },
        }),
      );
      const kits = [await create, signoff, ...(await Promise.all(problems))];
      expect((await kit.send(...kits)).map((r) => r.reason)).toEqual(kits.map(() => 'permission'));
      const values = async (c: { token: string }) =>
        (await queueOf(c, kit)).map((i) => (i.hidden ? null : i.value));
      const [noteValue, signoffValue, sensitiveProblem, plainProblem] = kits.map((c) => c.value);
      const { contentHash: _, ...unhashed } = signoffValue as Record<string, unknown>;
      // The admin reads all of it, but no clinical credential: no sign-off's hash.
      expect(await values(admin())).toEqual([noteValue, unhashed, sensitiveProblem, plainProblem]);
      // Cora sees no GU exam and no sensitive diagnosis.
      expect(await values(cora)).toEqual([null, unhashed, null, plainProblem]);
      // Rex reads no note and no problem list.
      expect(await values(rex)).toEqual([null, null, null, null]);
      expect(JSON.stringify(await queue(quinn))).not.toMatch(/exam|rash|care|rest/);
    });
  });

  describe('the Medical gate (lifecycle 4.2; 4.9 rule 12)', () => {
    it('holds every kind of change to a Medical note from a credential lowered offline; an addendum changes no note and is taken', async () => {
      const kay = await clinician(h, t, 'kay@example.com', 'Kay (demo)', 'attending');
      const visit = await visitOf(kay, patientId);
      const flags = await noteOn(kay, visit, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
      await finishNote(kay, flags, 'sign', 'signed');
      const draft = await noteOn(kay, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: fluids' });
      const completed = await noteOn(kay, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: rest' });
      await finishNote(kay, completed, 'complete', 'completed');
      const signed = await noteOn(kay, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: sleep' });
      await finishNote(kay, signed, 'sign', 'signed');

      // Made offline, before the credential went down; sent after.
      const created = await kay.phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: {
          encounterId: visit.encounterId,
          noteTypeKey: TEST_MEDICAL_TYPE.key,
          noteTypeVersion: TEST_MEDICAL_TYPE.version,
        },
      });
      const answer = await kay.phone.change({
        entity: 'encounter_note',
        recordId: draft.noteId,
        op: 'set',
        field: 'data.care.plan',
        value: 'Demo: fluids and rest',
        baseVersion: 1,
      });
      const reopen = await kay.phone.change({
        entity: 'encounter_note',
        recordId: completed.noteId,
        op: 'set',
        field: 'status',
        value: 'draft',
        baseVersion: 2,
      });
      const signoff = await signoffOf(kay, draft, 'sign');
      const correction = await kay.phone.change({
        entity: 'note_correction',
        op: 'create',
        value: {
          noteId: signed.noteId,
          changes: [{ field: 'data.care.plan', newValue: 'Demo: sleep and food', baseVersion: 1 }],
          reason: 'Demo: left out',
          requestedByPatient: false,
          declined: false,
          claimedCredential: 'attending',
          signoffId: null,
        },
      });
      const addendum = await kay.phone.change({
        entity: 'note_addendum',
        op: 'create',
        value: {
          encounterId: visit.encounterId,
          noteId: signed.noteId,
          text: 'Demo: called back',
          signoffId: null,
        },
      });
      await setCredential(h, t, kay.membershipId, 'chw');
      const gated = [created, answer, reopen, signoff, correction];
      const answers = await kay.send(...gated, addendum);
      expect(answers.slice(0, 5)).toEqual(gated.map(() => expect.objectContaining(held)));
      expect(answers[5]).toMatchObject({ status: 'accepted', serverVersion: 1 });

      // Nothing of the held changes reached the chart.
      expect((await noteRow(draft.noteId)).data).toEqual({ 'care.plan': 'Demo: fluids' });
      expect((await noteRow(completed.noteId)).status).toBe('completed');
      expect((await noteRow(signed.noteId)).data).toEqual({ 'care.plan': 'Demo: sleep' });
      const stored = await h.scratch.owner<{ n: number }[]>`
        select (select count(*) from sineobex.encounter_notes where id = ${created.recordId})
             + (select count(*) from sineobex.note_signoffs where id = ${signoff.recordId})
             + (select count(*) from sineobex.note_corrections where id = ${correction.recordId}) as n`;
      expect(Number(stored[0]!.n)).toBe(0);
      const items = await h.scratch.owner<{ changeId: string; reason: string }[]>`
        select change_id as "changeId", reason from sineobex.quarantine_items
        where user_id = ${kay.id} order by received_at, id`;
      expect(items).toEqual(gated.map((c) => ({ changeId: c.changeId, reason: 'permission' })));
    });

    it('a sign-off, a reopen or a correction from someone who does not act as the author is stored with no effect, whatever their credential', async () => {
      // 4.1's second table: not_author answers before the gate, for all three alike (RD-8). Jo
      // charts Medical notes but not this one, and was lowered to a CHW while the phone was offline.
      const kay = await clinician(h, t, 'kay2@example.com', 'Kay (demo)', 'attending');
      const jo = await clinician(h, t, 'jo@example.com', 'Jo (demo)', 'attending');
      const visit = await visitOf(kay, patientId);
      const flags = await noteOn(kay, visit, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
      await finishNote(kay, flags, 'sign', 'signed');
      const draft = await noteOn(kay, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: fluids' });
      const completed = await noteOn(kay, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: rest' });
      await finishNote(kay, completed, 'complete', 'completed');
      const signed = await noteOn(kay, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: sleep' });
      await finishNote(kay, signed, 'sign', 'signed');

      const signoff = await signoffOf(jo, draft, 'sign');
      const reopen = await jo.phone.change({
        entity: 'encounter_note',
        recordId: completed.noteId,
        op: 'set',
        field: 'status',
        value: 'draft',
        baseVersion: 2,
      });
      const correction = await jo.phone.change({
        entity: 'note_correction',
        op: 'create',
        value: {
          noteId: signed.noteId,
          changes: [{ field: 'data.care.plan', newValue: 'Demo: sleep and food', baseVersion: 1 }],
          reason: 'Demo: left out',
          requestedByPatient: false,
          declined: false,
          claimedCredential: 'attending',
          signoffId: null,
        },
      });
      await setCredential(h, t, jo.membershipId, 'chw');
      const answers = await jo.send(signoff, reopen, correction);
      expect(answers.map((r) => [r.status, r.reason ?? null, r.details ?? null])).toEqual([
        [
          'accepted',
          null,
          { effect: 'none', reason: 'not_author', status: 'draft', attestation: 'not_needed' },
        ],
        ['accepted', null, { outcome: 'history_only', problem: 'not_author' }],
        ['accepted', null, { outcome: 'not_author', status: 'signed', attestation: 'not_needed' }],
      ]);
      const items = await h.scratch.owner`select 1 from sineobex.quarantine_items where user_id = ${jo.id}`;
      expect(items).toEqual([]);
      expect((await noteRow(draft.noteId)).status).toBe('draft');
      expect((await noteRow(completed.noteId)).status).toBe('completed');
      expect((await noteRow(signed.noteId)).data).toEqual({ 'care.plan': 'Demo: sleep' });
    });
  });
});
