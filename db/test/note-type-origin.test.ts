import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256Hex, takeRevision, type InstallSql } from '@sineobex/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate, setEnvironment } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { makeTeam, makeUser } from './helpers.ts';

// Migration 0025 (phase 5 design 4.3, 5.2; the review queue's item 12, P4's B-9): a note type's
// head names the platform note type it came from, as a preset's head does (0023), so a platform
// version taken as a new note type links the new `t_` key to the platform's key, and the platform's
// later versions are decided on it. Filled for the heads already there from what is stored, every
// other column of a head as it was. Made-up note types only.

describe('0025: a note type names the platform note type it came from', () => {
  let db: ScratchDatabase;
  let dir: string;
  let team: string;
  let other: string;
  let user: string;
  type Head = { key: string; originKey: string | null; revision: number; updatedAt: Date };
  let before: { team: Head[]; other: Head[] };

  const definition = (key: string, version: number, title: string) => ({
    key,
    version,
    title,
    kinds: ['non_medical'],
    group: 'outreach',
    sensitivity: 'none',
    sections: [
      { id: 'notes', title: 'Notes', fields: [{ id: 'notes', kind: 'text', label: 'Notes', lines: 'one' }] },
    ],
  });
  /** A version and its head, as a writer leaves them: at the revision its own transaction took. */
  const noteType = (
    teamId: string,
    key: string,
    origin: 'preset' | 'team',
    options: { state?: 'active' | 'archived'; customized?: boolean } = {},
  ) =>
    db.owner.begin(async (tx) => {
      const revision = await takeRevision(tx as unknown as InstallSql, teamId);
      const d = definition(key, 1, `Demo: ${key}`);
      await tx`
        insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin, preset_version)
        values (${teamId}, ${key}, 1, ${JSON.stringify(d)}::text::jsonb, ${await sha256Hex(canonicalJson(d))},
                ${origin}, ${origin === 'preset' ? 1 : null})`;
      await tx`
        insert into sineobex.note_types (team_id, key, title, state, current_version, customized, revision)
        values (${teamId}, ${key}, ${d.title}, ${options.state ?? 'active'}, 1, ${options.customized ?? false},
                ${revision})`;
    });
  /** A take as new's audit event, as the API writes it in the take's transaction. */
  const takenAsNew = (teamId: string, key: string, replaces: string) =>
    db.owner.begin(async (tx) => {
      await tx`select set_config('app.team_id', ${teamId}, true)`;
      await tx`
        select sineobex.append_audit(${teamId}::uuid, ${user}::uuid, null, null, 'note_type.platform_update_taken',
                                     'note_type', ${key}, null, null, null, null, null, null,
                                     ${JSON.stringify({ version: 1, replaces })}::text::jsonb)`;
    });
  // Read through the row as JSON, so the same read runs before 0025 adds the column (null then).
  const headsOf = (teamId: string) =>
    db.owner<Head[]>`
      select key, to_jsonb(n) ->> 'origin_key' as "originKey", revision::int as revision,
             updated_at as "updatedAt"
      from sineobex.note_types n where team_id = ${teamId} order by key collate "C"`;

  beforeAll(async () => {
    db = await createScratchDatabase({ migrate: false });
    dir = await mkdtemp(join(tmpdir(), 'mig-0025-'));
    for (const f of await readdir(MIGRATIONS_DIR))
      if (f < '0025') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    await migrate(db.owner, { dir });
    await setEnvironment(db.owner, 'test');
    user = await makeUser(db.owner, 'note-type-origin@example.com');
    team = await makeTeam(db.owner, 'Origin Team');
    other = await makeTeam(db.owner, 'Origin Other Team');
    // The platform's note types as the installer wrote them, one the team holds only as its own,
    // and one taken as new twice over: social_needs's update taken as t_0a1b2c3d4e5f, and an older
    // take from it that a later one replaced.
    await noteType(team, 'outreach', 'preset');
    await noteType(team, 'demo_held_as_its_own', 'team', { customized: true });
    await noteType(team, 'social_needs', 'preset', { state: 'archived', customized: true });
    await noteType(team, 't_0a1b2c3d4e5f', 'preset');
    await takenAsNew(team, 't_0a1b2c3d4e5f', 'social_needs');
    await noteType(team, 'wound_care', 'preset', { state: 'archived', customized: true });
    await noteType(team, 't_1f2e3d4c5b6a', 'preset', { state: 'archived', customized: true });
    await takenAsNew(team, 't_1f2e3d4c5b6a', 'wound_care');
    await noteType(team, 't_9a8b7c6d5e4f', 'preset');
    await takenAsNew(team, 't_9a8b7c6d5e4f', 'wound_care');
    // The team's own: blank or a copy, from no platform note type.
    await noteType(team, 't_00aa11bb22cc', 'team', { customized: true });
    // Another team's take names its own key only.
    await noteType(other, 'social_needs', 'preset');
    await noteType(other, 't_0a1b2c3d4e5f', 'team', { customized: true });
    before = { team: await headsOf(team), other: await headsOf(other) };
    await migrate(db.owner);
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('gives every head its origin from what is stored, and changes nothing else of it', async () => {
    expect(await headsOf(team)).toEqual(
      [
        ['demo_held_as_its_own', 'demo_held_as_its_own'],
        ['outreach', 'outreach'],
        // Taken as new: the new key holds the origin, and the one it replaced gives it up.
        ['social_needs', null],
        ['t_00aa11bb22cc', null],
        ['t_0a1b2c3d4e5f', 'social_needs'],
        // Two takes from one key: the later one holds it.
        ['t_1f2e3d4c5b6a', null],
        ['t_9a8b7c6d5e4f', 'wound_care'],
        ['wound_care', null],
      ].map(([key, originKey]) => ({ ...before.team.find((h) => h.key === key)!, originKey })),
    );
    expect(await headsOf(other)).toEqual(
      [
        ['social_needs', 'social_needs'],
        ['t_0a1b2c3d4e5f', null],
      ].map(([key, originKey]) => ({ ...before.other.find((h) => h.key === key)!, originKey })),
    );
  });

  it('names a platform note type at most once in a team, and only by a key 0017 allows', async () => {
    const write = (teamId: string, key: string, origin: string) =>
      db.owner.begin(async (tx) => {
        const revision = await takeRevision(tx as unknown as InstallSql, teamId);
        await tx`update sineobex.note_types set origin_key = ${origin}, revision = ${revision}
                 where team_id = ${teamId} and key = ${key}`;
      });
    await expect(write(team, 't_00aa11bb22cc', 'outreach')).rejects.toThrow(
      /note_types_team_id_origin_key_key/,
    );
    await expect(write(team, 't_00aa11bb22cc', 'Not a key')).rejects.toThrow(/check constraint/);
    // Another team holds its own copies, whatever this one's say.
    await write(other, 't_0a1b2c3d4e5f', 'outreach');
  });
});
