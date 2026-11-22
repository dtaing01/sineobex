import { PLATFORM, type PlatformEntry, type PresetKind } from '@sineobex/presets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { expectAudit, logSpy, type LogSpy } from './patient-fixtures.ts';

// Team creation gives the new team every platform preset (phase 5 design 5.2), in the transaction
// that makes the team, after its note types, so the platform's maps are checked against them; the
// install is audited as preset.platform_installed in the team's chain, with counts by kind and
// never a preset's key or name (9). db/test/install-team-presets.test.ts holds the installer itself.

type Json = Record<string, unknown>;

/** The version of each origin key a team is given: the newest in the file. */
function newestOf(platform: readonly PlatformEntry[]): PlatformEntry[] {
  const newest = new Map<string, PlatformEntry>();
  for (const e of platform)
    if ((newest.get(e.originKey)?.platformVersion ?? 0) < e.platformVersion) newest.set(e.originKey, e);
  return [...newest.values()];
}
const countByKind = (list: readonly PlatformEntry[]) => {
  const counts: Partial<Record<PresetKind, number>> = {};
  for (const e of list) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return counts;
};

describe('creating a team', () => {
  let h: Harness;
  let spy: LogSpy;
  let ownerId: string;
  let ownerToken: string;
  const newest = newestOf(PLATFORM);

  const createTeam = async (name: string) => {
    const res = await h.request('/v1/owner/teams', { method: 'POST', token: ownerToken, json: { name } });
    return { status: res.status, body: (await res.json()) as Json };
  };
  /** Every row a team's creation writes, counted, in every team. */
  const counts = async () =>
    (
      await h.scratch.owner<Json[]>`
        select (select count(*)::int from sineobex.teams) as teams,
               (select count(*)::int from sineobex.roles) as roles,
               (select count(*)::int from sineobex.note_type_versions) as "noteTypes",
               (select count(*)::int from sineobex.team_preset_state) as states,
               (select count(*)::int from sineobex.team_presets) as heads,
               (select count(*)::int from sineobex.team_preset_versions) as versions,
               (select count(*)::int from sineobex.team_preset_events) as events,
               (select count(*)::int from sineobex.audit_events) as audit`
    )[0]!;
  /** A trigger that fails the statement it fires on while it is there. */
  async function failing(table: string, when: string, run: () => Promise<void>) {
    await h.scratch.owner.unsafe(`
      create function sineobex.test_fail_presets() returns trigger language plpgsql as $$
      begin if ${when} then raise exception 'refused for the test'; end if; return new; end $$;
      create trigger test_fail_presets before insert on sineobex.${table}
        for each row execute function sineobex.test_fail_presets()`);
    try {
      await run();
    } finally {
      await h.scratch.owner.unsafe(`
        drop trigger test_fail_presets on sineobex.${table};
        drop function sineobex.test_fail_presets()`);
    }
  }

  beforeAll(async () => {
    spy = logSpy();
    h = await createHarness({ log: spy.log });
    ownerId = await h.seedOwner('presets-owner@example.com', 'Presets Owner');
    ownerToken = await h.tokenFor('presets-owner@example.com');
  });
  afterAll(() => h.close());

  it('gives the team every platform preset, its maps on the note types just installed, and audits it', async () => {
    const lines = spy.lines.length;
    const created = await createTeam('Demo Presets Team');
    expect(created.status).toBe(201);
    const teamId = created.body.id as string;

    const heads = await h.scratch.owner<Json[]>`
      select kind, origin_key as "originKey", state, current_version as "currentVersion",
             origin_version as "originVersion", platform_latest as "platformLatest", customized,
             revision::int as revision, created_by as "createdBy"
      from sineobex.team_presets where team_id = ${teamId} order by origin_key`;
    expect(heads).toEqual(
      [...newest]
        .sort((a, b) => (a.originKey < b.originKey ? -1 : 1))
        .map((e) => ({
          kind: e.kind,
          originKey: e.originKey,
          state: 'active',
          currentVersion: 1,
          originVersion: e.platformVersion,
          platformLatest: e.platformVersion,
          customized: false,
          revision: 1,
          createdBy: null,
        })),
    );
    // Not one map was skipped: each was checked against the team's own note types.
    expect(heads.filter((r) => r.kind === 'field_supply_map')).toHaveLength(
      newest.filter((e) => e.kind === 'field_supply_map').length,
    );
    const [rows] = await h.scratch.owner<{ versions: number; events: number; revision: string }[]>`
      select (select count(*)::int from sineobex.team_preset_versions where team_id = ${teamId}) as versions,
             (select count(*)::int from sineobex.team_preset_events
              where team_id = ${teamId} and act = 'installed' and reason is null and created_by is null) as events,
             (select revision::text from sineobex.team_preset_state where team_id = ${teamId}) as revision`;
    expect(rows).toEqual({ versions: newest.length, events: newest.length, revision: '1' });

    // Audited in the team's chain, by the owner who made the team, beside the note types' event.
    const [event] = await expectAudit(h, 'preset.platform_installed', { teamId, count: 1 });
    expect(event).toMatchObject({ actorUserId: ownerId, entity: 'team', entityId: teamId, patientId: null });
    expect(event!.details).toEqual({ install: countByKind(newest), update: {}, offer: {}, skipped: {} });
    await expectAudit(h, 'forms.presets_installed', { teamId, count: 1 });
    expect(spy.lines.slice(lines).filter((l) => l.includes('preset.platform_skipped'))).toEqual([]);
  });

  it('logs by count, never by key, a map its note type refuses, and audits it skipped', async () => {
    // Outreach installed with no sections: its two maps name a field it does not have.
    const outreach = newest.filter(
      (e) => e.kind === 'field_supply_map' && (e.body as { noteTypeKey: string }).noteTypeKey === 'outreach',
    );
    expect(outreach.length).toBeGreaterThan(0);
    const lines = spy.lines.length;
    let teamId = '';
    await h.scratch.owner.unsafe(`
      create function sineobex.test_empty_outreach() returns trigger language plpgsql as $$
      begin
        if new.key = 'outreach' then new.definition := jsonb_set(new.definition, '{sections}', '[]'); end if;
        return new;
      end $$;
      create trigger test_empty_outreach before insert on sineobex.note_type_versions
        for each row execute function sineobex.test_empty_outreach()`);
    try {
      const created = await createTeam('Demo Presets Empty Outreach Team');
      expect(created.status).toBe(201);
      teamId = created.body.id as string;
    } finally {
      await h.scratch.owner.unsafe(`
        drop trigger test_empty_outreach on sineobex.note_type_versions;
        drop function sineobex.test_empty_outreach()`);
    }
    const [event] = await expectAudit(h, 'preset.platform_installed', { teamId, count: 1 });
    expect(event!.details).toEqual({
      install: countByKind(newest.filter((e) => !outreach.includes(e))),
      update: {},
      offer: {},
      skipped: { field_supply_map: outreach.length },
    });
    const logged = spy.lines.slice(lines).map((l) => JSON.parse(l) as Json);
    expect(logged.filter((l) => l.event === 'preset.platform_skipped')).toEqual([
      expect.objectContaining({ level: 'error', teamId, count: outreach.length }),
    ]);
    const text = spy.lines.slice(lines).join('\n');
    for (const e of outreach) {
      expect(text).not.toContain(e.originKey);
      expect(text).not.toContain(String(e.body.name));
    }
  });

  it('creates no team when the presets cannot be audited: one transaction', async () => {
    const before = await counts();
    await failing('audit_events', `new.action = 'preset.platform_installed'`, async () => {
      expect((await createTeam('Demo Presets Unaudited Team')).status).toBe(500);
    });
    expect(await counts()).toEqual(before);
  });

  it('creates no team when a preset cannot be written: one transaction', async () => {
    const before = await counts();
    await failing('team_preset_events', 'true', async () => {
      expect((await createTeam('Demo Presets Unwritten Team')).status).toBe(500);
    });
    expect(await counts()).toEqual(before);
  });
});
