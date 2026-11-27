import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorld,
  finish,
  noteRow,
  noticesOf,
  roleWith,
  TEST_MEDICAL_EXAM_TYPE,
  TEST_MEDICAL_TYPE,
  visitAt,
  WITH_EXAM,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark } from './patient-fixtures.ts';
import { call, clinician, createProblem, noteOn, setRole, TEST_RED_FLAGS_TYPE } from './sync-fixtures.ts';

/**
 * A value the server sends back to a phone is a read (the coordinator's decisions on review
 * findings PA-1, PA-4, PP-4, VA-1 and VS-1): what a conflict, a value kept in history and a retry
 * carry follows the sync read's rules, all of them, and is logged on the record's patient in the
 * push's transaction; a change the sender could only answer blind is held for review instead.
 */
describe('a value sent back to a phone', () => {
  let h: Harness;
  let w: World;
  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
  });
  afterAll(() => h.close());

  const events = async (after: string) =>
    h.scratch.owner<
      { action: string; patientId: string | null; entity: string | null; details: Record<string, unknown> }[]
    >`
      select action, patient_id as "patientId", entity, details from sineobex.audit_events where id > ${after}::bigint order by id`;

  const NOTHING = { value: null, version: 0, changedBy: null, changedAt: null };
  const held = { status: 'rejected', reason: 'permission', quarantined: true };
  const heldItem = async (changeId: string) =>
    (
      await h.scratch.owner<{ id: string; status: string }[]>`
        select id, status from sineobex.quarantine_items where change_id = ${changeId}`
    )[0];
  /** The team's Program Admin decides on a held change. */
  const decide = async (changeId: string, decision: 'accept' | 'reject', reason: string) =>
    call(h, `/v1/team/quarantine/${(await heldItem(changeId))!.id}/decision`, {
      method: 'POST',
      token: w.t.adminToken,
      teamId: w.t.teamId,
      json: { decision, reason },
    });
  const historyOf = (recordId: string, field: string) =>
    h.scratch.owner<
      { value: unknown; version: number; kind: string; changedBy: string; approvedBy: string | null }[]
    >`
      select value, version, kind, changed_by as "changedBy", approved_by as "approvedBy"
      from sineobex.field_history where record_id = ${recordId} and field = ${field} order by id`;
  const receiptOf = async (changeId: string) =>
    (
      await h.scratch.owner<{ status: string; details: Record<string, unknown> | null }[]>`
        select status, details from sineobex.sync_changes where change_id = ${changeId}`
    )[0];

  describe('a Medical visit’s summary (PA-4, VS-1)', () => {
    const summarySet = (
      c: World['eli'],
      encounterId: string,
      value: string | null,
      baseVersion: number,
      extra: { conflictOf?: string; resolution?: 'replace' | 'keep_server' } = {},
    ) =>
      c.phone.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field: 'summary',
        value,
        baseVersion,
        ...extra,
      });
    const summaryOf = async (encounterId: string) =>
      (
        await h.scratch.owner<{ summary: string | null }[]>`
          select summary from sineobex.encounters where id = ${encounterId}`
      )[0]!.summary;

    it('is held for review from a sender the sync read withholds it from, whatever version it names', async () => {
      // Eli charts with encounters.chart alone: the sync read leaves a Medical visit's summary out.
      // A conflict he could never see into would never settle (VS-1), so every set of it is held.
      const visit = await visitAt(w.eli, w.patientId);
      const firstWords = await summarySet(w.eli, visit.encounterId, 'Demo: eli first words', 0);
      expect((await w.eli.send(firstWords))[0]).toMatchObject(held);
      await w.ana.send(await summarySet(w.ana, visit.encounterId, 'Demo: Ana Medical assessment', 0));
      const mark = await auditMark(h);
      const eli = await summarySet(w.eli, visit.encounterId, 'Demo: eli again', 1);
      const [first] = await w.eli.send(eli);
      expect(first).toMatchObject(held);
      expect(first!.server).toBeUndefined();
      // A retry is answered the same way, and nothing of the summary was read or logged as read.
      expect((await w.eli.send(eli))[0]).toMatchObject(held);
      expect((await events(mark)).map((e) => e.action)).toEqual(['sync.quarantined']);
      expect(await summaryOf(visit.encounterId)).toBe('Demo: Ana Medical assessment');
      // The sync read agrees: no summary.
      const read = await call(h, '/v1/sync/records', {
        method: 'POST',
        token: w.eli.token,
        teamId: w.t.teamId,
        json: { records: [{ entity: 'encounter', id: visit.encounterId }] },
      });
      expect(Object.keys((read.body.records as { fields: object }[])[0]!.fields)).not.toContain('summary');
      // A reviewer who may read both decides: accepted at the version it named, it is a conflict the
      // reviewer sees, so they reject it; the set Eli made at the right version goes on the chart.
      const reject = await call(h, `/v1/team/quarantine/${(await heldItem(eli.changeId))!.id}/decision`, {
        method: 'POST',
        token: w.t.adminToken,
        teamId: w.t.teamId,
        json: { decision: 'reject', reason: 'Demo: Ana’s assessment stands' },
      });
      expect(reject.status).toBe(200);
      expect((await heldItem(eli.changeId))!.status).toBe('rejected');
      // Ana, who may read it, is sent it.
      const [anas] = await w.ana.send(
        await summarySet(w.ana, visit.encounterId, 'Demo: Ana from an old copy', 0),
      );
      expect(anas).toMatchObject({ status: 'conflict', server: { value: 'Demo: Ana Medical assessment' } });
    });

    for (const resolution of ['replace', 'keep_server'] as const) {
      it(`settles a choice (${resolution}) made on a conflict a phone holds from before the hold`, async () => {
        // VS-1's case: a conflict answered with nothing shown, from before this rule, at version 0.
        // The choice is held, so the phone lets go of it and the visit settles.
        const visit = await visitAt(w.eli, w.patientId);
        await w.ana.send(await summarySet(w.ana, visit.encounterId, 'Demo: Ana Medical assessment', 0));
        const choice = await summarySet(w.eli, visit.encounterId, 'Demo: eli again', 0, {
          conflictOf: randomUUID(),
          resolution,
        });
        expect((await w.eli.send(choice))[0]).toMatchObject(held);
        expect(await summaryOf(visit.encounterId)).toBe('Demo: Ana Medical assessment');
      });
    }

    it('is held, not kept in history, after a finished note', async () => {
      const visit = await visitAt(w.eli, w.patientId);
      await w.ana.send(await summarySet(w.ana, visit.encounterId, 'Demo: Ana assessment, finished', 0));
      const withSummary = { ...visit, summary: 'Demo: Ana assessment, finished' };
      const flags = await noteOn(w.ana, withSummary, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
      const note = await noteOn(w.ana, withSummary, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: rest' });
      await finish(w.ana, [flags, 'sign', 'signed'], [note, 'sign', 'signed']);
      const late = await summarySet(w.eli, visit.encounterId, 'Demo: eli late words', 1);
      const [kept] = await w.eli.send(late);
      expect(kept).toMatchObject(held);
      expect((await w.eli.send(late))[0]).toMatchObject(held);
    });

    it('goes as it is on a Non-Medical visit', async () => {
      const visit = await visitAt(w.eli, w.patientId, { kind: 'non_medical' });
      await w.ana.send(await summarySet(w.ana, visit.encounterId, 'Demo: Ana outreach words', 0));
      const [first] = await w.eli.send(await summarySet(w.eli, visit.encounterId, 'Demo: eli outreach', 0));
      expect(first).toMatchObject({ status: 'conflict', server: { value: 'Demo: Ana outreach words' } });
    });

    describe('an admin’s accept of the held set meets the rule a push of it meets (D88)', () => {
      // Eli names the version the summary was at when he set it; what it holds by the accept decides.
      const heldSet = async (value: string) => {
        const visit = await visitAt(w.eli, w.patientId);
        await w.ana.send(await summarySet(w.ana, visit.encounterId, 'Demo: Ana first assessment', 0));
        const eli = await summarySet(w.eli, visit.encounterId, value, 1);
        expect((await w.eli.send(eli))[0]).toMatchObject(held);
        return { visit, eli };
      };

      it('is refused over a summary that holds another value since, and the reviewer can then reject it', async () => {
        const { visit, eli } = await heldSet('Demo: eli words, moved');
        await w.ana.send(await summarySet(w.ana, visit.encounterId, 'Demo: Ana second assessment', 1));
        const accept = await decide(eli.changeId, 'accept', 'Demo: checked with Eli');
        // Never over a value its sender never saw: the conflict a push of it would meet refuses it.
        expect(accept.status).toBe(409);
        expect(accept.body.error).toMatchObject({ code: 'cannot_apply', details: { status: 'conflict' } });
        expect(await summaryOf(visit.encounterId)).toBe('Demo: Ana second assessment');
        expect((await historyOf(visit.encounterId, 'summary')).map((r) => r.value)).not.toContain(
          'Demo: eli words, moved',
        );
        expect((await heldItem(eli.changeId))!.status).toBe('pending');
        const reject = await decide(eli.changeId, 'reject', 'Demo: Ana’s assessment stands');
        expect(reject.status).toBe(200);
        expect((await heldItem(eli.changeId))!.status).toBe('rejected');
        expect(await summaryOf(visit.encounterId)).toBe('Demo: Ana second assessment');
      });

      it('fills a summary cleared since', async () => {
        const { visit, eli } = await heldSet('Demo: eli words, filled');
        await w.ana.send(await summarySet(w.ana, visit.encounterId, null, 1));
        const accept = await decide(eli.changeId, 'accept', 'Demo: checked with Eli');
        expect(accept.status).toBe(200);
        expect(await summaryOf(visit.encounterId)).toBe('Demo: eli words, filled');
        expect((await heldItem(eli.changeId))!.status).toBe('accepted');
        expect((await historyOf(visit.encounterId, 'summary')).at(-1)).toEqual({
          value: 'Demo: eli words, filled',
          version: 3,
          kind: 'filled_blank',
          changedBy: w.eli.id,
          approvedBy: w.t.adminId,
        });
      });

      it('is kept in the visit’s history once a note of the visit is finished, the summary unchanged', async () => {
        const { visit, eli } = await heldSet('Demo: eli words, late');
        const withSummary = { ...visit, summary: 'Demo: Ana first assessment' };
        const flags = await noteOn(w.ana, withSummary, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
        const note = await noteOn(w.ana, withSummary, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: rest' });
        await finish(w.ana, [flags, 'sign', 'signed'], [note, 'sign', 'signed']);
        const accept = await decide(eli.changeId, 'accept', 'Demo: checked with Eli');
        expect(accept.status).toBe(200);
        expect(await summaryOf(visit.encounterId)).toBe('Demo: Ana first assessment');
        expect((await heldItem(eli.changeId))!.status).toBe('accepted');
        expect((await historyOf(visit.encounterId, 'summary')).at(-1)).toMatchObject({
          value: 'Demo: eli words, late',
          version: 1,
          kind: 'kept_both',
          changedBy: w.eli.id,
        });
        expect(await receiptOf(eli.changeId)).toMatchObject({
          status: 'accepted',
          details: { outcome: 'history_only', problem: 'encounter_has_finished_note' },
        });
        // Its sender and the finished notes' signer are told, as of any late change to the visit.
        for (const who of [w.eli.id, w.ana.id]) {
          expect(await noticesOf(h, who, 'late_change_kept')).toContainEqual({
            entity: 'encounter',
            recordId: visit.encounterId,
          });
        }
      });
    });
  });

  describe('a held note answer (lifecycle 6.4 rule 5)', () => {
    it('an admin’s accept is refused over an answer that holds another value since (D88)', async () => {
      // Ana sees no sensitive exam, so her set of one on Vic's note is held, whatever it holds.
      const visit = await visitAt(w.vic, w.patientId);
      const note = await noteOn(w.vic, visit, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM);
      const findings = (c: World['eli'], value: string, baseVersion: number) =>
        c.phone.change({
          entity: 'encounter_note',
          recordId: note.noteId,
          op: 'set',
          field: 'data.exam.findings',
          value,
          baseVersion,
        });
      const anas = await findings(w.ana, 'Demo: a small rash', 1);
      expect((await w.ana.send(anas))[0]).toMatchObject(held);
      const [vics] = await w.vic.send(await findings(w.vic, 'Demo: a healing scrape', 1));
      expect(vics).toMatchObject({ status: 'accepted', serverVersion: 2 });
      const accept = await decide(anas.changeId, 'accept', 'Demo: checked with Ana');
      expect(accept.status).toBe(409);
      expect(accept.body.error).toMatchObject({ code: 'cannot_apply', details: { status: 'conflict' } });
      expect((await noteRow(h, note.noteId)).data).toMatchObject({
        'exam.findings': 'Demo: a healing scrape',
      });
      expect((await heldItem(anas.changeId))!.status).toBe('pending');
    });
  });

  describe('by the sync read’s rules for the record (VA-1)', () => {
    it('A1: a retry after the sender lost patients.view carries nothing of the patient and logs no read', async () => {
      const rae = await clinician(h, w.t, 'rae-a1@example.com', 'Rae A1 (demo)', 'resident');
      const change = await rae.phone.change({
        entity: 'patient',
        recordId: w.patientId,
        op: 'set',
        field: 'preferredName',
        value: 'Demo Robbie',
        baseVersion: 0,
      });
      const [first] = await rae.send(change);
      expect(first).toMatchObject({
        status: 'accepted',
        details: { outcome: 'kept_both' },
        server: { value: w.preferredName },
      });
      // Rae moves to a role that charts and reads no patient record: the sync read refuses her.
      await setRole(h, w.t, rae.membershipId, await roleWith(h, w.t, 'Chart only A1', ['encounters.chart']));
      const read = await call(h, '/v1/sync/records', {
        method: 'POST',
        token: rae.token,
        teamId: w.t.teamId,
        json: { records: [{ entity: 'patient', id: w.patientId }] },
      });
      expect(read.status).toBe(403);
      const mark = await auditMark(h);
      const [retry] = await rae.send(change);
      expect(retry).toMatchObject({ status: 'accepted', details: { outcome: 'kept_both' } });
      expect(retry!.server).toEqual(NOTHING);
      expect(await events(mark)).toEqual([]);
    });

    it('a first answer to a sender who may edit but not read the patient carries nothing and logs no read', async () => {
      const edits = await roleWith(h, w.t, 'Edit without view', ['patients.edit']);
      const ed = await clinician(h, w.t, 'ed-a1@example.com', 'Ed (demo)', 'none', edits);
      const mark = await auditMark(h);
      const [first] = await ed.send(
        await ed.phone.change({
          entity: 'patient',
          recordId: w.patientId,
          op: 'set',
          field: 'preferredName',
          value: 'Demo Robbie',
          baseVersion: 0,
        }),
      );
      expect(first).toMatchObject({ status: 'accepted', details: { outcome: 'kept_both' } });
      expect(first!.server).toEqual(NOTHING);
      expect((await events(mark)).filter((e) => e.action.endsWith('.viewed'))).toEqual([]);
    });

    describe('a sensitive problem, to a sender without patients.view_sensitive', () => {
      const plainSender = async (email: string) =>
        clinician(
          h,
          w.t,
          email,
          'Pat (demo)',
          'attending',
          await roleWith(h, w.t, `Plain charting ${email}`, ['patients.view', 'encounters.chart']),
        );
      const statusSet = (c: World['eli'], problemId: string, status: string, deviceTime: string) =>
        c.phone.change({
          entity: 'problem',
          recordId: problemId,
          op: 'set',
          field: 'status',
          value: { status, encounterId: null },
          baseVersion: 1,
          deviceTime,
        });

      it('A3: kept in history, it carries nothing of the problem, as the sync read reports it missing', async () => {
        const pat = await plainSender('pat-a3@example.com');
        const problemId = await createProblem(h, w.t.teamId, w.patientId, w.ana.id, {
          statuses: ['new', 'resolved'],
          sensitive: true,
          title: 'Demo sensitive problem',
        });
        const read = await call(h, '/v1/sync/records', {
          method: 'POST',
          token: pat.token,
          teamId: w.t.teamId,
          json: { records: [{ entity: 'problem', id: problemId }] },
        });
        expect(read.body).toMatchObject({ records: [], missing: [{ entity: 'problem', id: problemId }] });
        const mark = await auditMark(h);
        const change = await statusSet(pat, problemId, 'ongoing', '2000-01-01T00:00:00.000Z');
        const [first] = await pat.send(change);
        expect(first).toMatchObject({ status: 'accepted', details: { outcome: 'history_only' } });
        expect(first!.server).toEqual(NOTHING);
        const [retry] = await pat.send(change);
        expect(retry!.server).toEqual(NOTHING);
        expect((await events(mark)).filter((e) => e.action.endsWith('.viewed'))).toEqual([]);
      });

      it('a conflict on it is held for review, not answered with a choice the sender cannot see into', async () => {
        const pat = await plainSender('pat-hold@example.com');
        const problemId = await createProblem(h, w.t.teamId, w.patientId, w.ana.id, {
          statuses: ['new', 'resolved'],
          sensitive: true,
          title: 'Demo sensitive problem',
        });
        // A newer observation that moves out of Resolved is a conflict (problem.ts applyStatus).
        const [first] = await pat.send(
          await statusSet(pat, problemId, 'ongoing', '2099-01-01T00:00:00.000Z'),
        );
        expect(first).toMatchObject(held);
        expect(first!.server).toBeUndefined();
        // The same change from a sender who may read it is the conflict it was.
        const [ana] = await w.ana.send(
          await statusSet(w.ana, problemId, 'ongoing', '2099-01-01T00:00:00.000Z'),
        );
        expect(ana).toMatchObject({ status: 'conflict', server: { value: { status: 'resolved' } } });
      });
    });
  });

  describe('as a read (PA-1)', () => {
    it('names the patient on sync.conflict, and a retry writes its read in its transaction', async () => {
      const visit = await visitAt(w.ana, w.patientId);
      const note = await noteOn(w.ana, visit, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: first plan' });
      const raes = await w.rae.phone.change({
        entity: 'encounter_note',
        recordId: note.noteId,
        op: 'set',
        field: 'data.care.plan',
        value: 'Demo: rae plan',
        baseVersion: 0,
      });
      const m1 = await auditMark(h);
      const [first] = await w.rae.send(raes);
      expect(first).toMatchObject({ status: 'conflict', server: { value: 'Demo: first plan' } });
      expect(await events(m1)).toEqual([
        expect.objectContaining({
          action: 'sync.conflict',
          patientId: w.patientId,
          entity: 'encounter_note',
        }),
      ]);
      // Ana rewrites the answer, and Rae's phone, whose first answer was lost, sends the change again.
      const anas = await w.ana.phone.change({
        entity: 'encounter_note',
        recordId: note.noteId,
        op: 'set',
        field: 'data.care.plan',
        value: 'Demo: second plan, written after the conflict',
        baseVersion: 1,
      });
      expect((await w.ana.send(anas)).map((r) => r.status)).toEqual(['accepted']);
      const m2 = await auditMark(h);
      const [retry] = await w.rae.send(raes);
      expect(retry!.server?.value).toBe('Demo: second plan, written after the conflict');
      const logged = await events(m2);
      expect(logged).toEqual([
        expect.objectContaining({ action: 'note.viewed', patientId: w.patientId, entity: 'encounter_note' }),
      ]);
      expect(logged[0]!.details).toMatchObject({
        source: 'sync',
        changeId: raes.changeId,
        field: 'data.care.plan',
      });
      // Nothing of the value is in the event.
      expect(JSON.stringify(logged)).not.toContain('Demo');
    });

    it('writes no read for a retry answered with nothing shown', async () => {
      // A note answer's conflict, retried once the sender's role reads none of it (the note rule).
      const visit = await visitAt(w.ana, w.patientId);
      const note = await noteOn(w.ana, visit, TEST_MEDICAL_TYPE, {
        'care.plan': 'Demo: first plan, no read',
      });
      const sam = await clinician(h, w.t, 'sam-noread@example.com', 'Sam (demo)', 'np');
      const sams = await sam.phone.change({
        entity: 'encounter_note',
        recordId: note.noteId,
        op: 'set',
        field: 'data.care.plan',
        value: 'Demo: sam plan',
        baseVersion: 0,
      });
      expect((await sam.send(sams))[0]).toMatchObject({ status: 'conflict' });
      await setRole(h, w.t, sam.membershipId, await roleWith(h, w.t, 'Nothing to read', ['inventory.view']));
      const mark = await auditMark(h);
      const [retry] = await sam.send(sams);
      expect(retry!.server).toEqual(NOTHING);
      expect((await events(mark)).filter((e) => e.action.endsWith('.viewed'))).toEqual([]);
    });

    it('a retry of a set kept in history logs its read on the patient', async () => {
      const visit = await visitAt(w.ana, w.patientId);
      const summary = (value: string, baseVersion: number) =>
        w.ana.phone.change({
          entity: 'encounter',
          recordId: visit.encounterId,
          op: 'set',
          field: 'summary',
          value,
          baseVersion,
        });
      await w.ana.send(await summary('Demo: first words', 0));
      const flags = await noteOn(w.ana, { ...visit, summary: 'Demo: first words' }, TEST_RED_FLAGS_TYPE, {
        'flags.any': 'no',
      });
      await finish(w.ana, [flags, 'sign', 'signed']);
      const late = await summary('Demo: late words', 1);
      const [kept] = await w.ana.send(late);
      expect(kept).toMatchObject({ status: 'accepted', details: { outcome: 'history_only' } });
      const mark = await auditMark(h);
      await w.ana.send(late);
      expect(await events(mark)).toEqual([
        expect.objectContaining({ action: 'encounter.viewed', patientId: w.patientId, entity: 'encounter' }),
      ]);
    });
  });
});
