import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorld,
  eventsAfter,
  expectNoneOf,
  finish,
  get,
  PLAN,
  post,
  SECRETS,
  TEST_MEDICAL_EXAM_TYPE,
  TEST_MEDICAL_TYPE,
  TEST_NOTE_TYPE,
  visitAt,
  WITH_EXAM,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, mergeDirect } from './patient-fixtures.ts';
import {
  noteOn,
  TEST_RED_FLAGS_TYPE,
  TEST_SENSITIVE_TYPE,
  type HeldNote,
  type Json,
} from './sync-fixtures.ts';

// The chart's timeline and recent visits (lifecycle 5.2): GET /v1/patients/{patientId} gains
// `timeline`, the merged group's visits newest first, the first 50, each with its notes as
// { noteId, noteTypeKey, group, status, attestation } and the group's referrals; and
// `recentVisits`, the last three visits in full, each as GET /v1/encounters/{id} answers it
// (PLAN-OPEN 12.1 #17). A note the reader may not see is left out, and so is an empty draft.
// GET /v1/patients/{patientId}/timeline?before= gives the next 50, logged as chart.timeline_viewed.
// Every person and value is made up.

interface TimelineVisit {
  encounterId: string;
  startedAt: string;
  kind: string;
  status: string;
  notes: { noteId: string; noteTypeKey: string; group: string; status: string; attestation: string }[];
}
interface Chart {
  canonicalId: string;
  timeline: { encounters: TimelineVisit[]; referrals: { id: string }[] };
  recentVisits: { encounterId: string; notes: { noteId: string }[]; summary?: string }[];
}

const HOUR = 3600_000;

describe('phase 4: the timeline and recent visits', () => {
  let h: Harness;
  let w: World;
  let visit: { encounterId: string; patientId: string; summary: null };
  let flags: HeldNote;
  let plain: HeldNote;
  let exam: HeldNote;
  let talk: HeldNote;
  let social: HeldNote;
  let empty: HeldNote;
  let referralId: string;
  /** A patient with 53 visits, and one merged into the world's patient with a visit of its own. */
  let busy: string;
  let busyVisits: { id: string; startedAt: string }[];
  let merged: string;
  let mergedVisit: string;

  const ago = (hours: number) => new Date(h.clock.now.getTime() - hours * HOUR).toISOString();

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
    const { rae, sol, ana } = w;
    const v = await visitAt(rae, w.patientId, { startedAt: ago(1) });
    visit = { encounterId: v.encounterId, patientId: w.patientId, summary: null };
    flags = await noteOn(rae, visit, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
    plain = await noteOn(rae, visit, TEST_MEDICAL_TYPE, PLAN);
    exam = await noteOn(rae, visit, TEST_MEDICAL_EXAM_TYPE, WITH_EXAM);
    talk = await noteOn(rae, visit, TEST_SENSITIVE_TYPE, { 'talk.notes': 'Demo: talked about sleep' });
    social = await noteOn(sol, visit, TEST_NOTE_TYPE, { 'care.plan': 'Demo: housing list' });
    // Picked by mistake and blanked (lifecycle 3.1): not on the timeline.
    empty = await noteOn(sol, visit, TEST_NOTE_TYPE, { 'care.plan': '' });
    await finish(rae, [flags, 'sign', 'signed'], [plain, 'sign', 'signed']);
    const referral = await ana.phone.change({
      entity: 'referral',
      op: 'create',
      value: {
        patientId: w.patientId,
        referredOn: '2026-10-20',
        details: 'Demo: dental clinic on Main St',
        encounterId: visit.encounterId,
      },
    });
    expect((await ana.send(referral)).map((r) => r.status)).toEqual(['accepted']);
    referralId = referral.recordId;
    // Two earlier visits, so the world's patient has three.
    for (const hours of [5, 9]) {
      const older = await visitAt(ana, w.patientId, { kind: 'non_medical', startedAt: ago(hours) });
      await noteOn(ana, older, TEST_NOTE_TYPE, { 'care.plan': 'Demo: socks and water' });
    }

    // A record merged into the world's patient brings its visits with it.
    merged = (await createPatient(h, w.t.teamId, w.t.adminId, { preferredName: 'Demo Robin R' })).id;
    mergedVisit = (await visitAt(ana, merged, { kind: 'non_medical', startedAt: ago(48) })).encounterId;
    await mergeDirect(h, w.t.teamId, merged, w.patientId, w.t.adminId);

    // 53 visits, an hour apart, written as a synced create leaves them.
    busy = (await createPatient(h, w.t.teamId, w.t.adminId, { preferredName: 'Demo Kai' })).id;
    busyVisits = [];
    for (let i = 0; i < 53; i++) {
      const id = randomUUID();
      const startedAt = ago(100 + i);
      const fields = ['patientId', 'location', 'locationText', 'kind'];
      await h.scratch.owner`
        insert into sineobex.encounters (id, team_id, patient_id, kind, author_user_id, started_at, field_versions,
          field_meta)
        values (${id}, ${w.t.teamId}, ${busy}, 'non_medical', ${ana.id}, ${startedAt},
          ${h.scratch.owner.json(Object.fromEntries(fields.map((f) => [f, 1])))},
          ${h.scratch.owner.json(Object.fromEntries(fields.map((f) => [f, { by: ana.id, at: startedAt, changeId: null }])))})`;
      busyVisits.push({ id, startedAt });
    }
  });
  afterAll(() => h.close());

  const chartAs = async (token: string, patientId = w.patientId) => {
    const r = await get(w, token, `/v1/patients/${patientId}`);
    expect(r.status).toBe(200);
    return r.body as unknown as Chart & Json;
  };
  const entryOf = (c: Chart, encounterId: string) =>
    c.timeline.encounters.find((e) => e.encounterId === encounterId);
  const noteIds = (e: { notes: { noteId: string }[] } | undefined) => e!.notes.map((n) => n.noteId).sort();

  describe('on the chart', () => {
    it('the group’s visits newest first, each with its notes as the timeline lists them, and the group’s referrals', async () => {
      const c = await chartAs(w.vic.token);
      const starts = c.timeline.encounters.map((e) => e.startedAt);
      expect(starts).toEqual([...starts].sort().reverse());
      expect(c.timeline.encounters.map((e) => e.encounterId)).toContain(mergedVisit);
      expect(c.timeline.encounters).toHaveLength(4);
      const e = entryOf(c, visit.encounterId)!;
      expect(e).toMatchObject({ encounterId: visit.encounterId, kind: 'medical', startedAt: ago(1) });
      expect(e.notes.find((n) => n.noteId === plain.noteId)).toEqual({
        noteId: plain.noteId,
        noteTypeKey: TEST_MEDICAL_TYPE.key,
        group: 'clinical',
        status: 'signed',
        attestation: 'waiting',
      });
      expect(e.notes.find((n) => n.noteId === talk.noteId)).toMatchObject({
        group: 'psych',
        status: 'draft',
      });
      // The empty draft is not there; everything else is, for a reader who sees every note.
      expect(noteIds(e)).toEqual([flags, plain, exam, talk, social].map((n) => n.noteId).sort());
      expect(c.timeline.referrals.map((r) => r.id)).toEqual([referralId]);
      // No answer is on the timeline, for any reader: least of all a sensitive exam's (PRD main 415).
      expectNoneOf(c.timeline, [...SECRETS, 'Demo: talked about sleep', 'Demo: housing list']);
    });

    it('a note the reader may not see is left out of its visit', async () => {
      // Billing/Data reads Medical notes and no sensitive note type; the CHW preset reads neither.
      const bea = entryOf(await chartAs(w.bea.token), visit.encounterId);
      expect(noteIds(bea)).toEqual([flags, plain, exam, social].map((n) => n.noteId).sort());
      const kim = entryOf(await chartAs(w.kim.token), visit.encounterId);
      expect(noteIds(kim)).toEqual([social.noteId]);
    });

    it('the last three visits in full, each as the visit read answers it', async () => {
      const c = await chartAs(w.vic.token);
      expect(c.recentVisits.map((v) => v.encounterId)).toEqual(
        c.timeline.encounters.slice(0, 3).map((e) => e.encounterId),
      );
      const full = await get(w, w.vic.token, `/v1/encounters/${visit.encounterId}`);
      expect(c.recentVisits[0]).toEqual(full.body);
      // As the reader may see it: the CHW preset's copy has the Non-Medical note alone, no summary.
      const kim = await chartAs(w.kim.token);
      expect(kim.recentVisits[0]!.notes.map((n) => n.noteId)).toEqual([social.noteId]);
      expect(kim.recentVisits[0]).not.toHaveProperty('summary');
      expectNoneOf(kim.recentVisits, ['Demo: rest and fluids', 'Demo: no lesions seen']);
    });

    it('the recent visits shown are logged as the visit read logs them', async () => {
      const mark = await auditMark(h);
      const c = await chartAs(w.kim.token);
      const viewed = (await eventsAfter(h, mark)).filter((e) => e.action === 'encounter.viewed');
      expect(viewed.map((e) => e.entityId).sort()).toEqual(c.recentVisits.map((v) => v.encounterId).sort());
      expect(viewed.every((e) => e.entity === 'encounter' && e.patientId === w.patientId)).toBe(true);
    });

    it('the first 50 visits only, and the phone’s chart cache carries the same', async () => {
      const c = await chartAs(w.ana.token, busy);
      expect(c.timeline.encounters.map((e) => e.encounterId)).toEqual(
        busyVisits.slice(0, 50).map((v) => v.id),
      );
      expect(c.recentVisits.map((v) => v.encounterId)).toEqual(busyVisits.slice(0, 3).map((v) => v.id));
      const cached = await post(w, w.ana.token, '/v1/patients/charts', {
        patientIds: [busy],
        reason: 'opened',
      });
      expect(cached.status).toBe(200);
      const [chart] = (cached.body as Json).charts as Chart[];
      expect(chart!.timeline.encounters.map((e) => e.encounterId)).toEqual(
        c.timeline.encounters.map((e) => e.encounterId),
      );
      expect(chart!.recentVisits.map((v) => v.encounterId)).toEqual(c.recentVisits.map((v) => v.encounterId));
    });
  });

  describe('GET /v1/patients/{patientId}/timeline: earlier visits', () => {
    const earlier = (token: string, patientId: string, before?: string) =>
      get(w, token, `/v1/patients/${patientId}/timeline${before ? `?before=${before}` : ''}`);

    it('needs patients.view: a role without it is refused, and the refusal is logged', async () => {
      const mark = await auditMark(h);
      expect((await earlier(w.eli.token, busy, busyVisits[49]!.id)).status).toBe(403);
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ permission: 'patients.view' });
    });

    it('the next visits after the one named, newest first', async () => {
      const r = await earlier(w.ana.token, busy, busyVisits[49]!.id);
      expect(r.status).toBe(200);
      const encounters = (r.body as Json).encounters as TimelineVisit[];
      expect(encounters.map((e) => e.encounterId)).toEqual(busyVisits.slice(50).map((v) => v.id));
      expect(encounters[0]).toEqual({
        encounterId: busyVisits[50]!.id,
        startedAt: busyVisits[50]!.startedAt,
        kind: 'non_medical',
        status: 'draft',
        notes: [],
      });
      // A merged record's ID answers its group, as the chart does.
      const group = await earlier(w.ana.token, merged, visit.encounterId);
      expect(group.status).toBe(200);
      expect(((group.body as Json).encounters as TimelineVisit[]).map((e) => e.encounterId)).toContain(
        mergedVisit,
      );
    });

    it('is logged as a view of the chart’s timeline, with how many visits it shows', async () => {
      const mark = await auditMark(h);
      await earlier(w.ana.token, busy, busyVisits[49]!.id);
      const [event] = await expectAudit(h, 'chart.timeline_viewed', { after: mark, count: 1 });
      expect(event!.patientId).toBe(busy);
      expect(event!.details).toMatchObject({ resultCount: 3 });
      expect(event!.details).not.toHaveProperty('count');
    });

    it('a patient the team does not have is 404, and an earlier visit that is not one is 422', async () => {
      expect((await earlier(w.ana.token, randomUUID(), busyVisits[0]!.id)).status).toBe(404);
      expect((await earlier(w.ana.token, busy, 'not-an-id')).status).toBe(422);
    });
  });
});
