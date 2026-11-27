import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { createPatient, mergeDirect } from './patient-fixtures.ts';
import { call, FakePhone, push, register, results, setupTeam, type Team } from './sync-fixtures.ts';

// The audit log searched by patient (module 10's access report, D33; review finding S4): an event
// that showed several patients names them in details.patientIds, and a merged record's events are
// the same person's, so a patient's search finds both. Everyone here is made up.

let h: Harness;
let t: Team;
let phone: FakePhone;

beforeAll(async () => {
  h = await createHarness();
  t = await setupTeam(h);
  phone = await FakePhone.create();
  await register(h, phone, t.aToken, t.teamId);
});
afterAll(() => h.close());

const asStaff = (path: string, json: unknown) =>
  call(h, path, { method: 'POST', token: t.aToken, teamId: t.teamId, json });

async function entriesFor(patientId: string) {
  const r = await call(h, '/v1/team/audit/search', {
    method: 'POST',
    token: t.adminToken,
    teamId: t.teamId,
    json: { patientId, limit: 200 },
  });
  expect(r.status).toBe(200);
  return r.body.entries as { action: string; patientId: string | null; details: Record<string, unknown> }[];
}

describe('the audit log searched by patient', () => {
  it('finds the searches, match checks and offline reads that showed the patient or its merged record', async () => {
    const kept = (await createPatient(h, t.teamId, t.aId, { preferredName: 'Rook' })).id;
    const merged = (await createPatient(h, t.teamId, t.aId, { preferredName: 'Rookie' })).id;
    const other = (await createPatient(h, t.teamId, t.aId, { preferredName: 'Plover' })).id;
    await mergeDirect(h, t.teamId, merged, kept, t.adminId);

    const search = await asStaff('/v1/patients/search', { name: 'Rook', surface: 'portal' });
    expect((search.body.hits as { patientId: string }[]).map((x) => x.patientId)).toContain(kept);
    const match = await asStaff('/v1/patients/match', { preferredName: 'Rook', surface: 'portal' });
    expect(match.status).toBe(200);
    // Offline, before the phone learned of the merge: a search that showed the merged record, and
    // a chart read under its ID.
    const offline = [
      await phone.change({
        entity: 'audit',
        op: 'append',
        value: {
          action: 'patient.searched',
          patientIds: [merged],
          resultCount: 1,
          criteria: ['name'],
          source: 'team_index',
        },
      }),
      await phone.change({
        entity: 'audit',
        op: 'append',
        value: { action: 'patient.viewed', patientId: merged, source: 'cache' },
      }),
    ];
    expect(results((await push(h, phone, t.aToken, t.teamId, offline)).body).map((r) => r.status)).toEqual([
      'accepted',
      'accepted',
    ]);
    // Someone else's search, which never showed this person.
    await asStaff('/v1/patients/search', { name: 'Plover', surface: 'portal' });

    for (const asked of [kept, merged]) {
      const entries = await entriesFor(asked);
      const named = (e: (typeof entries)[number]) =>
        e.patientId === kept ||
        e.patientId === merged ||
        ((e.details.patientIds as string[] | undefined) ?? []).some((id) => id === kept || id === merged);
      expect(entries.every(named), 'every entry names the person').toBe(true);
      const actions = entries.map((e) => e.action);
      expect(actions).toContain('patient.match_checked');
      expect(
        entries.filter((e) => e.action === 'patient.searched' && e.details.offline !== true),
      ).toHaveLength(1);
      expect(
        entries.filter((e) => e.action === 'patient.searched' && e.details.offline === true),
      ).toHaveLength(1);
      expect(entries.filter((e) => e.action === 'patient.viewed' && e.patientId === merged)).toHaveLength(1);
    }
    const others = await entriesFor(other);
    expect(others.map((e) => e.action)).toEqual(['patient.searched']);
  });
});
