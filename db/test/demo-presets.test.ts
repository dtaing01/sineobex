import { installPresets, takeRevision } from '@sineobex/forms';
import {
  BODY_SCHEMAS,
  installTeamPresets,
  presetWriteEffect,
  validatePreset,
  type PresetBody,
  type PresetKind,
  type PresetRef,
} from '@sineobex/presets';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NEIGHBOUR_TEAM_ID } from '../seed/demo-patients.ts';
import { demoPresetId, seedDemoPresets } from '../seed/demo-presets.ts';
import { DEMO_TEAM_ID, SEED_AUTHOR, seed } from '../seed/seed.ts';
import { migrate, setEnvironment } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { makeTeam, makeUser } from './helpers.ts';

// The demo team's own presets in the seed (phase 5 design 13.4, card P1-seed): a made-up item, a
// bundle and a bag, each written as an admin's create is, and held here to the presets package's
// own rules (its schemas, validatePreset and presetWriteEffect) and to 0023. Made-up teams, people
// and presets only.

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
  body: PresetBody;
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

const DEMO = [demoPresetId(1), demoPresetId(2), demoPresetId(3)];

const headsOf = (sql: Sql, teamId: string) => sql<Head[]>`
  select id, kind, name, state, current_version as "currentVersion", origin_key as "originKey",
         origin_version as "originVersion", platform_latest as "platformLatest", customized,
         revision::int as revision, created_by as "createdBy", updated_by as "updatedBy"
  from sineobex.team_presets where team_id = ${teamId} order by origin_key nulls first, id`;
const versionsOf = (sql: Sql, teamId: string) => sql<Version[]>`
  select preset_id as "presetId", version, body, source, created_by as "createdBy"
  from sineobex.team_preset_versions where team_id = ${teamId} order by preset_id, version`;
const eventsOf = (sql: Sql, teamId: string) => sql<Event[]>`
  select preset_id as "presetId", note_type_key as "noteTypeKey", act, version, reason,
         created_by as "createdBy"
  from sineobex.team_preset_events where team_id = ${teamId} order by preset_id, created_at, act`;
const revisionOf = async (sql: Sql, teamId: string) => {
  const [row] = await sql<{ revision: string }[]>`
    select revision from sineobex.team_preset_state where team_id = ${teamId}`;
  return row ? Number(row.revision) : null;
};
/** Every preset row of the team, as JSON, so two runs of the seed can be compared whole. */
const snapshotOf = async (sql: Sql, teamId: string) => {
  const rows = (table: string) =>
    sql<{ row: unknown }[]>`select to_jsonb(t) as row from ${sql(`sineobex.${table}`)} t
                            where team_id = ${teamId} order by to_jsonb(t)::text`;
  return {
    heads: await rows('team_presets'),
    versions: await rows('team_preset_versions'),
    events: await rows('team_preset_events'),
    state: await rows('team_preset_state'),
  };
};
/** The demo presets a team holds: none, or the seed's own. */
const demoHeldBy = async (sql: Sql, teamId: string) =>
  (
    await sql<{ id: string }[]>`
      select id from sineobex.team_presets where team_id = ${teamId} and id in ${sql(DEMO)} order by id`
  ).map((r) => r.id);
const idOf = async (sql: Sql, teamId: string, originKey: string) => {
  const [row] = await sql<{ id: string }[]>`
    select id from sineobex.team_presets where team_id = ${teamId} and origin_key = ${originKey}`;
  return row!.id;
};

/**
 * The team's presets as validatePreset reads them, worked out here from the rows alone: a category
 * carries its own behaviour, an item its category's, any other kind none (PresetRef).
 */
async function refsOf(sql: Sql, teamId: string): Promise<Record<string, PresetRef>> {
  const rows = await sql<
    { id: string; kind: PresetKind; state: 'active' | 'archived'; behaviour: string | null }[]
  >`
    select p.id, p.kind, p.state,
           case p.kind when 'order_category' then v.body ->> 'behaviour'
                       when 'item' then cv.body ->> 'behaviour' end as behaviour
    from sineobex.team_presets p
    join sineobex.team_preset_versions v
      on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    left join sineobex.team_presets c
      on p.kind = 'item' and c.team_id = p.team_id and c.kind = 'order_category'
         and c.id::text = v.body ->> 'categoryId'
    left join sineobex.team_preset_versions cv
      on cv.team_id = c.team_id and cv.preset_id = c.id and cv.version = c.current_version
    where p.team_id = ${teamId}`;
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      (r.behaviour === null
        ? { kind: r.kind, state: r.state }
        : { kind: r.kind, state: r.state, behaviour: r.behaviour }) as PresetRef,
    ]),
  );
}

describe('the demo team’s own presets in the seed', () => {
  let db: ScratchDatabase;
  let author: string;
  let afterFirst: Awaited<ReturnType<typeof snapshotOf>>;
  let secondLog: string[];
  let heads: Head[];
  let versions: Version[];
  let events: Event[];
  const own = <T extends { presetId: string | null }>(rows: T[]) =>
    rows.filter((r) => DEMO.includes(r.presetId!));

  beforeAll(async () => {
    db = await createScratchDatabase();
    await seed(db.owner);
    afterFirst = await snapshotOf(db.owner, DEMO_TEAM_ID);
    secondLog = [];
    await seed(db.owner, { log: (line) => secondLog.push(line) });
    const [user] = await db.owner<{ id: string }[]>`
      select id from sineobex.users where email = ${SEED_AUTHOR.email}`;
    author = user!.id;
    heads = await headsOf(db.owner, DEMO_TEAM_ID);
    versions = await versionsOf(db.owner, DEMO_TEAM_ID);
    events = await eventsOf(db.owner, DEMO_TEAM_ID);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('writes a made-up item, a bundle and a bag, each named "Demo: …", as a person’s create', () => {
    const created = presetWriteEffect({
      act: 'create',
      kind: 'item',
      state: null,
      baseVersion: null,
      currentVersion: null,
      changedFixed: false,
      sameBody: false,
      referencedBy: {},
      archivedRefs: 0,
      nameTaken: false,
      updateOnOffer: false,
      updateChangesFixed: false,
    });
    if ('refuse' in created) throw new Error(`a create is refused: ${created.refuse}`);
    const { stateAfter, versionAfter, customizedAfter } = created;
    // The team's own presets are these three, and nothing else is.
    const teams = heads.filter((h) => h.originKey === null);
    expect(teams.map((h) => [h.id, h.kind, h.name])).toEqual([
      [demoPresetId(1), 'item', 'Demo: Rain poncho'],
      [demoPresetId(2), 'bundle', 'Demo: Rainy night'],
      [demoPresetId(3), 'bag', 'Demo: Outreach backpack'],
    ]);
    for (const h of teams)
      expect(h, h.name).toMatchObject({
        state: stateAfter,
        currentVersion: versionAfter,
        customized: customizedAfter,
        originVersion: null,
        platformLatest: null,
        createdBy: author,
        updatedBy: author,
      });
  });

  it('gives each its version 1 as the team’s, and that version its created event, with a reason, by the seed’s made-up author', () => {
    expect(own(versions).map((v) => [v.presetId, v.version, v.source, v.createdBy])).toEqual(
      DEMO.map((id) => [id, 1, 'team', author]),
    );
    expect(own(events).map((e) => [e.presetId, e.act, e.version, e.noteTypeKey, e.createdBy])).toEqual(
      DEMO.map((id) => [id, 'created', 1, null, author]),
    );
    for (const e of own(events)) {
      // As the routes keep a reason: trimmed, 3 to 300 characters; made up, so it says so.
      expect(e.reason, e.presetId!).toBe(e.reason!.trim());
      expect([...e.reason!].length, e.presetId!).toBeGreaterThanOrEqual(3);
      expect([...e.reason!].length, e.presetId!).toBeLessThanOrEqual(300);
      expect(e.reason, e.presetId!).toMatch(/^Demo: /);
    }
  });

  it('writes bodies that pass their schemas and validatePreset against the team’s presets', async () => {
    const refs = await refsOf(db.owner, DEMO_TEAM_ID);
    for (const id of DEMO) {
      const head = heads.find((h) => h.id === id)!;
      const { body } = versions.find((v) => v.presetId === id)!;
      // Nothing is left to a default: what is stored is what the schema reads.
      expect(BODY_SCHEMAS[head.kind].parse(body), head.name).toEqual(body);
      expect(body.name, head.name).toBe(head.name);
      expect(validatePreset({ kind: head.kind, body, refs, definitions: {}, id }), head.name).toEqual([]);
    }
  });

  it('puts the item in the platform’s Supplies, and the item in the bundle and the bag beside the platform’s items', async () => {
    const team = (originKey: string) => idOf(db.owner, DEMO_TEAM_ID, originKey);
    const bodyOf = (id: string) => versions.find((v) => v.presetId === id)!.body;
    expect(bodyOf(demoPresetId(1))).toEqual({
      name: 'Demo: Rain poncho',
      categoryId: await team('order_category.supplies'),
      unit: 'each',
      medical: false,
      captureLot: false,
      result: null,
    });
    expect(bodyOf(demoPresetId(2))).toEqual({
      name: 'Demo: Rainy night',
      medical: false,
      prompt: 'Demo: Ask whether they have somewhere dry to sleep before giving this bundle.',
      lines: [
        { itemId: demoPresetId(1), qty: 1, core: true },
        { itemId: await team('item.socks'), qty: 1, core: true },
        { itemId: await team('item.handwarmers'), qty: 2, core: false },
      ],
    });
    expect(bodyOf(demoPresetId(3))).toEqual({
      name: 'Demo: Outreach backpack',
      minimums: [
        { itemId: demoPresetId(1), min: 4 },
        { itemId: await team('item.socks'), min: 10 },
        { itemId: await team('item.gauze'), min: 20 },
        { itemId: await team('item.bandage'), min: 20 },
        { itemId: await team('item.naloxone_kit'), min: 2 },
      ],
    });
  });

  it('stamps all three with one revision, the next after the platform’s install, leaving no gap', async () => {
    const platform = heads.filter((h) => h.originKey !== null);
    // The note type installer takes the team's first revision, the preset installer its second.
    expect(new Set(platform.map((h) => h.revision))).toEqual(new Set([2]));
    expect(heads.filter((h) => DEMO.includes(h.id)).map((h) => h.revision)).toEqual([3, 3, 3]);
    expect(await revisionOf(db.owner, DEMO_TEAM_ID)).toBe(3);
    // Every revision the team has taken is one a head carries, a note type's or a preset's: none was
    // taken for nothing.
    const noteTypes = await db.owner<{ revision: number }[]>`
      select revision::int as revision from sineobex.note_types where team_id = ${DEMO_TEAM_ID}`;
    expect([...new Set([...noteTypes, ...heads].map((h) => h.revision))].sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
  });

  it('writes nothing on a second run: no row, no event, no revision', async () => {
    expect(await snapshotOf(db.owner, DEMO_TEAM_ID)).toEqual(afterFirst);
    expect(secondLog).toContain('  0 made-up preset(s)');
  });

  it('gives the neighbouring team none of them, and audits none of it', async () => {
    expect((await headsOf(db.owner, NEIGHBOUR_TEAM_ID)).filter((h) => h.originKey === null)).toEqual([]);
    expect(await revisionOf(db.owner, NEIGHBOUR_TEAM_ID)).toBe(2);
    const audited = await db.owner<{ n: number }[]>`
      select count(*)::int as n from sineobex.audit_events
      where action like 'preset.%' or entity = 'preset' or entity_id in ${db.owner(DEMO)}`;
    expect(audited).toEqual([{ n: 0 }]);
  });
});

describe('where the seed writes none of them', () => {
  let db: ScratchDatabase;
  let author: string;

  const asPlatform = <T>(run: (tx: TransactionSql) => Promise<T>) =>
    db.owner.begin(async (tx) => {
      await tx`select set_config('app.scope', 'platform', true)`;
      return run(tx);
    }) as Promise<T>;
  const demoPresets = (teamId: string) => asPlatform((tx) => seedDemoPresets(tx, teamId, author));
  /** A team with the platform's note types and presets, as team creation gives them. */
  async function platformTeam(name: string) {
    const team = await makeTeam(db.owner, name);
    await asPlatform(async (tx) => {
      await installPresets(tx, team);
      await installTeamPresets(tx, team);
    });
    return team;
  }

  // An admin's acts, as the routes write them: one revision each, and the act's event.
  /** A create: its head, its version 1 and its event. */
  async function createAsTeam(
    tx: Sql | TransactionSql,
    teamId: string,
    kind: PresetKind,
    body: { name: string },
  ) {
    const revision = await takeRevision(tx, teamId);
    const [head] = await tx<{ id: string }[]>`
      insert into sineobex.team_presets (team_id, kind, name, current_version, revision, created_by, updated_by)
      values (${teamId}, ${kind}, ${body.name}, 1, ${revision}, ${author}, ${author}) returning id`;
    await tx`
      insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source, created_by)
      values (${teamId}, ${head!.id}, 1, ${tx.json(body as never)}, 'team', ${author})`;
    await tx`
      insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
      values (${teamId}, ${head!.id}, 'created', 1, 'Demo: the team’s own', ${author})`;
    return head!.id;
  }
  /** An edit: a team version, the head customized, its event. */
  async function editAsTeam(tx: TransactionSql, teamId: string, id: string, body: { name: string }) {
    const revision = await takeRevision(tx, teamId);
    const [head] = await tx<{ version: number }[]>`
      update sineobex.team_presets set current_version = current_version + 1, name = ${body.name},
        customized = true, revision = ${revision}, updated_by = ${author}
      where team_id = ${teamId} and id = ${id} returning current_version as version`;
    await tx`
      insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source, created_by)
      values (${teamId}, ${id}, ${head!.version}, ${tx.json(body as never)}, 'team', ${author})`;
    await tx`
      insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
      values (${teamId}, ${id}, 'updated', ${head!.version}, 'Demo: the team rewrote it', ${author})`;
  }
  /** A Remove: archived, customized, its event. */
  async function archiveAsTeam(tx: TransactionSql, teamId: string, id: string) {
    const revision = await takeRevision(tx, teamId);
    const [head] = await tx<{ version: number }[]>`
      update sineobex.team_presets set state = 'archived', customized = true, revision = ${revision},
        updated_by = ${author}
      where team_id = ${teamId} and id = ${id} returning current_version as version`;
    await tx`
      insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
      values (${teamId}, ${id}, 'archived', ${head!.version}, 'Demo: no longer carried', ${author})`;
  }
  /** A bag under the demo bag's name in capitals, which the database's lower() makes the same name. */
  const BAG = { name: 'DEMO: OUTREACH BACKPACK', minimums: [] };

  beforeAll(async () => {
    db = await createScratchDatabase();
    author = await makeUser(db.owner, 'demo-presets-author@example.com');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('writes none, and takes no revision, where the team lacks a platform preset they name', async () => {
    const team = await makeTeam(db.owner, 'Demo Presets No Platform Team');
    expect(await demoPresets(team)).toEqual({
      presets: 0,
      skipped: 'the team does not hold every platform preset they name',
    });
    expect(await headsOf(db.owner, team)).toEqual([]);
    expect(await revisionOf(db.owner, team)).toBeNull();
  });

  it('writes none where one would name an archived preset, as a create is refused (reference_archived)', async () => {
    const team = await platformTeam('Demo Presets Archived Socks Team');
    const socks = await idOf(db.owner, team, 'item.socks');
    // Straight to the archive: the routes would first have the platform's bundle and map that name
    // the socks archived. The seed reads only what the team holds.
    await asPlatform((tx) => archiveAsTeam(tx, team, socks));
    const before = await snapshotOf(db.owner, team);
    expect(await demoPresets(team)).toEqual({
      presets: 0,
      skipped: 'the bundle would be refused (reference_archived)',
    });
    expect(await demoHeldBy(db.owner, team)).toEqual([]);
    expect(await snapshotOf(db.owner, team)).toEqual(before);
  });

  it('writes none where a body is invalid against the team’s presets: socks the team moved into OTC', async () => {
    const team = await platformTeam('Demo Presets Medication Socks Team');
    const socks = await idOf(db.owner, team, 'item.socks');
    const otc = await idOf(db.owner, team, 'order_category.otc');
    // An edit the routes allow: an item may change category, and in OTC it is Medical.
    const moved = {
      name: 'Socks',
      categoryId: otc,
      unit: 'each',
      medical: true,
      captureLot: false,
      result: null,
    };
    await asPlatform((tx) => editAsTeam(tx, team, socks, moved));
    const before = await snapshotOf(db.owner, team);
    // A Non-Medical bundle may hold no medication (PRD main 447).
    expect(await demoPresets(team)).toEqual({
      presets: 0,
      skipped: 'the bundle is invalid against the presets the team holds (bundle_not_medical)',
    });
    expect(await demoHeldBy(db.owner, team)).toEqual([]);
    expect(await snapshotOf(db.owner, team)).toEqual(before);
  });

  it('writes none where another active preset of the kind holds a name, as the database compares names', async () => {
    const team = await platformTeam('Demo Presets Name Taken Team');
    await asPlatform((tx) => createAsTeam(tx, team, 'bag', BAG));
    const before = await snapshotOf(db.owner, team);
    // The bag is planned last: the item and the bundle before it are not written either.
    expect(await demoPresets(team)).toEqual({ presets: 0, skipped: 'the bag would be refused (name_taken)' });
    expect(await demoHeldBy(db.owner, team)).toEqual([]);
    expect(await snapshotOf(db.owner, team)).toEqual(before);
  });

  it('plans only once it holds the team lock: it waits for a writer holding it, then sees what that writer wrote', async () => {
    const team = await platformTeam('Demo Presets Waits Team');
    const writer = await db.owner.reserve();
    let run: Promise<unknown> | undefined;
    try {
      await writer`begin`;
      await writer`select set_config('app.scope', 'platform', true)`;
      await createAsTeam(writer, team, 'bag', BAG);
      // Its outcome is taken at once, so a failure while the writer holds the lock is heard.
      run = demoPresets(team).then(
        (result) => result,
        (e: unknown) => e,
      );
      await someoneWaitsForTheLock(db.owner);
      expect(await demoHeldBy(db.owner, team)).toEqual([]);
      await writer`commit`;
    } finally {
      await writer`rollback`.catch(() => null);
      writer.release();
    }
    // Had it read before the writer committed, it would have planned all three, taken a revision
    // and met the writer's bag at the unique name, failing the seed.
    expect(await run).toEqual({ presets: 0, skipped: 'the bag would be refused (name_taken)' });
    expect(await demoHeldBy(db.owner, team)).toEqual([]);
    // The two installers' steps, then the writer's, and none of the seed's.
    expect(await revisionOf(db.owner, team)).toBe(3);
  });

  // The seed's IDs are fixed, and a preset's ID is its own across every team: this case writes
  // them, so it comes last.
  it('counts only an active preset’s name as taken: one the team archived frees it', async () => {
    const team = await platformTeam('Demo Presets Archived Name Team');
    const bag = await asPlatform((tx) => createAsTeam(tx, team, 'bag', BAG));
    await asPlatform((tx) => archiveAsTeam(tx, team, bag));
    expect(await demoPresets(team)).toEqual({ presets: 3 });
    expect(await demoHeldBy(db.owner, team)).toEqual(DEMO);
    // The note types installed at 1 and the presets at 2, the bag made at 3 and archived at 4, and
    // the three at 5.
    expect(await revisionOf(db.owner, team)).toBe(5);
  });
});

/** Until a session of the database waits on an advisory lock, the team lock. */
async function someoneWaitsForTheLock(sql: Sql) {
  for (let i = 0; i < 500; i++) {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
    if (row!.n > 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('nobody waited on the team lock');
}

describe('the demo presets in the preview', () => {
  it('are there too, by the seed’s made-up author: unlike the visits, they need no seeded staff', async () => {
    const preview = await createScratchDatabase({ migrate: false });
    try {
      await migrate(preview.owner);
      await setEnvironment(preview.owner, 'preview');
      await seed(preview.owner);
      const [user] = await preview.owner<{ id: string }[]>`
        select id from sineobex.users where email = ${SEED_AUTHOR.email}`;
      const heads = (await headsOf(preview.owner, DEMO_TEAM_ID)).filter((h) => DEMO.includes(h.id));
      expect(heads.map((h) => [h.id, h.createdBy])).toEqual(DEMO.map((id) => [id, user!.id]));
    } finally {
      await preview.drop();
    }
  });
});
