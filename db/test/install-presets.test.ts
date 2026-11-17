import {
  canonicalJson,
  installPresets,
  PresetDiffers,
  sha256Hex,
  type InstallSql,
  type Preset,
} from '@sineobex/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixturePresets } from '../../packages/forms/test/fixtures/presets.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser } from './helpers.ts';

// installPresets (phase 4 design, forms 3.1 and 3.2) against 0017. The real presets.json holds
// nothing until the definitions are typed, so these install the made-up fixture note types.

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
});
