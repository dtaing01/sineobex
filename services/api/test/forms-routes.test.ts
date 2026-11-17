import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixturePresets } from '../../../packages/forms/test/fixtures/presets.ts';
import { createHarness, type Harness } from './harness.ts';

// Definitions on the server (phase 4 design, forms 3). The real presets.json holds nothing until
// the definitions are typed, so the installer reads the made-up fixture note types here.
vi.mock('../../../packages/forms/generated/presets.json', async () => ({ default: await fixturePresets() }));

type Json = Record<string, unknown>;

describe('a new team’s presets', () => {
  let h: Harness;
  let ownerToken: string;
  let presets: Awaited<ReturnType<typeof fixturePresets>>;

  const createTeam = async (name: string) => {
    const res = await h.request('/v1/owner/teams', { method: 'POST', token: ownerToken, json: { name } });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const installed = (teamId: string) =>
    h.scratch.owner<{ key: string; version: number; hash: string; origin: string; presetVersion: number }[]>`
      select key, version, hash, origin, preset_version as "presetVersion"
      from sineobex.note_type_versions where team_id = ${teamId} order by key, version`;

  beforeAll(async () => {
    presets = await fixturePresets();
    expect(presets.length).toBeGreaterThanOrEqual(2);
    h = await createHarness();
    await h.seedOwner('forms-owner@example.com', 'Forms Owner');
    ownerToken = await h.tokenFor('forms-owner@example.com');
  });
  afterAll(() => h.close());

  it('installs every preset when a team is created, and audits it in the team’s chain', async () => {
    const created = await createTeam('Demo Forms Team');
    expect(created.status).toBe(201);
    const teamId = created.body.id as string;
    expect(await installed(teamId)).toEqual(
      presets.map((p) => ({
        key: p.key,
        version: p.version,
        hash: p.hash,
        origin: 'preset',
        presetVersion: p.version,
      })),
    );
    const events = await h.scratch.owner<{ teamId: string | null; details: unknown }[]>`
      select team_id as "teamId", details from sineobex.audit_events
      where action = 'forms.presets_installed' and entity_id = ${teamId}`;
    expect(events).toEqual([
      { teamId, details: { installed: presets.map((p) => ({ key: p.key, version: p.version })) } },
    ]);
  });

  it('gives each team its own rows', async () => {
    const one = (await createTeam('Demo Forms Team One')).body.id as string;
    const two = (await createTeam('Demo Forms Team Two')).body.id as string;
    const rows = await h.scratch.owner<{ teamId: string; count: number }[]>`
      select team_id as "teamId", count(*)::int as count from sineobex.note_type_versions
      where team_id in (${one}, ${two}) group by team_id order by 1`;
    expect(rows.map((r) => r.count)).toEqual([presets.length, presets.length]);
  });

  it('creates no team when its presets cannot be installed: one transaction', async () => {
    // A hash 0017 refuses fails the install, and with it the team, its role and its audit events.
    const { PRESETS } = await import('@sineobex/forms');
    expect(PRESETS).toEqual(presets);
    const first = PRESETS[0] as { hash: string };
    const count = async () =>
      (
        await h.scratch.owner<{ teams: number; events: number }[]>`
        select (select count(*)::int from sineobex.teams) as teams,
               (select count(*)::int from sineobex.audit_events) as events`
      )[0];
    const before = await count();
    const hash = first.hash;
    first.hash = 'not a hash';
    try {
      expect((await createTeam('Demo Forms Team Broken')).status).toBe(500);
    } finally {
      first.hash = hash;
    }
    expect(await count()).toEqual(before);
  });
});
