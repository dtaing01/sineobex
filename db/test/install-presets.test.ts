import { readFileSync } from 'node:fs';
import {
  canonicalJson,
  installPresets,
  lockTeam,
  PresetDiffers,
  sha256Hex,
  takeRevision,
  type InstallSql,
  type Preset,
  type ResolvedNoteType,
} from '@sineobex/forms';
import postgres, { type ReservedSql, type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixturePresets } from '../../packages/forms/test/fixtures/presets.ts';
import { NEIGHBOUR_TEAM_ID } from '../seed/demo-patients.ts';
import { DEMO_TEAM_ID, installTestNoteTypes, seed } from '../seed/seed.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser } from './helpers.ts';

// installPresets (phase 4 design, forms 3.1 and 3.2) against 0017. Most cases install the made-up
// fixture note types, whose versions they can edit and number; the last installs the released ones.

type Row = { key: string; version: number; hash: string; origin: string; presetVersion: number | null };

describe('installing the presets', () => {
  let db: ScratchDatabase;
  let user: string;
  let presets: Preset[];

  const rowsOf = (teamId: string) =>
    db.owner<(Row & { definition: unknown; createdAt: Date })[]>`
      select key, version, hash, origin, preset_version as "presetVersion", definition,
             created_at as "createdAt"
      from sineobex.note_type_versions where team_id = ${teamId} order by key, version`;
  const asPlatform = <T>(fn: (tx: InstallSql) => Promise<T>) =>
    asApp(db.appUrl, { userId: user, platform: true }, (tx) => fn(tx));
  const asTeam = <T>(teamId: string, fn: (tx: InstallSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: user }, (tx) => fn(tx));
  const keyVersions = (list: readonly { key: string; version: number }[]) =>
    list.map(({ key, version }) => `${key} v${version}`);

  /** The same key and version as `preset`, worded differently: what an edited release would be. */
  async function edited(preset: Preset): Promise<Preset> {
    const definition = { ...preset.definition, title: `${preset.definition.title} (edited)` };
    return { ...preset, definition, hash: await sha256Hex(canonicalJson(definition)) };
  }
  /** The next version of `preset`'s key. */
  async function nextVersion(preset: Preset): Promise<Preset> {
    const definition = { ...preset.definition, version: preset.version + 1 };
    return {
      ...preset,
      version: definition.version,
      definition,
      hash: await sha256Hex(canonicalJson(definition)),
    };
  }

  beforeAll(async () => {
    db = await createScratchDatabase();
    user = await makeUser(db.owner, 'forms-installer@example.com');
    presets = await fixturePresets();
    expect(presets.length).toBeGreaterThanOrEqual(2);
  });
  afterAll(() => db.drop());

  it('gives a new team every preset, each naming the platform version it came from', async () => {
    const team = await makeTeam(db.owner, 'Install Team New');
    const result = await asPlatform((tx) => installPresets(tx, team, { presets }));
    expect(keyVersions(result.installed)).toEqual(keyVersions(presets));
    expect(result.differing).toEqual([]);
    const rows = await rowsOf(team);
    expect(
      rows.map(({ key, version, hash, origin, presetVersion, definition }) => ({
        key,
        version,
        hash,
        origin,
        presetVersion,
        definition,
      })),
    ).toEqual(
      presets.map((p) => ({
        key: p.key,
        version: p.version,
        hash: p.hash,
        origin: 'preset',
        presetVersion: p.version,
        definition: p.definition,
      })),
    );
    // The stored definition hashes to the stored hash: what the server and the phone check.
    for (const row of rows) expect(await sha256Hex(canonicalJson(row.definition))).toBe(row.hash);
  });

  it('changes nothing when it runs again', async () => {
    const team = await makeTeam(db.owner, 'Install Team Twice');
    await asPlatform((tx) => installPresets(tx, team, { presets }));
    const before = await rowsOf(team);
    const again = await asPlatform((tx) => installPresets(tx, team, { presets }));
    expect(again).toEqual({ installed: [], differing: [] });
    expect(await rowsOf(team)).toEqual(before);
  });

  it('installs only what a team lacks: a new platform version joins the ones it has', async () => {
    const team = await makeTeam(db.owner, 'Install Team Later');
    await asPlatform((tx) => installPresets(tx, team, { presets }));
    const later = await nextVersion(presets[0]!);
    const result = await asPlatform((tx) => installPresets(tx, team, { presets: [...presets, later] }));
    expect(keyVersions(result.installed)).toEqual(keyVersions([later]));
    const rows = await rowsOf(team);
    expect(keyVersions(rows)).toEqual(
      keyVersions(
        [...presets, later].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.version - b.version)),
      ),
    );
    expect(rows.find((r) => r.key === later.key && r.version === later.version)).toMatchObject({
      hash: later.hash,
      origin: 'preset',
      presetVersion: later.version,
    });
  });

  it('keeps a team’s rows its own: a team installs its own presets, never another team’s', async () => {
    const teamA = await makeTeam(db.owner, 'Install Team A');
    const teamB = await makeTeam(db.owner, 'Install Team B');
    // In the team's own scope, as the note types route installs a new platform version (3.2).
    await asTeam(teamA, (tx) => installPresets(tx, teamA, { presets }));
    expect(keyVersions(await rowsOf(teamA))).toEqual(keyVersions(presets));
    // Acting in team A, nobody writes into team B, and team B sees none of team A's rows.
    await expect(asTeam(teamA, (tx) => installPresets(tx, teamB, { presets }))).rejects.toThrow(
      /row-level security/,
    );
    expect(await rowsOf(teamB)).toEqual([]);
    const seenByB = await asApp(
      db.appUrl,
      { teamId: teamB, userId: user },
      (tx) => tx<{ teamId: string }[]>`select distinct team_id as "teamId" from sineobex.note_type_versions`,
    );
    expect(seenByB).toEqual([]);
  });

  it('never overwrites a row whose definition differs, and refuses to pass over it in silence', async () => {
    const team = await makeTeam(db.owner, 'Install Team Edited');
    const [first, ...rest] = presets;
    const theirs = await edited(first!);
    await asPlatform((tx) => installPresets(tx, team, { presets: [theirs] }));

    // At team creation and in the seed it throws, naming the key and version, and the caller's
    // transaction writes nothing.
    const thrown = await asPlatform((tx) => installPresets(tx, team, { presets })).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(PresetDiffers);
    expect(keyVersions((thrown as PresetDiffers).differing)).toEqual(keyVersions([first!]));
    expect((thrown as Error).message).toMatch(new RegExp(`${first!.key} v${first!.version}`));
    expect(keyVersions(await rowsOf(team))).toEqual(keyVersions([first!]));

    // Where a throw would fail every sync (the note types route), the key is reported and skipped,
    // every version of it, and every other key is installed.
    const later = await nextVersion(first!);
    const result = await asPlatform((tx) =>
      installPresets(tx, team, { presets: [...presets, later], onDiffer: 'skip' }),
    );
    expect(keyVersions(result.differing)).toEqual(keyVersions([first!]));
    expect(keyVersions(result.installed)).toEqual(keyVersions(rest));
    const rows = await rowsOf(team);
    expect(rows.find((r) => r.key === first!.key)).toMatchObject({ version: 1, hash: theirs.hash });
    expect(rows.filter((r) => r.key === first!.key)).toHaveLength(1);
  });

  it('notices a differing row written by another transaction between its read and its insert', async () => {
    const team = await makeTeam(db.owner, 'Install Team Race');
    const [first] = presets;
    const theirs = await edited(first!);
    // Runs the installer's statements in its transaction, and commits the other transaction's row
    // just before the installer's insert, after its read.
    const racing = (tx: InstallSql): InstallSql =>
      (async (template: TemplateStringsArray, ...values: readonly (string | number)[]) => {
        if (/insert into/.test(template.join('?')))
          await db.owner`insert into sineobex.note_type_versions
                         (team_id, key, version, definition, hash, origin, preset_version)
                         values (${team}, ${theirs.key}, ${theirs.version}, ${db.owner.json(theirs.definition as never)},
                                 ${theirs.hash}, 'preset', ${theirs.version})`;
        return tx(template, ...values);
      }) as InstallSql;

    const thrown = await asPlatform((tx) => installPresets(racing(tx), team, { presets })).catch(
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(PresetDiffers);
    expect(keyVersions((thrown as PresetDiffers).differing)).toEqual(keyVersions([first!]));
    expect((await rowsOf(team)).map((r) => r.hash)).toEqual([theirs.hash]);
  });

  it('runs in the seed for each seeded team, and a second seed changes nothing', async () => {
    await seed(db.owner, { presets });
    const first = [await rowsOf(DEMO_TEAM_ID), await rowsOf(NEIGHBOUR_TEAM_ID)];
    for (const rows of first) {
      expect(keyVersions(rows)).toEqual(keyVersions(presets));
      expect(rows.every((r) => r.origin === 'preset' && r.presetVersion === r.version)).toBe(true);
    }
    await seed(db.owner, { presets });
    expect([await rowsOf(DEMO_TEAM_ID), await rowsOf(NEIGHBOUR_TEAM_ID)]).toEqual(first);
  });

  // Wave D released the nine note types (forms 3.2, 10.1): a team made now starts with every one.
  it('gives a new team the nine released note types when no presets are named', async () => {
    const team = await makeTeam(db.owner, 'Install Team Released');
    const result = await asPlatform((tx) => installPresets(tx, team));
    expect(keyVersions(result.installed)).toEqual([
      'general_primary_care v1',
      'harm_reduction v1',
      'outreach v1',
      'psychological v1',
      'quick_encounter v1',
      'red_flags_disposition v1',
      'sexual_reproductive v1',
      'social_needs v1',
      'wound_care v1',
    ]);
    for (const row of await rowsOf(team))
      expect(await sha256Hex(canonicalJson(row.definition))).toBe(row.hash);
  });
});

describe('installing the test-only note types', () => {
  let db: ScratchDatabase;
  const testTypes = (
    JSON.parse(
      readFileSync(
        new URL('../../packages/contract/test-vectors/sync-note-types.json', import.meta.url),
        'utf8',
      ),
    ) as { noteTypes: ResolvedNoteType[] }
  ).noteTypes;
  const keysOf = async (teamId: string) =>
    (
      await db.owner<{ key: string; version: number; hash: string }[]>`
        select key, version, hash from sineobex.note_type_versions where team_id = ${teamId}`
    ).map((r) => `${r.key} v${r.version}`);

  beforeAll(async () => {
    db = await createScratchDatabase();
  });
  afterAll(() => db.drop());

  it('puts them in the demo team only, each under its own hash, and never in the seed itself', async () => {
    await seed(db.owner, { presets: [] });
    expect(await keysOf(DEMO_TEAM_ID)).toEqual([]);
    await installTestNoteTypes(db.owner, testTypes);
    await installTestNoteTypes(db.owner, testTypes);
    const rows = await db.owner<{ key: string; hash: string; definition: ResolvedNoteType }[]>`
      select key, hash, definition from sineobex.note_type_versions
      where team_id = ${DEMO_TEAM_ID} order by key`;
    expect(rows.map((r) => r.key)).toEqual(['test_medical', 'test_note']);
    for (const r of rows) expect(r.hash).toBe(await sha256Hex(canonicalJson(r.definition)));
    expect(await keysOf(NEIGHBOUR_TEAM_ID)).toEqual([]);
  });

  it('refuses a database not marked "test"', async () => {
    await db.owner`alter table sineobex.environment disable trigger environment_write_once`;
    await db.owner`update sineobex.environment set kind = 'preview'`;
    await expect(installTestNoteTypes(db.owner, testTypes)).rejects.toThrow(/marked "preview"/);
  });
});

// Phase 5 (design 4.3, 5.2; card P4-install), written ahead of its code (card P4-tests): the
// installer decides each key by platformUpdateEffect and writes the team's next version, so a
// team's own version is never overtaken by a platform one, and only a platform row whose
// definition is not the platform's raises PresetDiffers. It upserts the head (0023) of every key it
// installs or updates, gives one to a key the team holds without one, and stamps each with the
// run's one revision, taken under the team lock only when it writes; each install and update has
// its team_preset_events row, with no reason and no author, and an offer has none. The plan itself
// is packages/forms/test/install-update.test.ts's. The cases above, phase 4's, run unchanged.
describe('installing the note types, key by key (phase 5)', () => {
  let db: ScratchDatabase;
  let app: Sql;
  let user: string;
  let presets: Preset[];

  type Head = {
    key: string;
    title: string;
    state: string;
    currentVersion: number;
    platformLatest: number | null;
    customized: boolean;
    revision: number;
    updatedBy: string | null;
  };
  type Version = {
    key: string;
    version: number;
    origin: string;
    presetVersion: number | null;
    hash: string;
    definition: ResolvedNoteType;
  };
  type Event = {
    noteTypeKey: string | null;
    presetId: string | null;
    act: string;
    version: number;
    reason: string | null;
    createdBy: string | null;
  };

  // Keys in code-point order, as the lists the tests build: CI's databases sort text by en_US rules,
  // which pass over '_'.
  const headsOf = (teamId: string) =>
    db.owner<Head[]>`
      select key, title, state, current_version as "currentVersion", platform_latest as "platformLatest",
             customized, revision::int as revision, updated_by as "updatedBy"
      from sineobex.note_types where team_id = ${teamId} order by key collate "C"`;
  const versionsOf = (teamId: string) =>
    db.owner<Version[]>`
      select key, version, origin, preset_version as "presetVersion", hash, definition
      from sineobex.note_type_versions where team_id = ${teamId} order by key collate "C", version`;
  const eventsOf = (teamId: string) =>
    db.owner<Event[]>`
      select note_type_key as "noteTypeKey", preset_id as "presetId", act, version, reason,
             created_by as "createdBy"
      from sineobex.team_preset_events where team_id = ${teamId}
      order by note_type_key collate "C", version, act`;
  const revisionOf = async (teamId: string) => {
    const [row] = await db.owner<{ revision: string }[]>`
      select revision from sineobex.team_preset_state where team_id = ${teamId}`;
    return row ? Number(row.revision) : null;
  };
  const asPlatform = <T>(fn: (tx: InstallSql) => Promise<T>) =>
    asApp(db.appUrl, { userId: user, platform: true }, (tx) => fn(tx));
  const asTeam = <T>(teamId: string, fn: (tx: InstallSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: user }, (tx) => fn(tx));

  /** The platform's next version of a preset, its title changed. */
  async function nextOf(preset: Preset, title?: string): Promise<Preset> {
    const definition = {
      ...preset.definition,
      version: preset.version + 1,
      title: title ?? `${preset.definition.title} (version ${preset.version + 1})`,
    };
    return {
      ...preset,
      version: definition.version,
      definition,
      hash: await sha256Hex(canonicalJson(definition)),
    };
  }

  /**
   * A team's own next version of a key, as a publish writes it (design 5.4): in one transaction,
   * its revision first, then the version, `origin = 'team'`, and the head customized at it.
   */
  async function publishOwn(teamId: string, key: string, title: string): Promise<ResolvedNoteType> {
    return db.owner.begin(async (tx) => {
      const revision = await takeRevision(tx as unknown as InstallSql, teamId);
      const [newest] = await tx<{ definition: ResolvedNoteType }[]>`
        select definition from sineobex.note_type_versions
        where team_id = ${teamId} and key = ${key} order by version desc limit 1`;
      const definition = { ...newest!.definition, version: newest!.definition.version + 1, title };
      await tx`
        insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin)
        values (${teamId}, ${key}, ${definition.version}, ${JSON.stringify(definition)}::text::jsonb,
                ${await sha256Hex(canonicalJson(definition))}, 'team')`;
      await tx`
        insert into sineobex.note_types (team_id, key, title, current_version, customized, revision, updated_by)
        values (${teamId}, ${key}, ${title}, ${definition.version}, true, ${revision}, ${user})
        on conflict (team_id, key) do update
          set title = excluded.title, current_version = excluded.current_version, customized = true,
              revision = excluded.revision, updated_by = excluded.updated_by`;
      return definition;
    }) as Promise<ResolvedNoteType>;
  }

  /** Each stored version names its own key and version and hashes to its hash: what definitionFor checks (D79). */
  async function expectEveryRowNamesItself(teamId: string) {
    for (const row of await versionsOf(teamId)) {
      expect([row.definition.key, row.definition.version], `${row.key} v${row.version}`).toEqual([
        row.key,
        row.version,
      ]);
      expect(await sha256Hex(canonicalJson(row.definition)), `${row.key} v${row.version}`).toBe(row.hash);
    }
  }

  beforeAll(async () => {
    db = await createScratchDatabase();
    app = postgres(db.appUrl, { max: 4, onnotice: () => {} });
    user = await makeUser(db.owner, 'note-type-installer@example.com');
    presets = await fixturePresets();
    expect(presets.length).toBeGreaterThanOrEqual(2);
  });
  afterAll(async () => {
    await app.end({ timeout: 5 });
    await db.drop();
  });

  it('a team’s version 2, then platform versions 2 and 3, installed twice: nothing thrown, no row added, platform_latest 3', async () => {
    const team = await makeTeam(db.owner, 'Install Team Own Version');
    await asPlatform((tx) => installPresets(tx, team, { presets }));
    const [checks] = presets;
    await publishOwn(team, checks!.key, 'Demo: Checks, the team’s own');
    const v2 = await nextOf(checks!);
    const v3 = await nextOf(v2);
    const platform = [...presets, v2, v3];
    const rowsBefore = await versionsOf(team);

    for (const run of [1, 2]) {
      const revision = await revisionOf(team);
      const result = await asPlatform((tx) => installPresets(tx, team, { presets: platform }));
      expect(result, `run ${run}`).toEqual({ installed: [], differing: [] });
      expect(await versionsOf(team), `run ${run}: no row added`).toEqual(rowsBefore);
      const head = (await headsOf(team)).find((h) => h.key === checks!.key)!;
      expect(head, `run ${run}`).toMatchObject({
        title: 'Demo: Checks, the team’s own',
        currentVersion: 2,
        customized: true,
        state: 'active',
        platformLatest: 3,
      });
      // The first run moves platform_latest, one write; the second has nothing to write.
      expect(await revisionOf(team), `run ${run}`).toBe(run === 1 ? revision! + 1 : revision);
    }
    // The offer wrote no event: platform_latest shows it.
    expect((await eventsOf(team)).filter((e) => e.noteTypeKey === checks!.key)).toEqual([
      {
        noteTypeKey: checks!.key,
        presetId: null,
        act: 'installed',
        version: 1,
        reason: null,
        createdBy: null,
      },
    ]);
  });

  it('gives a team holding versions and no head its heads at the next run, at a revision above the team’s, and a second run takes none', async () => {
    // A team made after 0023 and before this installer: phase 4's installer wrote its versions and
    // no head. Its revision moved since, for its presets.
    const team = await makeTeam(db.owner, 'Install Team No Heads');
    for (const p of presets)
      await db.owner`
        insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin, preset_version)
        values (${team}, ${p.key}, ${p.version}, ${JSON.stringify(p.definition)}::text::jsonb, ${p.hash},
                'preset', ${p.version})`;
    const own = {
      ...presets[0]!.definition,
      key: 't_000000000007',
      version: 1,
      title: 'Demo: The team’s own',
    };
    await db.owner`
      insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin)
      values (${team}, ${own.key}, 1, ${JSON.stringify(own)}::text::jsonb, ${await sha256Hex(canonicalJson(own))}, 'team')`;
    for (let i = 0; i < 2; i++) await db.owner.begin((tx) => takeRevision(tx as unknown as InstallSql, team));
    expect(await revisionOf(team)).toBe(2);
    expect(await headsOf(team)).toEqual([]);
    const rows = await versionsOf(team);

    const result = await asPlatform((tx) => installPresets(tx, team, { presets }));
    expect(result).toEqual({ installed: [], differing: [] });
    expect(await revisionOf(team)).toBe(3);
    expect(await headsOf(team)).toEqual(
      [
        ...presets.map((p) => ({
          key: p.key,
          title: p.definition.title,
          state: 'active',
          currentVersion: p.version,
          platformLatest: p.version,
          customized: false,
          revision: 3,
          updatedBy: null,
        })),
        {
          key: own.key,
          title: own.title,
          state: 'active',
          currentVersion: 1,
          platformLatest: null,
          customized: true,
          revision: 3,
          updatedBy: null,
        },
      ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    );
    // Only the heads were written, and no event: neither installs nor updates.
    expect(await versionsOf(team)).toEqual(rows);
    expect(await eventsOf(team)).toEqual([]);

    const heads = await headsOf(team);
    expect(await asPlatform((tx) => installPresets(tx, team, { presets }))).toEqual({
      installed: [],
      differing: [],
    });
    expect(await revisionOf(team)).toBe(3);
    expect(await headsOf(team)).toEqual(heads);
  });

  it('gives each install and update its event, with no reason and no author, and an offer none', async () => {
    const team = await makeTeam(db.owner, 'Install Team Events');
    await asPlatform((tx) => installPresets(tx, team, { presets }));
    expect(await eventsOf(team)).toEqual(
      presets.map((p) => ({
        noteTypeKey: p.key,
        presetId: null,
        act: 'installed',
        version: 1,
        reason: null,
        createdBy: null,
      })),
    );
    const [checks, full] = presets;
    await publishOwn(team, checks!.key, 'Demo: Checks, edited');
    const fullV2 = await nextOf(full!);
    const checksV2 = await nextOf(checks!);
    const result = await asPlatform((tx) =>
      installPresets(tx, team, { presets: [...presets, checksV2, fullV2] }),
    );
    // The update writes the team's version 2 of the full type; the edited one is only offered.
    expect(result).toEqual({ installed: [{ key: full!.key, version: 2 }], differing: [] });
    const events = await eventsOf(team);
    expect(events.filter((e) => e.act !== 'installed')).toEqual([
      {
        noteTypeKey: full!.key,
        presetId: null,
        act: 'platform_updated',
        version: 2,
        reason: null,
        createdBy: null,
      },
    ]);
    const heads = await headsOf(team);
    expect(heads.find((h) => h.key === full!.key)).toMatchObject({
      currentVersion: 2,
      platformLatest: 2,
      title: fullV2.definition.title,
      customized: false,
    });
    expect(heads.find((h) => h.key === checks!.key)).toMatchObject({ currentVersion: 2, platformLatest: 2 });
    // One revision for the run, on every head it wrote.
    const revision = await revisionOf(team);
    for (const key of [full!.key, checks!.key])
      expect(heads.find((h) => h.key === key)!.revision, key).toBe(revision);
    await expectEveryRowNamesItself(team);
  });

  it('names every version it writes as its own row: a team made after version 2 holds it as its version 1', async () => {
    const team = await makeTeam(db.owner, 'Install Team Late');
    const [checks] = presets;
    const v2 = await nextOf(checks!, 'Demo: Checks, second');
    const result = await asPlatform((tx) => installPresets(tx, team, { presets: [...presets, v2] }));
    expect(result.differing).toEqual([]);
    expect(result.installed).toContainEqual({ key: checks!.key, version: 1 });
    const rows = (await versionsOf(team)).filter((r) => r.key === checks!.key);
    expect(rows.map((r) => [r.version, r.origin, r.presetVersion])).toEqual([[1, 'preset', 2]]);
    expect(rows[0]!.definition).toEqual({ ...v2.definition, version: 1 });
    expect(rows[0]!.hash).not.toBe(v2.hash);
    await expectEveryRowNamesItself(team);
    // Installed again, it is the platform's still: nothing differs, nothing is added.
    expect(await asPlatform((tx) => installPresets(tx, team, { presets: [...presets, v2] }))).toEqual({
      installed: [],
      differing: [],
    });
  });

  it('takes one revision for a run that writes, stamped on every head, and none for a run that does not', async () => {
    const team = await makeTeam(db.owner, 'Install Team Revision');
    expect(await revisionOf(team)).toBeNull();
    await asTeam(team, (tx) => installPresets(tx, team, { presets }));
    expect(await revisionOf(team)).toBe(1);
    expect((await headsOf(team)).map((h) => [h.key, h.revision])).toEqual(presets.map((p) => [p.key, 1]));
    await asTeam(team, (tx) => installPresets(tx, team, { presets }));
    expect(await revisionOf(team)).toBe(1);
  });

  it('plans again once it holds the team lock: a second installer at the same moment writes nothing twice', async () => {
    const team = await makeTeam(db.owner, 'Install Team At Once');
    const writer = async () => {
      const conn: ReservedSql = await app.reserve();
      await conn`begin`;
      await conn`set local lock_timeout = '10s'`;
      await conn`select set_config('app.team_id', ${team}, true), set_config('app.user_id', ${user}, true),
                        set_config('app.scope', '', true)`;
      return conn;
    };
    const first = await writer();
    const second = await writer();
    try {
      expect(
        (await installPresets(first as unknown as InstallSql, team, { presets })).installed,
      ).toHaveLength(presets.length);
      // The second reads before the first commits, so it sees nothing yet, then waits on the lock.
      const late = installPresets(second as unknown as InstallSql, team, { presets });
      for (let i = 0; i < 500; i++) {
        const [row] = await db.owner<{ n: number }[]>`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
        if (row!.n > 0) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      await first`commit`;
      expect(await late).toEqual({ installed: [], differing: [] });
      await second`commit`;
    } finally {
      await first`rollback`.catch(() => {});
      await second`rollback`.catch(() => {});
      first.release();
      second.release();
    }
    expect(await versionsOf(team)).toHaveLength(presets.length);
    expect(await headsOf(team)).toHaveLength(presets.length);
    expect(await eventsOf(team)).toHaveLength(presets.length);
    expect(await revisionOf(team)).toBe(1);
  });

  // The cases below pin rules the bite checks of card P4-install found no case holding.
  it('takes no lock for a team that is up to date, so a phone’s list waits on nobody', async () => {
    const team = await makeTeam(db.owner, 'Install Team Up To Date');
    await asPlatform((tx) => installPresets(tx, team, { presets }));
    const holder: ReservedSql = await app.reserve();
    try {
      await holder`begin`;
      await lockTeam(holder as unknown as InstallSql, team);
      // A writer holds the team lock: a run with nothing to write answers without waiting for it.
      const answer = await asTeam(team, async (tx) => {
        await tx`set local lock_timeout = '2s'`;
        return installPresets(tx, team, { presets });
      });
      expect(answer).toEqual({ installed: [], differing: [] });
    } finally {
      await holder`rollback`.catch(() => {});
      holder.release();
    }
  });

  it('gives an updated head back to nobody, leaves an offered one as its writer left it, and names the team’s version in each event', async () => {
    const team = await makeTeam(db.owner, 'Install Team Authors');
    const [checks, full] = presets;
    // Made once the platform's version 2 of the full type was out, so it holds it as its version 1.
    const fullV2 = await nextOf(full!);
    await asPlatform((tx) => installPresets(tx, team, { presets: [...presets, fullV2] }));
    await publishOwn(team, checks!.key, 'Demo: Checks, the team’s own');
    // A person's write left the full type's head the platform's, naming them, as taking an update in
    // place does (design 5.1).
    await db.owner.begin(async (tx) => {
      const revision = await takeRevision(tx as unknown as InstallSql, team);
      await tx`
        update sineobex.note_types set updated_by = ${user}, revision = ${revision}
        where team_id = ${team} and key = ${full!.key}`;
    });
    const fullV3 = await nextOf(fullV2);
    const checksV2 = await nextOf(checks!);
    expect(
      await asPlatform((tx) => installPresets(tx, team, { presets: [...presets, fullV2, fullV3, checksV2] })),
    ).toEqual({ installed: [{ key: full!.key, version: 2 }], differing: [] });

    const heads = await headsOf(team);
    expect(heads.find((h) => h.key === full!.key)).toMatchObject({
      currentVersion: 2,
      platformLatest: 3,
      updatedBy: null,
    });
    expect(heads.find((h) => h.key === checks!.key)).toMatchObject({
      currentVersion: 2,
      platformLatest: 2,
      updatedBy: user,
    });
    expect(
      (await versionsOf(team)).filter((r) => r.key === full!.key).map((r) => [r.version, r.presetVersion]),
    ).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(
      (await eventsOf(team)).filter((e) => e.noteTypeKey === full!.key).map((e) => [e.act, e.version]),
    ).toEqual([
      ['installed', 1],
      ['platform_updated', 2],
    ]);
    await expectEveryRowNamesItself(team);
  });

  it('reports a version another writer put first with another definition, and writes nothing more for its key', async () => {
    const team = await makeTeam(db.owner, 'Install Team Late Writer');
    const [checks, ...rest] = presets;
    const theirs = { ...checks!.definition, title: 'Demo: Checks, written past the lock' };
    const theirsHash = await sha256Hex(canonicalJson(theirs));
    // Commits the other writer's row once, just before the installer's first insert: after its plan
    // under the team lock, which that writer never took.
    let raced = false;
    const racing = (tx: InstallSql): InstallSql =>
      (async (template: TemplateStringsArray, ...values: readonly (string | number)[]) => {
        if (!raced && /insert into/.test(template.join('?'))) {
          raced = true;
          await db.owner`
            insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin, preset_version)
            values (${team}, ${checks!.key}, 1, ${JSON.stringify(theirs)}::text::jsonb, ${theirsHash}, 'preset', 1)`;
        }
        return tx(template, ...values);
      }) as InstallSql;

    expect(await asPlatform((tx) => installPresets(racing(tx), team, { presets, onDiffer: 'skip' }))).toEqual(
      {
        installed: rest.map((p) => ({ key: p.key, version: 1 })),
        differing: [{ key: checks!.key, version: 1 }],
      },
    );
    // The other keys are written whole; the raced key keeps that writer's row, with no head or event.
    expect((await headsOf(team)).map((h) => h.key)).toEqual(rest.map((p) => p.key));
    expect((await eventsOf(team)).map((e) => e.noteTypeKey)).toEqual(rest.map((p) => p.key));
    expect((await versionsOf(team)).find((r) => r.key === checks!.key)!.hash).toBe(theirsHash);
    // The next run gives it its head and nothing more, as for any key whose row differs.
    expect(await asPlatform((tx) => installPresets(tx, team, { presets, onDiffer: 'skip' }))).toEqual({
      installed: [],
      differing: [{ key: checks!.key, version: 1 }],
    });
    expect((await headsOf(team)).map((h) => h.key)).toEqual(presets.map((p) => p.key));
  });
});
