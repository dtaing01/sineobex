import { PRESETS, type ResolvedNoteType } from '@sineobex/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assignTo,
  chartedVisit,
  cosign,
  createWorld,
  finish,
  get,
  post,
  rejoin,
  removeMember,
  roleWith,
  setCredential,
  TEST_MEDICAL_EXAM_TYPE,
  TEST_NOTE_TYPE,
  visitAt,
  waitingForAttestation,
  waitingForCosign,
  WITH_EXAM,
  type ChartedVisit,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { createPatient, mergeDirect } from './patient-fixtures.ts';
import { clinician, noteOn, type Clinician, type HeldNote, type Json } from './sync-fixtures.ts';

// What the visit read tells the portal's visit page, so the page holds no rule of its own (unit
// L6; lifecycle 5.1, 9.11): the patient's preferred name, as the queues give it; whether the visit
// has an EMS handoff, asked as the export asks it; each note's title and whether it is Medical; and
// what the reader may do to each note as a second person, canCosign and canAttest, the act's own
// rule asked as if the hash matched (as the queues' canAct is), with, for a waiting note they may
// not act on, why, so the page words it truly. Every person and value is made up.

interface Note {
  noteId: string;
  title: string;
  medical: boolean;
  canCosign: boolean;
  canAttest: boolean;
  heldBecause?: string;
  contentHash?: string;
}
interface VisitRead {
  encounterId: string;
  patientId: string | null;
  preferredName: string | null;
  hasHandoff: boolean;
  notes: Note[];
}
interface QueueRow {
  encounterId: string;
  notes: { noteId: string; canAct: boolean }[];
}

const RED_FLAGS = PRESETS.find((p) => p.key === 'red_flags_disposition')!.definition as ResolvedNoteType;
/** EMS activated: the released Red flags note then shows Show handoff (9.8). */
const EMS = {
  'red_flags.emergency': 'yes',
  'red_flags.ems_activated': 'yes',
  'red_flags.transport': 'yes',
  'red_flags.ems_time': '14:05',
};

describe('phase 4: what the visit read tells the visit page', () => {
  let h: Harness;
  let w: World;

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
  });
  afterAll(() => h.close());

  const readAs = async (c: { token: string }, encounterId: string) => {
    const r = await get(w, c.token, `/v1/encounters/${encounterId}`);
    expect(r.status).toBe(200);
    return r.body as unknown as VisitRead & Json;
  };
  const noteIn = (r: VisitRead, n: HeldNote) => r.notes.find((x) => x.noteId === n.noteId)!;
  const acts = (r: VisitRead, ...ns: HeldNote[]) =>
    ns.map((n) => {
      const { canCosign, canAttest, heldBecause } = noteIn(r, n);
      return { canCosign, canAttest, heldBecause };
    });
  const may = (canCosign: boolean, canAttest: boolean, heldBecause?: string) => ({
    canCosign,
    canAttest,
    heldBecause,
  });

  describe('the contract', () => {
    it('gives each field added for the portal a default, so a copy a phone cached before it still reads', async () => {
      // The phone keeps a chart's timeline and recent visits for 24 hours (lifecycle 5.2), and its
      // generated client takes a field the contract requires as required (unit L6, rule 7).
      interface Schema {
        required?: string[];
        properties?: Record<string, { default?: unknown }>;
        allOf?: (Schema & { $ref?: string })[];
      }
      const doc = (await (await h.request('/openapi.json')).json()) as {
        components: { schemas: Record<string, Schema> };
      };
      // An extended schema is an allOf of what it extends and what it adds.
      const flat = (s: Schema & { $ref?: string }): Required<Pick<Schema, 'required' | 'properties'>> => {
        if (s.$ref) return flat(doc.components.schemas[s.$ref.split('/').at(-1)!]!);
        const parts = (s.allOf ?? []).map(flat);
        return {
          required: [...(s.required ?? []), ...parts.flatMap((p) => p.required)],
          properties: Object.assign({}, ...parts.map((p) => p.properties), s.properties ?? {}),
        };
      };
      const added: Record<string, string[]> = {
        VisitRead: ['preferredName', 'hasHandoff', 'recordsOnAnotherChart'],
        VisitNote: ['medical', 'canCosign', 'canAttest', 'heldBecause'],
        TimelineNote: ['title', 'medical'],
        QueueNote: ['title', 'heldBecause'],
        IncompleteNote: ['title', 'preferredName'],
        HomeCounts: ['teamOverdue'],
      };
      for (const [name, fields] of Object.entries(added)) {
        const schema = flat(doc.components.schemas[name]!);
        for (const field of fields) {
          expect(schema.properties, `${name}.${field}`).toHaveProperty(field);
          expect(schema.required, `${name}.${field}`).not.toContain(field);
        }
      }
      // Each that a page reads as a value has the default it reads when it is missing.
      const defaultOf = (name: string, field: string) =>
        flat(doc.components.schemas[name]!).properties[field]!.default;
      expect(defaultOf('VisitNote', 'canCosign')).toBe(false);
      expect(defaultOf('VisitRead', 'hasHandoff')).toBe(false);
      expect(defaultOf('VisitRead', 'recordsOnAnotherChart')).toEqual([]);
      expect(defaultOf('TimelineNote', 'title')).toBe('');
      expect(defaultOf('IncompleteNote', 'preferredName')).toBe(null);
    });
  });

  describe('the patient and the notes', () => {
    it('each note’s title and whether it is Medical', async () => {
      const v = await chartedVisit(w, w.rae);
      const social = await noteOn(w.sol, v.visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: housing list' });
      const r = await readAs(w.vic, v.visit.encounterId);
      expect([v.flags, v.note, social].map((n) => noteIn(r, n)).map((n) => [n.title, n.medical])).toEqual([
        [v.flags.type.title, true],
        [v.note.type.title, true],
        [TEST_NOTE_TYPE.title, false],
      ]);
    });

    it('the patient’s preferred name, the chart’s they were merged into; none for a visit with no patient', async () => {
      const merged = (await createPatient(h, w.t.teamId, w.t.adminId, { preferredName: 'Demo Robin R' })).id;
      const v = await chartedVisit(w, w.rae, undefined, undefined, { patientId: merged });
      await mergeDirect(h, w.t.teamId, merged, w.patientId, w.t.adminId);
      for (const c of [w.vic, w.bea, w.kim]) {
        const r = await readAs(c, v.visit.encounterId);
        expect(r, c.id).toMatchObject({ patientId: merged, preferredName: w.preferredName });
      }
      const nobody = await visitAt(w.ana, null, { kind: 'non_medical' });
      await noteOn(w.ana, nobody, TEST_NOTE_TYPE, { 'care.plan': 'Demo: socks and water' });
      expect(await readAs(w.ana, nobody.encounterId)).toMatchObject({ patientId: null, preferredName: null });
    });
  });

  describe('whether the visit has an EMS handoff', () => {
    const exportAs = (c: { token: string }, encounterId: string) =>
      h.request(`/v1/encounters/${encounterId}/ems-handoff`, { token: c.token, teamId: w.t.teamId });

    it('once EMS was activated in its Red flags note, for a reader who may read that note, as the export answers', async () => {
      const activated = await visitAt(w.rae, w.patientId);
      await noteOn(w.rae, activated, RED_FLAGS, EMS);
      const calm = await visitAt(w.rae, w.patientId);
      await noteOn(w.rae, calm, RED_FLAGS, { 'red_flags.emergency': 'no' });
      const outreach = await visitAt(w.ana, w.patientId, { kind: 'non_medical' });
      await noteOn(w.ana, outreach, TEST_NOTE_TYPE, { 'care.plan': 'Demo: socks and water' });
      for (const c of [w.vic, w.ana, w.rae, w.bea, w.kim]) {
        for (const [visit, offered] of [
          [activated, c !== w.kim],
          [calm, false],
          [outreach, false],
        ] as const) {
          const r = await readAs(c, visit.encounterId);
          expect(r.hasHandoff, `${c.id} ${visit.encounterId}`).toBe(offered);
          // The page offers the export exactly when the route would give the file.
          const file = await exportAs(c, visit.encounterId);
          expect(file.status === 200, `${c.id} ${visit.encounterId} ${file.status}`).toBe(offered);
        }
      }
    });
  });

  describe('what the reader may do as a second person', () => {
    let toCosign: ChartedVisit;
    let examToCosign: ChartedVisit;
    let toAttest: ChartedVisit;
    let examToAttest: ChartedVisit;

    beforeAll(async () => {
      toCosign = await waitingForCosign(w);
      examToCosign = await waitingForCosign(w, w.sol, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM);
      toAttest = await waitingForAttestation(w);
      examToAttest = await waitingForAttestation(w, w.nia, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM);
    });

    it('a note waiting for a co-signer: canCosign, with the hash to send, and the act takes exactly those notes', async () => {
      const v = await waitingForCosign(w);
      const r = await readAs(w.ana, v.visit.encounterId);
      expect(acts(r, v.flags, v.note)).toEqual([may(true, false), may(true, false)]);
      const sent = r.notes.filter((n) => n.canCosign);
      expect(sent.every((n) => /^[0-9a-f]{64}$/.test(n.contentHash ?? ''))).toBe(true);
      const answer = await post(w, w.ana.token, `/v1/encounters/${v.visit.encounterId}/cosign`, {
        notes: sent.map((n) => ({ noteId: n.noteId, contentHash: n.contentHash })),
        statementVersion: 'cosign-2026-11',
      });
      expect(answer.status).toBe(200);
      // Signed now, with nothing waiting: nothing to do and nothing to explain.
      expect(acts(await readAs(w.ana, v.visit.encounterId), v.flags, v.note)).toEqual([
        may(false, false),
        may(false, false),
      ]);
    });

    it('a note waiting for attestation: canAttest to an attending who sees all of it', async () => {
      expect(acts(await readAs(w.ana, toAttest.visit.encounterId), toAttest.flags, toAttest.note)).toEqual([
        may(false, true),
        may(false, true),
      ]);
    });

    it('canCosign and canAttest are the queues’ canAct, for every reader', async () => {
      const visits = [toCosign, examToCosign, toAttest, examToAttest];
      for (const c of [w.ana, w.vic, w.rae, w.nia, w.sol, w.eli]) {
        const queues = {
          cosign: await get(w, c.token, '/v1/team/cosign-queue'),
          attestation: await get(w, c.token, '/v1/team/attestation-queue'),
        };
        const canAct = (which: keyof typeof queues, noteId: string) =>
          queues[which].status === 200 &&
          ((queues[which].body as Json).rows as QueueRow[])
            .flatMap((row) => row.notes)
            .some((n) => n.noteId === noteId && n.canAct);
        for (const v of visits) {
          const r = await get(w, c.token, `/v1/encounters/${v.visit.encounterId}`);
          // Eli charts without patients.view: the visit read refuses him, and his queues are empty.
          if (c === w.eli) {
            expect(r.status).toBe(403);
            continue;
          }
          for (const n of (r.body as unknown as VisitRead).notes) {
            expect(n.canCosign, `${c.id} cosign ${n.noteId}`).toBe(canAct('cosign', n.noteId));
            expect(n.canAttest, `${c.id} attest ${n.noteId}`).toBe(canAct('attestation', n.noteId));
          }
        }
      }
    });

    it('a note the reader wrote waits for someone else, and says so', async () => {
      expect(acts(await readAs(w.sol, toCosign.visit.encounterId), toCosign.flags, toCosign.note)).toEqual([
        may(false, false, 'wrote'),
        may(false, false, 'wrote'),
      ]);
      expect(acts(await readAs(w.rae, toAttest.visit.encounterId), toAttest.note)).toEqual([
        may(false, false, 'wrote'),
      ]);
    });

    it('an assignee acts as the author, and is never told they wrote it', async () => {
      const stu = await clinician(h, w.t, 'stu@example.com', 'Stu (demo)', 'student');
      const v = await waitingForCosign(w, stu);
      await removeMember(w, stu.membershipId);
      await assignTo(w, v.note.noteId, w.rae.id);
      const r = await readAs(w.rae, v.visit.encounterId);
      expect(acts(r, v.note, v.flags)).toEqual([may(false, false, 'acts_as_author'), may(true, false)]);
    });

    it('whoever completed it as its assignee, and came back after it was assigned on, completed it', async () => {
      const una = await clinician(h, w.t, 'una@example.com', 'Una (demo)', 'student');
      const kit = await clinician(h, w.t, 'kit@example.com', 'Kit (demo)', 'student');
      const v = await chartedVisit(w, una);
      await removeMember(w, una.membershipId);
      for (const n of [v.flags, v.note]) await assignTo(w, n.noteId, kit.id);
      await finish(kit, [v.flags, 'complete', 'completed'], [v.note, 'sign', 'saved_unsigned']);
      await removeMember(w, kit.membershipId);
      for (const n of [v.flags, v.note]) await assignTo(w, n.noteId, w.rae.id);
      const back = await rejoin(w, 'kit@example.com', 'Kit (demo)', 'resident');
      expect(acts(await readAs(back, v.visit.encounterId), v.flags, v.note)).toEqual([
        may(false, false, 'completed'),
        may(false, false, 'completed'),
      ]);
      // Una wrote them, and is told so when she comes back.
      const una2 = await rejoin(w, 'una@example.com', 'Una (demo)', 'resident');
      expect(acts(await readAs(una2, v.visit.encounterId), v.note)).toEqual([may(false, false, 'wrote')]);
    });

    it('whoever made its current signature does not attest it', async () => {
      // A student's note co-signed by a resident who then became an attending.
      const ren: Clinician = await clinician(h, w.t, 'ren@example.com', 'Ren (demo)', 'resident');
      const v = await waitingForCosign(w);
      expect((await cosign(w, ren, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
      await setCredential(h, w.t, ren.membershipId, 'attending');
      expect(acts(await readAs(ren, v.visit.encounterId), v.flags, v.note)).toEqual([
        may(false, false, 'signed'),
        may(false, false, 'signed'),
      ]);
      expect(acts(await readAs(w.ana, v.visit.encounterId), v.flags, v.note)).toEqual([
        may(false, true),
        may(false, true),
      ]);
    });

    it('a note with an answer the reader may not see waits for someone who sees all of it, and says so', async () => {
      const ana = await readAs(w.ana, examToCosign.visit.encounterId);
      expect(acts(ana, examToCosign.flags, examToCosign.note)).toEqual([
        may(true, false),
        may(false, false, 'cannot_see_all'),
      ]);
      expect(noteIn(ana, examToCosign.note)).not.toHaveProperty('contentHash');
      expect(acts(await readAs(w.vic, examToCosign.visit.encounterId), examToCosign.note)).toEqual([
        may(true, false),
      ]);
      expect(acts(await readAs(w.ana, examToAttest.visit.encounterId), examToAttest.note)).toEqual([
        may(false, false, 'cannot_see_all'),
      ]);
    });

    it('a reader whose credential or role does not do the act is offered nothing, and told nothing of the note', async () => {
      // A student signs nothing; Billing/Data and the CHW preset chart nothing.
      expect(acts(await readAs(w.sol, toAttest.visit.encounterId), toAttest.flags, toAttest.note)).toEqual([
        may(false, false),
        may(false, false),
      ]);
      for (const c of [w.bea, w.kim]) {
        const r = await readAs(c, examToCosign.visit.encounterId);
        for (const n of r.notes)
          expect([n.canCosign, n.canAttest, n.heldBecause], c.id).toEqual([false, false, undefined]);
      }
      // An attending in a role that reads every answer but charts nothing: the routes refuse the
      // role, so the page offers nothing, though the credential would sign.
      const reading = await roleWith(h, w.t, 'Reading only', [
        'patients.view',
        'patients.view_sensitive',
        'patients.view_sensitive_exams',
        'billing.view_codes',
      ]);
      const ray = await clinician(h, w.t, 'ray@example.com', 'Ray (demo)', 'attending', reading);
      const rays = await readAs(ray, examToCosign.visit.encounterId);
      expect(acts(rays, examToCosign.flags, examToCosign.note)).toEqual([
        may(false, false),
        may(false, false),
      ]);
      expect((await cosign(w, ray, examToCosign.visit.encounterId, [examToCosign.flags])).status).toBe(403);
      // A resident co-signs but does not attest.
      expect(acts(await readAs(w.rae, toCosign.visit.encounterId), toCosign.note)).toEqual([
        may(true, false),
      ]);
      expect(acts(await readAs(w.rae, examToAttest.visit.encounterId), examToAttest.note)).toEqual([
        may(false, false),
      ]);
    });
  });
});
