import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser } from './helpers.ts';

// 0017: the note type definitions a team has installed (phase 4 design, forms 3.1). One row per
// team, key and version, never changed once written. Made-up definitions only.

describe('0017 note type versions', () => {
  let db: ScratchDatabase;
  let teamA: string;
  let teamB: string;
  let user: string;

  const HASH = 'ab'.repeat(32);
  const row = (over: Record<string, unknown> = {}) => ({
    team_id: teamA,
    key: 'wound_care',
    version: 1,
    definition: { key: 'wound_care', version: 1, title: 'Demo: wound care' },
    hash: HASH,
    origin: 'preset',
    preset_version: 1,
    ...over,
  });
  const insertAs = (teamId: string, values: ReturnType<typeof row>) =>
    asApp(
      db.appUrl,
      { teamId, userId: user },
      (tx) =>
        tx`insert into sineobex.note_type_versions ${tx({ ...values, definition: tx.json(values.definition as never) })}`,
    );
  const refused = (over: Record<string, unknown>) => insertAs(teamA, row(over));

  beforeAll(async () => {
    db = await createScratchDatabase();
    teamA = await makeTeam(db.owner, 'Forms Team A');
    teamB = await makeTeam(db.owner, 'Forms Team B');
    user = await makeUser(db.owner, 'forms-admin@example.com');
    await insertAs(teamA, row());
  });
  afterAll(() => db.drop());

  it('lets the app role install a version for its team and read it back', async () => {
    const rows = await asApp(
      db.appUrl,
      { teamId: teamA, userId: user },
      (tx) => tx<{ definition: unknown; origin: string; presetVersion: number; age: number }[]>`
        select definition, origin, preset_version as "presetVersion",
               extract(epoch from now() - created_at)::float8 as age
        from sineobex.note_type_versions where key = 'wound_care' and version = 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      definition: { key: 'wound_care', version: 1, title: 'Demo: wound care' },
      origin: 'preset',
      presetVersion: 1,
    });
    // created_at fills itself in.
    expect(rows[0]!.age).toBeGreaterThanOrEqual(0);
    expect(rows[0]!.age).toBeLessThan(60);
  });

  it('holds one row per team, key and version, so installing twice changes nothing', async () => {
    await expect(refused({ hash: 'cd'.repeat(32) })).rejects.toThrow(/note_type_versions_pkey/);
    // The installer's own insert: a second run is a no-op, and the first row stands.
    await asApp(
      db.appUrl,
      { teamId: teamA, userId: user },
      (tx) =>
        tx`insert into sineobex.note_type_versions ${tx({
          ...row({ hash: 'cd'.repeat(32) }),
          definition: tx.json({ edited: true }),
        })} on conflict do nothing`,
    );
    const rows = await db.owner<{ hash: string }[]>`
      select hash from sineobex.note_type_versions where team_id = ${teamA} and key = 'wound_care'`;
    expect(rows).toEqual([{ hash: HASH }]);
    // The next version of the key, and the same key and version in another team, are their own rows.
    await insertAs(teamA, row({ version: 2, preset_version: 2 }));
    await insertAs(teamB, row({ team_id: teamB }));
  });

  it('never changes or removes a version once written', async () => {
    await expect(
      db.owner`update sineobex.note_type_versions set definition = '{}' where team_id = ${teamA}`,
    ).rejects.toThrow(/append-only/);
    await expect(db.owner`delete from sineobex.note_type_versions where team_id = ${teamA}`).rejects.toThrow(
      /append-only/,
    );
    // The app role has no right to try.
    const asTeamA = (run: Parameters<typeof asApp>[2]) =>
      asApp(db.appUrl, { teamId: teamA, userId: user }, run);
    await expect(asTeamA((tx) => tx`update sineobex.note_type_versions set origin = 'team'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asTeamA((tx) => tx`delete from sineobex.note_type_versions`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('refuses a key outside the note type key pattern', async () => {
    for (const key of ['Wound_care', '9lives', 'a', 'wound-care', 'wound care', `a${'b'.repeat(61)}`, '']) {
      await expect(refused({ key }), key).rejects.toThrow(/note_type_versions_key_check/);
    }
    // The shortest and the longest key the pattern allows.
    await insertAs(teamA, row({ key: 'ab' }));
    await insertAs(teamA, row({ key: `a${'b'.repeat(60)}` }));
  });

  it('refuses a version below 1', async () => {
    await expect(refused({ key: 'vitals', version: 0 })).rejects.toThrow(/note_type_versions_version_check/);
    await expect(refused({ key: 'vitals', version: -1 })).rejects.toThrow(/note_type_versions_version_check/);
  });

  it('refuses a hash that is not 64 lower-case hex characters', async () => {
    for (const hash of ['ab'.repeat(31), 'ab'.repeat(33), 'AB'.repeat(32), `${'ab'.repeat(31)}zz`, '']) {
      await expect(refused({ key: 'vitals', hash }), hash).rejects.toThrow(/note_type_versions_hash_check/);
    }
  });

  it('refuses an origin nobody defined, and a preset row that names no platform version', async () => {
    await expect(refused({ key: 'vitals', origin: 'imported' })).rejects.toThrow(
      /note_type_versions_origin_check/,
    );
    await expect(refused({ key: 'vitals', preset_version: null })).rejects.toThrow(
      /note_type_versions_preset_names_version/,
    );
    await expect(refused({ key: 'vitals', preset_version: 0 })).rejects.toThrow(
      /note_type_versions_preset_version_check/,
    );
    // A team's own version (phase 5) need not come from a platform version.
    await insertAs(teamA, row({ key: 'vitals', origin: 'team', preset_version: null }));
  });

  it('refuses a definition that is not an object, and a row with a part missing', async () => {
    // A JSON null is not a SQL null: only the check stops it.
    for (const json of ['null', '[]', '"wound_care"', '3']) {
      await expect(
        asApp(
          db.appUrl,
          { teamId: teamA, userId: user },
          (tx) => tx`insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin,
                       preset_version)
                     values (${teamA}, 'outreach', 1, ${json}::jsonb, ${HASH}, 'preset', 1)`,
        ),
        json,
      ).rejects.toThrow(/note_type_versions_definition_check/);
    }
    // As the owner, so the answer is the column's own rule and not the team policy.
    const asOwner = (over: Record<string, unknown>) => {
      const values = row({ key: 'outreach', ...over });
      const definition = values.definition === null ? null : db.owner.json(values.definition as never);
      return db.owner`insert into sineobex.note_type_versions ${db.owner({ ...values, definition })}`;
    };
    for (const column of ['team_id', 'key', 'version', 'definition', 'hash', 'origin']) {
      await expect(asOwner({ [column]: null }), column).rejects.toThrow(
        new RegExp(`null value in column "${column}"`),
      );
    }
    await expect(asOwner({ team_id: randomUUID() })).rejects.toThrow(/foreign key constraint/);
  });

  it('hides a team’s versions from another team, and from a request with no team', async () => {
    const seenBy = (ctx: { teamId?: string }) =>
      asApp(
        db.appUrl,
        { ...ctx, userId: user },
        (tx) =>
          tx<{ teamId: string }[]>`select distinct team_id as "teamId" from sineobex.note_type_versions`,
      );
    expect(await seenBy({ teamId: teamA })).toEqual([{ teamId: teamA }]);
    expect(await seenBy({ teamId: teamB })).toEqual([{ teamId: teamB }]);
    expect(await seenBy({})).toEqual([]);
    // Acting in team B, nobody writes a definition into team A.
    await expect(insertAs(teamB, row({ key: 'social_needs' }))).rejects.toThrow(/row-level security/);
  });

  it('lets a platform-scope request install and read a version for any team', async () => {
    // A team's presets are installed when the team is made, in platform scope (forms 3.1).
    const fresh = await makeTeam(db.owner, 'Forms Team Fresh');
    const seen = await asApp(db.appUrl, { userId: user, platform: true }, async (tx) => {
      await tx`insert into sineobex.note_type_versions
               ${tx({ ...row({ team_id: fresh, key: 'outreach' }), definition: tx.json(row().definition as never) })}
               on conflict do nothing`;
      return tx<{ teamId: string }[]>`
        select distinct team_id as "teamId" from sineobex.note_type_versions
        where team_id in (${teamA}, ${fresh}) order by 1`;
    });
    expect(seen.map((r) => r.teamId).sort()).toEqual([teamA, fresh].sort());
  });

  it('does not tie a note to an installed version: preview notes name none', async () => {
    const encounter = randomUUID();
    await db.owner`insert into sineobex.encounters (id, team_id, kind, author_user_id, started_at)
                   values (${encounter}, ${teamA}, 'non_medical', ${user}, now())`;
    await asApp(
      db.appUrl,
      { teamId: teamA, userId: user },
      (
        tx,
      ) => tx`insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, note_type_version,
                   author_user_id)
                 values (${randomUUID()}, ${teamA}, ${encounter}, 'never_installed', null, ${user}),
                        (${randomUUID()}, ${teamA}, ${encounter}, 'never_installed', 7, ${user})`,
    );
  });
});
