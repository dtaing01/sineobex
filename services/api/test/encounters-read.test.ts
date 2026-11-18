import { randomUUID } from 'node:crypto';
import { readModel, visibleAnswers, type ResolvedNoteType } from '@sineobex/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Credential, Permission } from '../src/auth/permissions.ts';
import { noteReader } from '../src/sync/records.ts';
import {
  attestDirect,
  correct,
  createWorld,
  eventsAfter,
  expectNoneOf,
  finish,
  get,
  heldHashOf,
  PLAN,
  SECRETS,
  TEST_MEDICAL_EXAM_TYPE,
  TEST_MEDICAL_TYPE,
  TEST_NOTE_TYPE,
  visitAt,
  WITH_EXAM,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import {
  call,
  noteOn,
  secondTeam,
  TEST_RED_FLAGS_TYPE,
  TEST_SENSITIVE_TYPE,
  type Change,
  type HeldNote,
  type Json,
} from './sync-fixtures.ts';

// GET /v1/encounters/{encounterId} (lifecycle 5.1): the visit as the reader may see it, built on
// the sync read's rules (6.4, D86): a note the reader may not see is absent with everything that
// hangs off it; a note's answers, its read model and its corrections are what visibleAnswers keeps;
// a sign-off's hash goes only to whoever acts as the author, its signer and a reader who sees every
// answer of any note. One audit event per record returned, as the sync read writes. Every person
// and value is made up.

interface Note {
  noteId: string;
  noteTypeKey: string;
  noteTypeVersion: number;
  status: string;
  attestation: string;
  author: { userId: string; displayName: string };
  actingAuthor: { userId: string; displayName: string };
  read: ReturnType<typeof readModel>;
  signoffs: ({ id: string; contentHash?: string } & Record<string, unknown>)[];
  addenda: { id: string }[];
  corrections: { id: string }[];
  attestations: { id: string }[];
  contentHash?: string;
}
interface VisitRead {
  encounterId: string;
  patientId: string | null;
  kind: string;
  status: string;
  startedAt: string;
  clockVerified: boolean;
  locationText: string | null;
  summary?: string | null;
  addenda: { id: string }[];
  notes: Note[];
  records: { entity: string; id: string; attributes: Record<string, unknown> }[];
}

const E1 = 'e0000001';
const E2 = 'e0000002';
const AT = '2026-10-20T14:50:00Z';

/** An exam note with each kind of content 6.4 hides from someone. */
const EXAM_ANSWERS: Record<string, unknown> = {
  ...WITH_EXAM,
  'moud.dose': 'Demo: 8 mg',
  'systems.seen': ['heart', 'gu'],
  [`dx.${E1}.entryAt`]: AT,
  [`dx.${E1}.diagnosis.code`]: 'F11.20',
  [`dx.${E1}.diagnosis.label`]: 'Demo: opioid use',
  [`dx.${E2}.entryAt`]: AT,
  [`dx.${E2}.diagnosis.code`]: 'J02.9',
  [`dx.${E2}.diagnosis.label`]: 'Demo: sore throat',
};
const SUMMARY = 'Demo: seen at the shelter, plan agreed';

describe('phase 4: read a visit online', () => {
  let h: Harness;
  let w: World;
  let visit: { encounterId: string; patientId: string; summary: string };
  let ownAddendum: Change;
  let noteAddendum: Change;
  let flags: HeldNote;
  let plain: HeldNote;
  let exam: HeldNote;
  let talk: HeldNote;
  let social: HeldNote;
  let signoffs: Change[];
  let plainFix: Change;
  let examFix: Change;
  let attestationId: string;
  /** The stored answers of each note after the corrections. */
  const answersOf = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
    const { rae, sol } = w;
    const v = await visitAt(rae, w.patientId);
    const summary = await rae.phone.change({
      entity: 'encounter',
      recordId: v.encounterId,
      op: 'set',
      field: 'summary',
      value: SUMMARY,
      baseVersion: 0,
    });
    ownAddendum = await rae.phone.change({
      entity: 'note_addendum',
      op: 'create',
      value: {
        encounterId: v.encounterId,
        noteId: null,
        text: 'Demo: called the clinic back',
        signoffId: null,
      },
    });
    expect((await rae.send(summary, ownAddendum)).map((r) => r.status)).toEqual(['accepted', 'accepted']);
    visit = { encounterId: v.encounterId, patientId: w.patientId, summary: SUMMARY };
    flags = await noteOn(rae, visit, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
    plain = await noteOn(rae, visit, TEST_MEDICAL_TYPE, PLAN);
    exam = await noteOn(rae, visit, TEST_MEDICAL_EXAM_TYPE, EXAM_ANSWERS);
    talk = await noteOn(rae, visit, TEST_SENSITIVE_TYPE, { 'talk.notes': 'Demo: talked about sleep' });
    social = await noteOn(sol, visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: housing list' });
    signoffs = await finish(
      rae,
      [flags, 'sign', 'signed'],
      [plain, 'sign', 'signed'],
      [exam, 'sign', 'signed'],
      [talk, 'complete', 'completed'],
    );
    signoffs.push(...(await finish(sol, [social, 'complete', 'completed'])));
    noteAddendum = await rae.phone.change({
      entity: 'note_addendum',
      op: 'create',
      value: {
        encounterId: v.encounterId,
        noteId: plain.noteId,
        text: 'Demo: the swab came back',
        signoffId: null,
      },
    });
    expect((await rae.send(noteAddendum)).map((r) => r.status)).toEqual(['accepted']);
    // One correction every reader of the note may see, one that takes a sensitive exam's pick away.
    const fixedPlan = await correct(rae, plain, h, 'care.plan', 'Demo: rest, fluids and a follow-up');
    plainFix = fixedPlan.change;
    plain = fixedPlan.note;
    const fixedExam = await correct(rae, exam, h, 'systems.seen', ['heart']);
    examFix = fixedExam.change;
    exam = fixedExam.note;
    attestationId = await attestDirect(h, w.t.teamId, plain.noteId, w.ana);
    for (const n of [flags, plain, exam, talk, social]) answersOf.set(n.noteId, n.answers);
  });
  afterAll(() => h.close());

  const readAs = async (token: string, encounterId = visit.encounterId) => {
    const r = await get(w, token, `/v1/encounters/${encounterId}`);
    return { status: r.status, body: r.body as unknown as VisitRead & Json };
  };
  const ids = (xs: { id?: string; noteId?: string }[]) => xs.map((x) => (x.id ?? x.noteId)!).sort();
  const noteIn = (r: VisitRead, n: { noteId: string }) => r.notes.find((x) => x.noteId === n.noteId);

  /** A person as visibleAnswers reads them: their role's keys and their credential now. */
  async function readerOf(userId: string, actsAsAuthor = false) {
    const [row] = await h.scratch.owner<{ permissions: string[]; credential: Credential }[]>`
      select r.permissions, m.credential from sineobex.team_memberships m join sineobex.roles r on r.id = m.role_id
      where m.team_id = ${w.t.teamId} and m.user_id = ${userId}`;
    return noteReader(new Set(row!.permissions as Permission[]), row!.credential, actsAsAuthor);
  }
  /** The read model of a note with no correction shown, as [userId] may see it. */
  async function readFor(userId: string, n: HeldNote, type: ResolvedNoteType) {
    const seen = visibleAnswers(type, answersOf.get(n.noteId)!, await readerOf(userId));
    return readModel(type, seen!, []);
  }

  it('needs patients.view: a role without it is refused, and the refusal is logged', async () => {
    const mark = await auditMark(h);
    const r = await readAs(w.eli.token);
    expect(r.status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
    expect(denied!.details).toMatchObject({ permission: 'patients.view' });
    expect((await eventsAfter(h, mark)).map((e) => e.action)).toEqual(['access.denied']);
  });

  it('a visit the team does not have is 404, and nothing is logged as read', async () => {
    const other = await secondTeam(h);
    const create = await other.phone.change({
      entity: 'encounter',
      op: 'create',
      value: { kind: 'non_medical' },
    });
    const pushed = await h.request('/v1/sync/push', {
      method: 'POST',
      token: other.token,
      teamId: other.teamId,
      json: {
        deviceId: other.phone.deviceId,
        clock: { deviceTime: h.clock.now.toISOString() },
        unsynced: { counts: { encounters: 1 } },
        changes: [create],
      },
    });
    expect(pushed.status).toBe(200);
    const mark = await auditMark(h);
    expect((await readAs(w.vic.token, create.recordId)).status).toBe(404);
    expect((await readAs(w.vic.token, randomUUID())).status).toBe(404);
    expect((await eventsAfter(h, mark)).filter((e) => e.action.endsWith('.viewed'))).toEqual([]);
  });

  it('the envelope, the visit’s own addenda, and every note with what hangs off it, to a reader who sees every answer', async () => {
    const r = await readAs(w.vic.token);
    expect(r.status).toBe(200);
    const [row] = await h.scratch.owner<{ startedAt: Date; status: string }[]>`
      select started_at as "startedAt", status from sineobex.encounters where id = ${visit.encounterId}`;
    expect(r.body).toMatchObject({
      encounterId: visit.encounterId,
      patientId: w.patientId,
      kind: 'medical',
      status: row!.status,
      startedAt: row!.startedAt.toISOString(),
      clockVerified: true,
      locationText: null,
      summary: SUMMARY,
    });
    expect(ids(r.body.addenda)).toEqual([ownAddendum.recordId]);
    expect(ids(r.body.notes)).toEqual(ids([flags, plain, exam, talk, social]));

    const p = noteIn(r.body, plain)!;
    expect(p).toMatchObject({
      noteTypeKey: TEST_MEDICAL_TYPE.key,
      noteTypeVersion: TEST_MEDICAL_TYPE.version,
      status: 'signed',
      attestation: 'attested',
      author: { userId: w.rae.id, displayName: w.rae.displayName },
      actingAuthor: { userId: w.rae.id, displayName: w.rae.displayName },
    });
    expect(ids(p.signoffs)).toEqual([signoffs[1]!.recordId]);
    expect(ids(p.addenda)).toEqual([noteAddendum.recordId]);
    expect(ids(p.corrections)).toEqual([plainFix.recordId]);
    expect(ids(p.attestations)).toEqual([attestationId]);
    // The corrected answer is laid out with its old value under it (forms 7.1).
    const item = p.read.sections
      .flatMap((s) => ('items' in s ? s.items : []))
      .find((i) => i.path === 'care.plan');
    expect(item).toMatchObject({
      value: 'Demo: rest, fluids and a follow-up',
      corrections: [{ path: 'care.plan', old: 'Demo: rest and fluids' }],
    });

    // Every answer of the exam note, and its correction.
    const e = noteIn(r.body, exam)!;
    expect(ids(e.corrections)).toEqual([examFix.recordId]);
    const paths = e.read.sections.flatMap((s) =>
      'items' in s ? s.items.map((i) => i.path) : s.entries.flatMap((x) => x.items.map((i) => i.path)),
    );
    expect(paths).toEqual(expect.arrayContaining(['exam.findings', 'moud.dose', 'systems.seen']));
    expect(e.read.sections.map((s) => s.id)).toContain('dx');

    // A reader who sees every answer of any note gets every hash.
    for (const n of r.body.notes) {
      expect(n.contentHash, n.noteTypeKey).toMatch(/^[0-9a-f]{64}$/);
      for (const s of n.signoffs) expect(s.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(p.contentHash).toBe(await heldHashOf(plain));
    expect(e.contentHash).toBe(await heldHashOf(exam));
  });

  it('a reader without the sensitive exam key: the exam note without its exam, its corrections that would tell, and its hash', async () => {
    // Ana is an attending in Healthcare Staff: patients.view_sensitive, no patients.view_sensitive_exams.
    const r = await readAs(w.ana.token);
    expect(r.status).toBe(200);
    expect(ids(r.body.notes)).toEqual(ids([flags, plain, exam, talk, social]));
    const e = noteIn(r.body, exam)!;
    expect(e.read).toEqual(await readFor(w.ana.id, exam, TEST_MEDICAL_EXAM_TYPE));
    expectNoneOf(e, ['Demo: no lesions seen', 'gu']);
    // The correction took gu away: its old value would show it.
    expect(e.corrections).toEqual([]);
    expect(e).not.toHaveProperty('contentHash');
    // A note she sees whole, and may co-sign or attest, carries the hash she would send.
    expect(noteIn(r.body, plain)!.contentHash).toBe(await heldHashOf(plain));
    expect(ids(noteIn(r.body, plain)!.corrections)).toEqual([plainFix.recordId]);
    // A sign-off's hash is asked of the reader, never of the note (D86): none, on any note.
    for (const n of r.body.notes) for (const s of n.signoffs) expect(s).not.toHaveProperty('contentHash');
    expect(ids(r.body.notes.flatMap((n) => n.signoffs))).toEqual(
      ids(signoffs.map((s) => ({ id: s.recordId }))),
    );
  });

  it('a reader of Medical notes with no sensitive key: no sensitive note type, no treatment record, no sensitive diagnosis, no hash', async () => {
    // Bea is Billing/Data: patients.view and billing.view_codes, no credential.
    const r = await readAs(w.bea.token);
    expect(r.status).toBe(200);
    expect(r.body.summary).toBe(SUMMARY);
    expect(ids(r.body.addenda)).toEqual([ownAddendum.recordId]);
    expect(ids(r.body.notes)).toEqual(ids([flags, plain, exam, social]));
    const e = noteIn(r.body, exam)!;
    expect(e.read).toEqual(await readFor(w.bea.id, exam, TEST_MEDICAL_EXAM_TYPE));
    expect(e.read.sections.map((s) => s.id)).not.toContain('moud');
    expectNoneOf(e, ['Demo: opioid use', 'F11.20', 'Demo: 8 mg', 'Demo: no lesions seen']);
    expect(noteIn(r.body, flags)!.read).toEqual(await readFor(w.bea.id, flags, TEST_RED_FLAGS_TYPE));
    // She signs nothing and attests nothing: no note's hash, no sign-off's.
    for (const n of r.body.notes) {
      expect(n).not.toHaveProperty('contentHash');
      for (const s of n.signoffs) expect(s).not.toHaveProperty('contentHash');
    }
    expectNoneOf(r.body, ['Demo: talked about sleep']);
  });

  it('a reader of no Medical note: the visit without its summary or its own addenda, and only the Non-Medical notes they may see', async () => {
    // Kim holds the CHW preset: patients.view, no encounters.chart, no billing.view_codes.
    const r = await readAs(w.kim.token);
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('summary');
    expect(r.body.addenda).toEqual([]);
    expect(ids(r.body.notes)).toEqual([social.noteId]);
    expect(noteIn(r.body, social)!.read).toEqual(await readFor(w.kim.id, social, TEST_NOTE_TYPE));
    expect(noteIn(r.body, social)).not.toHaveProperty('contentHash');
    expectNoneOf(r.body, [SUMMARY, 'Demo: called the clinic back', 'Demo: rest and fluids', 'Demo: swab']);
  });

  it('whoever acts as the author reads their notes whole, with every hash', async () => {
    const r = await readAs(w.rae.token);
    expect(r.status).toBe(200);
    const e = noteIn(r.body, exam)!;
    expect(e.contentHash).toBe(await heldHashOf(exam));
    expect(ids(e.corrections)).toEqual([examFix.recordId]);
    for (const n of [flags, plain, exam])
      for (const s of noteIn(r.body, n)!.signoffs) expect(s.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // A student signs nothing and attests nothing, but completes their own note with its hash.
    const student = await readAs(w.sol.token);
    expect(noteIn(student.body, social)!.contentHash).toBe(await heldHashOf(social));
    expect(noteIn(student.body, plain)).not.toHaveProperty('contentHash');
  });

  it('a note whose definition the server cannot read is absent for every reader', async () => {
    const v = await visitAt(w.ana, w.patientId);
    const stray = randomUUID();
    await h.scratch.owner`
      insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, note_type_version, author_user_id)
      values (${stray}, ${w.t.teamId}, ${v.encounterId}, 'test_note', 9, ${w.ana.id})`;
    for (const token of [w.vic.token, w.ana.token]) {
      const r = await readAs(token, v.encounterId);
      expect(r.status).toBe(200);
      expect(r.body.notes).toEqual([]);
    }
  });

  it('logs one event per record it returns, on the visit’s patient, with no answer in it', async () => {
    const mark = await auditMark(h);
    expect((await readAs(w.ana.token)).status).toBe(200);
    const events = await eventsAfter(h, mark);
    const line = (action: string, entity: string, id: string) => `${action} ${entity} ${id}`;
    expect(events.map((e) => line(e.action, e.entity!, e.entityId!)).sort()).toEqual(
      [
        line('encounter.viewed', 'encounter', visit.encounterId),
        ...[flags, plain, exam, talk, social].map((n) => line('note.viewed', 'encounter_note', n.noteId)),
        ...signoffs.map((s) => line('note.viewed', 'note_signoff', s.recordId)),
        line('note.viewed', 'note_addendum', ownAddendum.recordId),
        line('note.viewed', 'note_addendum', noteAddendum.recordId),
        // The exam's correction is not returned to her, so it is not logged.
        line('note.viewed', 'note_correction', plainFix.recordId),
        line('note.viewed', 'note_attestation', attestationId),
      ].sort(),
    );
    expect(events.every((e) => e.patientId === w.patientId)).toBe(true);
    await expectAuditClean(h, [...SECRETS, SUMMARY, 'Demo: housing list', 'Demo: the swab came back'], mark);

    // A reader shown less is logged for less.
    const kims = await auditMark(h);
    await readAs(w.kim.token);
    expect((await eventsAfter(h, kims)).map((e) => line(e.action, e.entity!, e.entityId!)).sort()).toEqual(
      [
        line('encounter.viewed', 'encounter', visit.encounterId),
        line('note.viewed', 'encounter_note', social.noteId),
        line('note.viewed', 'note_signoff', signoffs.at(-1)!.recordId),
      ].sort(),
    );
  });

  describe('the records made at the visit (lifecycle 9.7, D91)', () => {
    let at: { encounterId: string };
    let moved: { encounterId: string };
    let other: string;
    const made: Record<string, string> = {};

    beforeAll(async () => {
      const { ana } = w;
      at = await visitAt(ana, w.patientId, { kind: 'non_medical' });
      const send = async (...changes: Change[]) =>
        expect((await ana.send(...changes)).map((r) => r.status)).toEqual(changes.map(() => 'accepted'));
      const change = (entity: Change['entity'], value: Record<string, unknown>) =>
        ana.phone.change({ entity, op: 'create', value });
      const referral = await change('referral', {
        patientId: w.patientId,
        referredOn: '2026-10-20',
        details: 'Demo: dental clinic on Main St',
        encounterId: at.encounterId,
      });
      const allergy = await change('patient_allergy', {
        patientId: w.patientId,
        substance: 'Demo: latex',
        encounterId: at.encounterId,
      });
      const problem = await change('problem', {
        patientId: w.patientId,
        title: 'Demo: cough',
        status: 'new',
        encounterId: at.encounterId,
      });
      const hidden = await change('problem', {
        patientId: w.patientId,
        title: 'Demo: opioid use',
        code: { system: 'icd10cm', code: 'F11.20' },
        status: 'new',
        encounterId: at.encounterId,
      });
      await send(referral, allergy, problem, hidden);
      const problemNote = await change('problem_note', {
        problemId: problem.recordId,
        text: 'Demo: better today',
        encounterId: at.encounterId,
      });
      const hiddenNote = await change('problem_note', {
        problemId: hidden.recordId,
        text: 'Demo: started treatment',
        encounterId: at.encounterId,
      });
      await send(problemNote, hiddenNote);
      Object.assign(made, {
        hiddenNote: hiddenNote.recordId,
        referral: referral.recordId,
        allergy: allergy.recordId,
        problem: problem.recordId,
        hidden: hidden.recordId,
        problemNote: problemNote.recordId,
      });

      // A visit moved to another patient leaves its referral with the first (12.1 #25).
      other = (await createPatient(h, w.t.teamId, w.t.adminId, { preferredName: 'Demo Wren' })).id;
      moved = await visitAt(ana, w.patientId, { kind: 'non_medical' });
      const left = await change('referral', {
        patientId: w.patientId,
        referredOn: '2026-10-21',
        details: 'Demo: eye clinic',
        encounterId: moved.encounterId,
      });
      await send(left);
      made.left = left.recordId;
      await send(
        await ana.phone.change({
          entity: 'encounter',
          recordId: moved.encounterId,
          op: 'set',
          field: 'patientId',
          value: other,
          baseVersion: 1,
        }),
      );
    });

    const byEntity = (r: VisitRead) => r.records.map((x) => `${x.entity} ${x.id}`).sort();
    const line = (entity: string, id: string) => `${entity} ${id}`;

    it('lists them, whichever chart they are on, as the chart would show them to the reader', async () => {
      const all = [
        line('referral', made.referral!),
        line('patient_allergy', made.allergy!),
        line('problem', made.problem!),
        line('problem', made.hidden!),
        line('problem_note', made.problemNote!),
        line('problem_note', made.hiddenNote!),
      ].sort();
      const ana = await readAs(w.ana.token, at.encounterId);
      expect(ana.status).toBe(200);
      expect(byEntity(ana.body)).toEqual(all);
      expect(ana.body.records.find((x) => x.id === made.referral)!.attributes).toMatchObject({
        patientId: w.patientId,
        encounterId: at.encounterId,
      });
      // Billing/Data reads problems but no sensitive one; the CHW preset reads no problem at all.
      const bea = await readAs(w.bea.token, at.encounterId);
      expect(byEntity(bea.body)).toEqual(
        all.filter(
          (x) => x !== line('problem', made.hidden!) && x !== line('problem_note', made.hiddenNote!),
        ),
      );
      expectNoneOf(bea.body, ['Demo: opioid use', 'F11.20', 'Demo: started treatment']);
      const kim = await readAs(w.kim.token, at.encounterId);
      expect(byEntity(kim.body)).toEqual(
        [line('referral', made.referral!), line('patient_allergy', made.allergy!)].sort(),
      );
      expectNoneOf(kim.body, ['Demo: cough', 'Demo: better today']);

      // The moved visit is on the other patient now; its referral stays on the first chart.
      const left = await readAs(w.ana.token, moved.encounterId);
      expect(left.body.patientId).toBe(other);
      expect(byEntity(left.body)).toEqual([line('referral', made.left!)]);
    });

    it('logs each one shown as a read of its patient’s record', async () => {
      const mark = await auditMark(h);
      await readAs(w.kim.token, moved.encounterId);
      const events = await eventsAfter(h, mark);
      expect(events.map((e) => [e.action, e.entity, e.entityId, e.patientId])).toEqual(
        expect.arrayContaining([
          ['encounter.viewed', 'encounter', moved.encounterId, other],
          ['patient.viewed', 'referral', made.left, w.patientId],
        ]),
      );
      expect(events).toHaveLength(2);
      await expectAuditClean(h, ['Demo: eye clinic'], mark);
    });
  });

  it('shows of each note, and of what hangs off it, exactly what the sync read gives the same reader', async () => {
    const sql = h.scratch.owner;
    const refs = [
      ...(
        await sql<
          { id: string }[]
        >`select id from sineobex.encounter_notes where encounter_id = ${visit.encounterId}`
      ).map((r) => ({ entity: 'encounter_note', id: r.id })),
      ...(
        await sql<{ id: string }[]>`
          select s.id from sineobex.note_signoffs s join sineobex.encounter_notes n on n.id = s.note_id
          where n.encounter_id = ${visit.encounterId}`
      ).map((r) => ({ entity: 'note_signoff', id: r.id })),
      ...(
        await sql<
          { id: string }[]
        >`select id from sineobex.note_addenda where encounter_id = ${visit.encounterId}`
      ).map((r) => ({ entity: 'note_addendum', id: r.id })),
      ...(
        await sql<{ id: string }[]>`
          select c.id from sineobex.note_corrections c join sineobex.encounter_notes n on n.id = c.note_id
          where n.encounter_id = ${visit.encounterId}`
      ).map((r) => ({ entity: 'note_correction', id: r.id })),
    ];
    // The sync read needs encounters.chart: every reader here holds it.
    for (const reader of [w.vic, w.ana, w.rae, w.sol, w.nia]) {
      const synced = await call(h, '/v1/sync/records', {
        method: 'POST',
        token: reader.token,
        teamId: w.t.teamId,
        json: { records: refs },
      });
      expect(synced.status).toBe(200);
      const fromSync = (synced.body.records as { entity: string; id: string; attributes: Json }[]).map(
        (r) =>
          `${r.entity} ${r.id}${r.entity === 'note_signoff' && 'contentHash' in r.attributes ? ' hash' : ''}`,
      );
      const read = (await readAs(reader.token)).body;
      const fromRead = [
        ...read.addenda.map((a) => `note_addendum ${a.id}`),
        ...read.notes.flatMap((n) => [
          `encounter_note ${n.noteId}`,
          ...n.signoffs.map((s) => `note_signoff ${s.id}${'contentHash' in s ? ' hash' : ''}`),
          ...n.addenda.map((a) => `note_addendum ${a.id}`),
          ...n.corrections.map((c) => `note_correction ${c.id}`),
        ]),
      ];
      expect(fromRead.sort(), reader.displayName).toEqual(fromSync.sort());
    }
  });
});
