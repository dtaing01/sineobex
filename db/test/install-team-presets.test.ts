import { installPresets, takeRevision, type InstallSql } from '@sineobex/forms';
import {
  BODY_SCHEMAS,
  installTeamPresets,
  PLATFORM,
  type PlatformEntry,
  type PresetKind,
} from '@sineobex/presets';
import postgres, { type ReservedSql, type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser } from './helpers.ts';

// installTeamPresets (phase 5 design 5.2; D133) against 0023: every platform entry a team lacks is
// installed, an entry it holds at the platform's version is skipped, a copy it never edited is
// updated, and an edited or archived copy, or one whose fixed field the platform changes, is only
// offered. Each install and update writes its team_preset_events row with no reason and no author;
// an offer writes none. A run takes one revision, plans again under the team lock, writes nothing
// a second time, leaves other teams alone, and skips and counts what validatePreset refuses. The
// plan itself is held in packages/presets/test/install.test.ts. Made-up teams, people and presets.
//
// The signature these tests call (P0-install), from '@sineobex/presets':
//
//   export function installTeamPresets(
//     sql: InstallSql,
//     teamId: string,
//     options?: { platform?: readonly PlatformEntry[]; newId?: () => string },
//   ): Promise<TeamPresetsInstalled>;
//   // TeamPresetsInstalled: Record<'install' | 'update' | 'offer' | 'skipped', Partial<Record<PresetKind, number>>>

type Head = {
  id: string;
  kind: PresetKind;
  name: string;
  state: string;
  currentVersion: number;
  originKey: string | null;
  originVersion: number | null;
  platformLatest: number | null;
  customized: boolean;
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
};
type Version = {
  presetId: string;
  version: number;
  body: Record<string, unknown>;
  source: string;
  createdBy: string | null;
};
type Event = {
  presetId: string | null;
  noteTypeKey: string | null;
  act: string;
  version: number;
  reason: string | null;
  createdBy: string | null;
};

const NONE = { install: {}, update: {}, offer: {}, skipped: {} };

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
/** A platform body with each origin key it names put as the team's id for that key. */
function withTeamIds(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => withTeamIds(v, ids));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withTeamIds(v, ids)]));
  return value;
}

// A small made-up platform, whose versions these tests number and change.
const CATEGORY: PlatformEntry = {
  originKey: 'order_category.demo_supplies',
  platformVersion: 1,
  kind: 'order_category',
  body: { name: 'Demo: Supplies', behaviour: 'supply', sort: 10 },
};
const GAUZE: PlatformEntry = {
  originKey: 'item.demo_gauze',
  platformVersion: 1,
  kind: 'item',
  body: {
    name: 'Demo: Gauze',
    categoryId: 'order_category.demo_supplies',
    unit: 'each',
    medical: false,
    captureLot: false,
    result: null,
  },
};
const SOCKS: PlatformEntry = {
  originKey: 'item.demo_socks',
  platformVersion: 1,
  kind: 'item',
  body: {
    name: 'Demo: Socks',
    categoryId: 'order_category.demo_supplies',
    unit: 'pair',
    medical: false,
    captureLot: false,
    result: null,
  },
};
const BUNDLE: PlatformEntry = {
  originKey: 'bundle.demo_wound',
  platformVersion: 1,
  kind: 'bundle',
  body: {
    name: 'Demo: Wound bundle',
    medical: false,
    prompt: '',
    lines: [{ itemId: 'item.demo_gauze', qty: 2, core: true }],
  },
};
const FROST: PlatformEntry = {
  originKey: 'flag.demo_frost',
  platformVersion: 1,
  kind: 'flag',
  body: {
    name: 'Demo: Frost risk',
    tier: 'secondary',
    criteria: '',
    color: 'blue',
    rank: 10,
    sensitive: false,
  },
};
const HEAT: PlatformEntry = {
  originKey: 'flag.demo_heat',
  platformVersion: 1,
  kind: 'flag',
  body: {
    name: 'Demo: Heat risk',
    tier: 'secondary',
    criteria: '',
    color: 'orange',
    rank: 20,
    sensitive: false,
  },
};
const next = (entry: PlatformEntry, change: Record<string, unknown>): PlatformEntry => ({
  ...entry,
  platformVersion: entry.platformVersion + 1,
  body: { ...entry.body, ...change },
});

describe('installing the platform presets', () => {
  let db: ScratchDatabase;
  let app: Sql;
  let user: string;

  const asPlatform = <T>(run: (tx: InstallSql) => Promise<T>) =>
    asApp(db.appUrl, { userId: user, platform: true }, (tx) => run(tx));
  const asTeam = <T>(teamId: string, run: (tx: TransactionSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: user }, run);

  const headsOf = (teamId: string) =>
    db.owner<Head[]>`
      select id, kind, name, state, current_version as "currentVersion", origin_key as "originKey",
             origin_version as "originVersion", platform_latest as "platformLatest", customized,
             revision::int as revision, created_by as "createdBy", updated_by as "updatedBy"
      from sineobex.team_presets where team_id = ${teamId} order by origin_key, id`;
  const versionsOf = (teamId: string) =>
    db.owner<Version[]>`
      select preset_id as "presetId", version, body, source, created_by as "createdBy"
      from sineobex.team_preset_versions where team_id = ${teamId} order by preset_id, version`;
  const eventsOf = (teamId: string) =>
    db.owner<Event[]>`
      select preset_id as "presetId", note_type_key as "noteTypeKey", act, version, reason,
             created_by as "createdBy"
      from sineobex.team_preset_events where team_id = ${teamId} order by created_at, preset_id, act`;
  const revisionOf = async (teamId: string) => {
    const [row] = await db.owner<{ revision: string }[]>`
      select revision from sineobex.team_preset_state where team_id = ${teamId}`;
    return row ? Number(row.revision) : null;
  };
  const snapshot = async (teamId: string) => ({
    heads: await headsOf(teamId),
    versions: await versionsOf(teamId),
    events: await eventsOf(teamId),
    revision: await revisionOf(teamId),
  });
  const byOrigin = async (teamId: string) => new Map((await headsOf(teamId)).map((h) => [h.originKey!, h]));

  /** An admin's edit, as P1's route writes one: a team version, the head customized, its event. */
  async function editAsTeam(teamId: string, presetId: string, body: Record<string, unknown>) {
    await asTeam(teamId, async (tx) => {
      const revision = await takeRevision(tx, teamId);
      const [head] = await tx<{ current: number }[]>`
        select current_version as current from sineobex.team_presets where team_id = ${teamId} and id = ${presetId}`;
      const version = head!.current + 1;
      await tx`
        insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source, created_by)
        values (${teamId}, ${presetId}, ${version}, ${tx.json(body as never)}, 'team', ${user})`;
      await tx`
        update sineobex.team_presets set current_version = ${version}, name = ${body.name as string},
          customized = true, revision = ${revision}, updated_by = ${user}
        where team_id = ${teamId} and id = ${presetId}`;
      await tx`
        insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
        values (${teamId}, ${presetId}, 'updated', ${version}, 'Demo: the team rewrote it', ${user})`;
    });
  }
  /** An admin's Remove: archived, customized, its event. */
  async function archiveAsTeam(teamId: string, presetId: string) {
    await asTeam(teamId, async (tx) => {
      const revision = await takeRevision(tx, teamId);
      const [head] = await tx<{ current: number }[]>`
        update sineobex.team_presets set state = 'archived', customized = true, revision = ${revision},
          updated_by = ${user}
        where team_id = ${teamId} and id = ${presetId} returning current_version as current`;
      await tx`
        insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
        values (${teamId}, ${presetId}, 'archived', ${head!.current}, 'Demo: no longer carried', ${user})`;
    });
  }

  /** A writer of `teamId` that has begun and not committed, as the app role in the team's scope. */
  async function openWriter(teamId: string) {
    const conn: ReservedSql = await app.reserve();
    await conn`begin`;
    await conn`set local lock_timeout = '10s'`;
    await conn`select set_config('app.team_id', ${teamId}, true), set_config('app.user_id', ${user}, true),
                      set_config('app.scope', '', true)`;
    let open = true;
    const end = async (how: 'commit' | 'rollback') => {
      if (!open) return;
      open = false;
      try {
        await (how === 'commit' ? conn`commit` : conn`rollback`);
      } finally {
        conn.release();
      }
    };
    return { conn, commit: () => end('commit'), rollback: () => end('rollback') };
  }
  async function someoneWaitsForTheLock() {
    for (let i = 0; i < 500; i++) {
      const [row] = await db.owner<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
      if (row!.n > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('no installer waited for the team lock');
  }

  beforeAll(async () => {
    db = await createScratchDatabase();
    app = postgres(db.appUrl, { max: 4, onnotice: () => {} });
    user = await makeUser(db.owner, 'preset-installer@example.com');
  });
  afterAll(async () => {
    await app.end({ timeout: 5 });
    await db.drop();
  });

  describe('the platform data', () => {
    it('gives a new team every entry: a head, its first version as the platform wrote it, and its event, under one revision', async () => {
      const team = await makeTeam(db.owner, 'Install Presets New Team');
      const counts = await asPlatform(async (tx) => {
        await installPresets(tx, team);
        return installTeamPresets(tx, team);
      });
      const newest = newestOf(PLATFORM);
      expect(counts).toEqual({ install: countByKind(newest), update: {}, offer: {}, skipped: {} });

      const heads = await headsOf(team);
      expect(heads.map((h) => h.originKey).sort()).toEqual(newest.map((e) => e.originKey).sort());
      const entryOf = new Map(newest.map((e) => [e.originKey, e]));
      for (const h of heads) {
        const e = entryOf.get(h.originKey!)!;
        expect(h, h.originKey!).toMatchObject({
          kind: e.kind,
          name: e.body.name,
          state: 'active',
          currentVersion: 1,
          originVersion: e.platformVersion,
          platformLatest: e.platformVersion,
          customized: false,
          revision: 1,
          createdBy: null,
          updatedBy: null,
        });
      }
      expect(await revisionOf(team)).toBe(1);

      // Each body as the platform wrote it, every origin key it names put as the team's own id.
      const ids = new Map(heads.map((h) => [h.originKey!, h.id]));
      const versions = await versionsOf(team);
      expect(versions).toHaveLength(heads.length);
      for (const v of versions) {
        const h = heads.find((x) => x.id === v.presetId)!;
        expect(v, h.originKey!).toMatchObject({ version: 1, source: 'platform', createdBy: null });
        expect(v.body, h.originKey!).toEqual(withTeamIds(entryOf.get(h.originKey!)!.body, ids));
        expect(BODY_SCHEMAS[h.kind].parse(v.body), h.originKey!).toEqual(v.body);
      }

      // An installed event for each, with no reason and no author.
      const events = await eventsOf(team);
      expect(events.map((e) => e.presetId).sort()).toEqual(heads.map((h) => h.id).sort());
      for (const e of events)
        expect(e).toMatchObject({
          noteTypeKey: null,
          act: 'installed',
          version: 1,
          reason: null,
          createdBy: null,
        });
    });

    it('changes nothing when it runs again: no row, no event, no revision', async () => {
      const team = await makeTeam(db.owner, 'Install Presets Twice Team');
      await asPlatform(async (tx) => {
        await installPresets(tx, team);
        await installTeamPresets(tx, team);
      });
      const before = await snapshot(team);
      expect(await asTeam(team, (tx) => installTeamPresets(tx, team))).toEqual(NONE);
      expect(await asPlatform((tx) => installTeamPresets(tx, team))).toEqual(NONE);
      expect(await snapshot(team)).toEqual(before);
    });

    it('skips and counts every map when the team holds none of the note types they name', async () => {
      const team = await makeTeam(db.owner, 'Install Presets No Note Types Team');
      const newest = newestOf(PLATFORM);
      const maps = newest.filter((e) => e.kind === 'field_supply_map');
      expect(maps.length).toBeGreaterThan(0);
      const counts = await asPlatform((tx) => installTeamPresets(tx, team));
      expect(counts).toEqual({
        install: countByKind(newest.filter((e) => e.kind !== 'field_supply_map')),
        update: {},
        offer: {},
        skipped: { field_supply_map: maps.length },
      });
      expect((await headsOf(team)).some((h) => h.kind === 'field_supply_map')).toBe(false);
    });
  });

  describe('teams', () => {
    it('leaves a second team alone, and gives each team its own ids', async () => {
      const first = await makeTeam(db.owner, 'Install Presets First Team');
      const second = await makeTeam(db.owner, 'Install Presets Second Team');
      await asPlatform((tx) => installTeamPresets(tx, first, { platform: [CATEGORY, GAUZE, BUNDLE] }));
      expect(await snapshot(second)).toEqual({ heads: [], versions: [], events: [], revision: null });
      const firstBefore = await snapshot(first);
      await asPlatform((tx) => installTeamPresets(tx, second, { platform: [CATEGORY, GAUZE, BUNDLE] }));
      expect(await snapshot(first)).toEqual(firstBefore);
      const firstIds = new Set(firstBefore.heads.map((h) => h.id));
      const secondHeads = await headsOf(second);
      expect(secondHeads).toHaveLength(3);
      for (const h of secondHeads) expect(firstIds.has(h.id), h.originKey!).toBe(false);
      // The second team's bundle names the second team's gauze.
      const gauze = secondHeads.find((h) => h.originKey === GAUZE.originKey)!;
      const bundle = (await versionsOf(second)).find(
        (v) => v.presetId === secondHeads.find((h) => h.originKey === BUNDLE.originKey)!.id,
      )!;
      expect(bundle.body.lines).toEqual([{ itemId: gauze.id, qty: 2, core: true }]);
    });

    it('installs in the team’s own scope, as the pull does, and never into another team', async () => {
      const team = await makeTeam(db.owner, 'Install Presets Own Scope Team');
      const other = await makeTeam(db.owner, 'Install Presets Other Scope Team');
      expect(
        await asTeam(team, (tx) => installTeamPresets(tx, team, { platform: [CATEGORY, GAUZE] })),
      ).toEqual({
        install: { order_category: 1, item: 1 },
        update: {},
        offer: {},
        skipped: {},
      });
      await expect(
        asTeam(team, (tx) => installTeamPresets(tx, other, { platform: [CATEGORY, GAUZE] })),
      ).rejects.toThrow();
      expect(await snapshot(other)).toEqual({ heads: [], versions: [], events: [], revision: null });
    });
  });

  describe('a platform update', () => {
    it('updates a copy the team never edited, and only offers it to an edited, archived or fixed-field-changed one', async () => {
      const team = await makeTeam(db.owner, 'Install Presets Update Team');
      const first = [CATEGORY, GAUZE, SOCKS, BUNDLE, FROST, HEAT];
      await asTeam(team, (tx) => installTeamPresets(tx, team, { platform: first }));
      const installed = await byOrigin(team);
      // The team rewrites Frost risk and removes Heat risk, as an admin would in the portal.
      const rewritten = { ...FROST.body, criteria: 'Demo: our own reading of frost risk.' };
      await editAsTeam(team, installed.get(FROST.originKey)!.id, rewritten);
      await archiveAsTeam(team, installed.get(HEAT.originKey)!.id);
      const before = await snapshot(team);
      const revision = before.revision!;

      const second = [
        ...first,
        next(CATEGORY, { name: 'Demo: Supplies and kits' }),
        next(GAUZE, { unit: 'box' }),
        next(BUNDLE, { prompt: 'Demo: look at the wound first.' }),
        next(FROST, { criteria: 'Demo: below freezing overnight.' }),
        next(HEAT, { criteria: 'Demo: above 90 degrees.' }),
      ];
      const counts = await asTeam(team, (tx) => installTeamPresets(tx, team, { platform: second }));
      expect(counts).toEqual({
        install: {},
        update: { order_category: 1, bundle: 1 },
        offer: { item: 1, flag: 2 },
        skipped: {},
      });
      // One revision for the run, stamped on every head it changed, and on no other.
      expect(await revisionOf(team)).toBe(revision + 1);
      const after = await byOrigin(team);
      const changed = [CATEGORY, GAUZE, BUNDLE, FROST, HEAT].map((e) => e.originKey);
      for (const [key, h] of after)
        expect(h.revision, key).toBe(changed.includes(key) ? revision + 1 : installed.get(key)!.revision);

      // Updated: the next version, from the platform, the copy taken from version 2 and still unedited.
      const versions = await versionsOf(team);
      const versionsOfKey = (key: string) => versions.filter((v) => v.presetId === after.get(key)!.id);
      expect(after.get(CATEGORY.originKey)).toMatchObject({
        name: 'Demo: Supplies and kits',
        currentVersion: 2,
        originVersion: 2,
        platformLatest: 2,
        customized: false,
        state: 'active',
      });
      expect(versionsOfKey(CATEGORY.originKey).map((v) => [v.version, v.source, v.createdBy])).toEqual([
        [1, 'platform', null],
        [2, 'platform', null],
      ]);
      expect(versionsOfKey(BUNDLE.originKey).at(-1)!.body).toEqual({
        ...BUNDLE.body,
        prompt: 'Demo: look at the wound first.',
        lines: [{ itemId: after.get(GAUZE.originKey)!.id, qty: 2, core: true }],
      });

      // Offered: only platform_latest moves; the body, the version and the state stay the team's.
      for (const key of [GAUZE.originKey, FROST.originKey, HEAT.originKey]) {
        const was = before.heads.find((h) => h.originKey === key)!;
        expect(after.get(key), key).toEqual({ ...was, platformLatest: 2, revision: revision + 1 });
        expect(versionsOfKey(key), key).toEqual(before.versions.filter((v) => v.presetId === was.id));
      }
      expect(versionsOfKey(FROST.originKey).at(-1)).toMatchObject({ source: 'team', body: rewritten });
      expect(after.get(HEAT.originKey)!.state).toBe('archived');

      // An event for each update, with no reason and no author; none for an offer.
      const events = (await eventsOf(team)).slice(before.events.length);
      expect(events.map((e) => [e.presetId, e.act, e.version, e.reason, e.createdBy]).sort()).toEqual(
        [
          [after.get(CATEGORY.originKey)!.id, 'platform_updated', 2, null, null],
          [after.get(BUNDLE.originKey)!.id, 'platform_updated', 2, null, null],
        ].sort(),
      );

      // An offer is made once: run again, and nothing is written.
      const settled = await snapshot(team);
      expect(await asTeam(team, (tx) => installTeamPresets(tx, team, { platform: second }))).toEqual(NONE);
      expect(await snapshot(team)).toEqual(settled);
    });

    it('skips and counts an entry validatePreset refuses: a new bundle whose item the team archived', async () => {
      const team = await makeTeam(db.owner, 'Install Presets Skipped Team');
      await asTeam(team, (tx) => installTeamPresets(tx, team, { platform: [CATEGORY, GAUZE] }));
      await archiveAsTeam(team, (await byOrigin(team)).get(GAUZE.originKey)!.id);
      const before = await snapshot(team);
      const counts = await asTeam(team, (tx) =>
        installTeamPresets(tx, team, { platform: [CATEGORY, GAUZE, BUNDLE] }),
      );
      expect(counts).toEqual({ install: {}, update: {}, offer: {}, skipped: { bundle: 1 } });
      // Nothing else to write, so nothing is written, and no revision taken.
      expect(await snapshot(team)).toEqual(before);
    });

    it('installs alongside what it skips, in one revision', async () => {
      const team = await makeTeam(db.owner, 'Install Presets Partly Skipped Team');
      await asTeam(team, (tx) => installTeamPresets(tx, team, { platform: [CATEGORY, GAUZE] }));
      await archiveAsTeam(team, (await byOrigin(team)).get(GAUZE.originKey)!.id);
      const revision = (await revisionOf(team))!;
      const counts = await asTeam(team, (tx) =>
        installTeamPresets(tx, team, { platform: [CATEGORY, GAUZE, SOCKS, BUNDLE] }),
      );
      expect(counts).toEqual({ install: { item: 1 }, update: {}, offer: {}, skipped: { bundle: 1 } });
      expect(await revisionOf(team)).toBe(revision + 1);
      expect((await byOrigin(team)).has(BUNDLE.originKey)).toBe(false);
    });
  });

  describe('under the team lock', () => {
    it('plans again once it holds the lock: a second installer at the same moment writes nothing', async () => {
      const team = await makeTeam(db.owner, 'Install Presets At Once Team');
      const platform = [CATEGORY, GAUZE, BUNDLE, FROST];
      const first = await openWriter(team);
      try {
        expect(await installTeamPresets(first.conn, team, { platform })).toEqual({
          install: { order_category: 1, item: 1, bundle: 1, flag: 1 },
          update: {},
          offer: {},
          skipped: {},
        });
        // The second reads before the first commits, so it sees nothing yet, and then waits for the lock.
        const second = (async () => {
          const writer = await openWriter(team);
          try {
            const counts = await installTeamPresets(writer.conn, team, { platform });
            await writer.commit();
            return counts;
          } finally {
            await writer.rollback();
          }
        })();
        await someoneWaitsForTheLock();
        await first.commit();
        expect(await second).toEqual(NONE);
      } finally {
        await first.rollback();
      }
      expect(await headsOf(team)).toHaveLength(platform.length);
      expect(await versionsOf(team)).toHaveLength(platform.length);
      expect(await eventsOf(team)).toHaveLength(platform.length);
      expect(await revisionOf(team)).toBe(1);
    });

    it('waits for a writer holding the team lock before it plans again', async () => {
      const team = await makeTeam(db.owner, 'Install Presets Waits Team');
      const holder = await openWriter(team);
      try {
        await takeRevision(holder.conn, team);
        const install = asTeam(team, (tx) => installTeamPresets(tx, team, { platform: [CATEGORY] }));
        await someoneWaitsForTheLock();
        expect(await headsOf(team)).toEqual([]);
        await holder.commit();
        expect(await install).toEqual({ install: { order_category: 1 }, update: {}, offer: {}, skipped: {} });
      } finally {
        await holder.rollback();
      }
      // The holder's step, then the installer's: no gap, none twice.
      expect(await revisionOf(team)).toBe(2);
      expect((await headsOf(team))[0]!.revision).toBe(2);
    });
  });
});
