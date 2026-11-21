import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, finish, TEST_MEDICAL_TYPE, visitAt, type World } from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark } from './patient-fixtures.ts';
import { call, noteOn, TEST_RED_FLAGS_TYPE } from './sync-fixtures.ts';

/**
 * A value the server sends back to a phone is a read (the coordinator's decisions on review
 * findings PA-1, PA-4 and PP-4): what a conflict, a value kept in history and a retry carry follows
 * the sync read's rules, and is logged on the record's patient in the push's transaction.
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

  describe('a Medical visit’s summary (PA-4)', () => {
    const summarySet = (c: World['eli'], encounterId: string, value: string, baseVersion: number) =>
      c.phone.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field: 'summary',
        value,
        baseVersion,
      });

    it('goes to a sender the sync read withholds it from as a field that holds nothing', async () => {
      // Eli charts with encounters.chart alone: the sync read leaves a Medical visit's summary out.
      const visit = await visitAt(w.eli, w.patientId);
      expect(
        (await w.eli.send(await summarySet(w.eli, visit.encounterId, 'Demo: eli first words', 0)))[0],
      ).toMatchObject({ status: 'accepted' });
      await w.ana.send(await summarySet(w.ana, visit.encounterId, 'Demo: Ana Medical assessment', 1));
      const eli = await summarySet(w.eli, visit.encounterId, 'Demo: eli again', 1);
      const [first] = await w.eli.send(eli);
      expect(first).toMatchObject({ status: 'conflict', server: { value: null, version: 0 } });
      // A retry is answered the same way.
      const [retry] = await w.eli.send(eli);
      expect(retry).toMatchObject({ status: 'conflict', server: { value: null, version: 0 } });
      // The sync read agrees: no summary.
      const read = await call(h, '/v1/sync/records', {
        method: 'POST',
        token: w.eli.token,
        teamId: w.t.teamId,
        json: { records: [{ entity: 'encounter', id: visit.encounterId }] },
      });
      expect(Object.keys((read.body.records as { fields: object }[])[0]!.fields)).not.toContain('summary');
      // Ana, who may read it, is sent it.
      const [anas] = await w.ana.send(
        await summarySet(w.ana, visit.encounterId, 'Demo: Ana from an old copy', 0),
      );
      expect(anas).toMatchObject({ status: 'conflict', server: { value: 'Demo: Ana Medical assessment' } });
    });

    it('is withheld from such a sender when it is kept in history after a finished note, and on a retry', async () => {
      const visit = await visitAt(w.eli, w.patientId);
      await w.ana.send(await summarySet(w.ana, visit.encounterId, 'Demo: Ana assessment, finished', 0));
      const withSummary = { ...visit, summary: 'Demo: Ana assessment, finished' };
      const flags = await noteOn(w.ana, withSummary, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
      const note = await noteOn(w.ana, withSummary, TEST_MEDICAL_TYPE, { 'care.plan': 'Demo: rest' });
      await finish(w.ana, [flags, 'sign', 'signed'], [note, 'sign', 'signed']);
      const late = await summarySet(w.eli, visit.encounterId, 'Demo: eli late words', 1);
      const [kept] = await w.eli.send(late);
      expect(kept).toMatchObject({ status: 'accepted', details: { outcome: 'history_only' } });
      expect(kept!.server).toEqual({ value: null, version: 0, changedBy: null, changedAt: null });
      const [retry] = await w.eli.send(late);
      expect(retry!.server).toEqual({ value: null, version: 0, changedBy: null, changedAt: null });
    });

    it('goes as it is on a Non-Medical visit', async () => {
      const visit = await visitAt(w.eli, w.patientId, { kind: 'non_medical' });
      await w.ana.send(await summarySet(w.ana, visit.encounterId, 'Demo: Ana outreach words', 0));
      const [first] = await w.eli.send(await summarySet(w.eli, visit.encounterId, 'Demo: eli outreach', 0));
      expect(first).toMatchObject({ status: 'conflict', server: { value: 'Demo: Ana outreach words' } });
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
      const visit = await visitAt(w.eli, w.patientId);
      const set = (c: World['eli'], value: string, baseVersion: number) =>
        c.phone.change({
          entity: 'encounter',
          recordId: visit.encounterId,
          op: 'set',
          field: 'summary',
          value,
          baseVersion,
        });
      await w.ana.send(await set(w.ana, 'Demo: Ana words', 0));
      const eli = await set(w.eli, 'Demo: eli words', 0);
      await w.eli.send(eli);
      const mark = await auditMark(h);
      await w.eli.send(eli);
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
