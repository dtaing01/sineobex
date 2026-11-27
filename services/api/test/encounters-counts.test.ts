import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorld,
  eventsAfter,
  get,
  TEST_NOTE_TYPE,
  visitAt,
  waitingForAttestation,
  waitingForCosign,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark } from './patient-fixtures.ts';
import { clinician, noteOn, type Clinician, type Json } from './sync-fixtures.ts';

// GET /v1/me/counts (lifecycle 5.6, 9.9): the numbers Home shows. The caller's notes to finish and
// how many are overdue; the visits waiting in the co-sign and attestation queues, for a credential
// that acts on them; the team's incomplete notes, for team.manage_users. Each number is the length
// of the list it stands for, and a number for a list the caller may not open is absent. It names no
// patient, so it logs no patient: the lists log every patient they show, and a count built on them
// would put a view in each patient's access report every time someone opened Home. Every person
// and value is made up.

interface Counts {
  notesToFinish?: number;
  notesOverdue?: number;
  cosignWaiting?: number;
  attestationWaiting?: number;
  teamIncomplete?: number;
  teamOverdue?: number;
}

const HOUR = 3600_000;

describe('phase 4: the counts Home shows', () => {
  let h: Harness;
  let w: World;
  let lou: Clinician;

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
    lou = await clinician(h, w.t, 'lou@example.com', 'Lou (demo)', 'none');
    const draft = async (hours: number, answers: Record<string, unknown>) => {
      const visit = await visitAt(lou, w.patientId, {
        kind: 'non_medical',
        startedAt: new Date(h.clock.now.getTime() - hours * HOUR).toISOString(),
      });
      return noteOn(lou, visit, TEST_NOTE_TYPE, answers);
    };
    await draft(1, { 'care.plan': 'Demo: rest and fluids' });
    await draft(30, { 'care.plan': 'Demo: socks and water' });
    // Blanked: it does not count (lifecycle 3.1).
    await draft(30, { 'care.plan': '' });
    await waitingForCosign(w);
    await waitingForCosign(w);
    await waitingForAttestation(w);
  });
  afterAll(() => h.close());

  const counts = async (token: string) => {
    const r = await get(w, token, '/v1/me/counts');
    expect(r.status).toBe(200);
    return r.body as unknown as Counts & Json;
  };
  const listLength = async (token: string, path: string, key: 'rows' | 'notes') => {
    const r = await get(w, token, path);
    expect(r.status).toBe(200);
    return ((r.body as Json)[key] as unknown[]).length;
  };

  it('the caller’s notes to finish and how many are overdue, an empty draft not counted', async () => {
    const c = await counts(lou.token);
    expect(c).toMatchObject({ notesToFinish: 2, notesOverdue: 1 });
    expect(c.notesToFinish).toBe(await listLength(lou.token, '/v1/me/notes-to-finish', 'notes'));
  });

  it('a credential that signs gets the co-sign queue’s number; one that attests, the attestation queue’s', async () => {
    const ana = await counts(w.ana.token);
    expect(ana.cosignWaiting).toBe(await listLength(w.ana.token, '/v1/team/cosign-queue', 'rows'));
    expect(ana.attestationWaiting).toBe(await listLength(w.ana.token, '/v1/team/attestation-queue', 'rows'));
    expect(ana.cosignWaiting).toBe(2);
    expect(ana.attestationWaiting).toBe(1);
    expect(ana).not.toHaveProperty('teamIncomplete');
    expect(ana).not.toHaveProperty('teamOverdue');
    // A resident co-signs and does not attest.
    const rae = await counts(w.rae.token);
    expect(rae.cosignWaiting).toBe(2);
    expect(rae).not.toHaveProperty('attestationWaiting');
    // A credential that does neither gets neither number.
    const lous = await counts(lou.token);
    expect(lous).not.toHaveProperty('cosignWaiting');
    expect(lous).not.toHaveProperty('attestationWaiting');
  });

  it('a queue’s number counts only the visits its queue shows the caller', async () => {
    // Eli charts and attends but reads no chart: every waiting note is absent from his queues, so
    // the number is his queue's length, not the team's.
    const eli = await counts(w.eli.token);
    expect(eli.cosignWaiting).toBe(await listLength(w.eli.token, '/v1/team/cosign-queue', 'rows'));
    expect(eli.attestationWaiting).toBe(await listLength(w.eli.token, '/v1/team/attestation-queue', 'rows'));
    expect(eli).toMatchObject({ cosignWaiting: 0, attestationWaiting: 0 });
  });

  it('team.manage_users gets the team’s incomplete notes, and how many of them are overdue', async () => {
    const admin = await counts(w.t.adminToken);
    expect(admin.teamIncomplete).toBe(await listLength(w.t.adminToken, '/v1/team/incomplete-notes', 'notes'));
    expect(admin.teamIncomplete).toBeGreaterThanOrEqual(2);
    // The list's own overdue, so Home's "2 are older than a day" never disagrees with the list (9.12).
    const list = await get(w, w.t.adminToken, '/v1/team/incomplete-notes');
    const overdue = ((list.body as Json).notes as { overdue: boolean }[]).filter((n) => n.overdue).length;
    expect(admin.teamOverdue).toBe(overdue);
    expect(overdue).toBeGreaterThanOrEqual(1);
    expect(overdue).toBeLessThan(admin.teamIncomplete!);
    // Program Admin's credential here is none: no queue's number.
    expect(admin).not.toHaveProperty('cosignWaiting');
  });

  it('any member may ask; a role that charts nothing gets no number of a list it may not open', async () => {
    for (const token of [w.kim.token, w.bea.token]) {
      const c = await counts(token);
      for (const key of ['cosignWaiting', 'attestationWaiting', 'teamIncomplete', 'teamOverdue'])
        expect(c).not.toHaveProperty(key);
    }
    // Billing/Data charts nothing, so has no notes to finish either.
    const bea = await counts(w.bea.token);
    expect(bea).toEqual({});
  });

  it('names no patient, and logs no patient', async () => {
    const mark = await auditMark(h);
    for (const token of [lou.token, w.ana.token, w.t.adminToken]) {
      const c = await counts(token);
      expect(JSON.stringify(c)).not.toContain(w.patientId);
    }
    const events = await eventsAfter(h, mark);
    expect(events.filter((e) => e.patientId !== null || 'patientIds' in e.details)).toEqual([]);
  });
});
