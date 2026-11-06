import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { createPatient, createTeam, memberWith, mergeDirect } from './patient-fixtures.ts';

// The shared helpers other tests build on must leave rows the schema accepts.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('mergeDirect', () => {
  it('leaves the merged record pointing at the survivor, and its group following it', async () => {
    const teamId = await createTeam(h);
    const admin = await memberWith(h, teamId, ['patients.review_duplicates']);
    const survivor = await createPatient(h, teamId, admin.userId, { preferredName: 'Demo Del' });
    const merged = await createPatient(h, teamId, admin.userId, { preferredName: 'Demo Delbert' });
    const earlier = await createPatient(h, teamId, admin.userId, { preferredName: 'Demo Dell' });
    await mergeDirect(h, teamId, earlier.id, merged.id, admin.userId);

    await mergeDirect(h, teamId, merged.id, survivor.id, admin.userId);

    const rows = await h.scratch.owner<
      { id: string; status: string; mergedInto: string | null; canonicalId: string }[]
    >`
      select id, status, merged_into as "mergedInto", canonical_id as "canonicalId" from sineobex.patients where team_id = ${teamId}`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(merged.id)).toMatchObject({
      status: 'merged',
      mergedInto: survivor.id,
      canonicalId: survivor.id,
    });
    expect(byId.get(earlier.id)).toMatchObject({
      status: 'merged',
      mergedInto: merged.id,
      canonicalId: survivor.id,
    });
    expect(byId.get(survivor.id)).toMatchObject({
      status: 'active',
      mergedInto: null,
      canonicalId: survivor.id,
    });
  });
});
