import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeRevision } from '@sineobex/forms';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS_DIR } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser, refusal } from './helpers.ts';

// 0023: team presets (phase 5 design 4.1 to 4.3). A head the API changes and versions that never
// change, for every kind of preset; the events that keep the reason for each act; the team
// revision; and the note type head, filled from the versions present. Nothing is deleted. Made-up
// presets only.

const CHECK = '23514';
const FOREIGN_KEY = '23503';
const NOT_NULL = '23502';
const UNIQUE = '23505';
const DENIED = '42501';
type Row = Record<string, unknown>;

const KINDS = [
  'order_category',
  'item',
  'bundle',
  'flag',
  'field_supply_map',
  'condition_supply_map',
  'bag',
  'settings',
];
const HASH = 'ab'.repeat(32);

const columnsOf = (owner: Sql, table: string) =>
  owner<{ name: string; type: string }[]>`
    select column_name as name, data_type as type from information_schema.columns
    where table_schema = 'sineobex' and table_name = ${table} order by ordinal_position`;

describe('0023 team presets', () => {
  let db: ScratchDatabase;
  let team: string;
  let otherTeam: string;
  let admin: string;
  let otherAdmin: string;
  let made = 0;

  const as = <T>(teamId: string, run: (tx: TransactionSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: admin }, run);
  const inTeam = <T>(run: (tx: TransactionSql) => Promise<T>) => as(team, run);
  const values = (tx: Sql | TransactionSql, row: Row) => {
    const out: Row = { ...row };
    if (out.body !== undefined && out.body !== null) out.body = tx.json(out.body as never);
    return tx(out);
  };

  // Whole rows, as the API writes them.
  const head = (over: Row = {}): Row => ({
    id: randomUUID(),
    team_id: team,
    kind: 'item',
    name: `Demo: item ${++made}`,
    current_version: 1,
    revision: 1,
    created_by: admin,
    updated_by: admin,
    ...over,
  });
  const version = (presetId: string, over: Row = {}): Row => ({
    team_id: team,
    preset_id: presetId,
    version: 1,
    body: { name: 'Demo: gauze' },
    source: 'team',
    created_by: admin,
    ...over,
  });
  const event = (over: Row = {}): Row => ({
    team_id: team,
    act: 'created',
    version: 1,
    reason: 'Demo: the team asked for it',
    created_by: admin,
    ...over,
  });
  const noteType = (over: Row = {}): Row => ({
    team_id: team,
    key: `demo_type_${++made}`,
    title: 'Demo: a note type',
    current_version: 1,
    revision: 1,
    ...over,
  });

  const insertHead = (row: Row, teamId = team) =>
    as(teamId, (tx) => tx`insert into sineobex.team_presets ${values(tx, row)}`);
  const insertVersion = (row: Row, teamId = team) =>
    as(teamId, (tx) => tx`insert into sineobex.team_preset_versions ${values(tx, row)}`);
  const insertEvent = (row: Row, teamId = team) =>
    as(teamId, (tx) => tx`insert into sineobex.team_preset_events ${values(tx, row)}`);
  const insertNoteType = (row: Row, teamId = team) =>
    as(teamId, (tx) => tx`insert into sineobex.note_types ${values(tx, row)}`);

  /** The team's revision row, as its first write makes it (takeRevision's upsert). */
  const firstWrite = (teamId: string) =>
    as(
      teamId,
      (tx) => tx`insert into sineobex.team_preset_state (team_id) values (${teamId}) on conflict do nothing`,
    );

  /** A preset of `teamId` at version 1, as a create writes it. */
  const preset = async (over: Row = {}, teamId = team) => {
    const row = head({ team_id: teamId, ...over });
    await insertHead(row, teamId);
    await insertVersion(version(row.id as string, { team_id: teamId }), teamId);
    return row.id as string;
  };

  beforeAll(async () => {
    db = await createScratchDatabase();
    team = await makeTeam(db.owner, 'Preset Team');
    otherTeam = await makeTeam(db.owner, 'Preset Other Team');
    admin = await makeUser(db.owner, 'preset-admin@example.com');
    otherAdmin = await makeUser(db.owner, 'preset-other-admin@example.com');
  });
  afterAll(() => db.drop());

  describe('a preset head', () => {
    it('is taken from the app role and given back, with what a new head leaves out filled in', async () => {
      const id = randomUUID();
      await insertHead({
        id,
        team_id: team,
        kind: 'flag',
        name: 'Demo: Frost risk',
        current_version: 1,
        revision: 3,
      });
      const [row] = await inTeam(
        (tx) => tx`
          select kind, name, state, current_version, origin_key, origin_version, platform_latest, customized,
                 revision, created_by, updated_by, updated_at = created_at as untouched,
                 extract(epoch from now() - created_at)::float8 as age
          from sineobex.team_presets where id = ${id}`,
      );
      const { age, ...rest } = row as { age: number };
      expect(rest).toEqual({
        kind: 'flag',
        name: 'Demo: Frost risk',
        state: 'active',
        current_version: 1,
        origin_key: null,
        origin_version: null,
        platform_latest: null,
        customized: false,
        revision: '3',
        created_by: null,
        updated_by: null,
        untouched: true,
      });
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(60);
    });

    it('holds the columns of a head, and the id is the server’s', async () => {
      expect((await columnsOf(db.owner, 'team_presets')).map((c) => `${c.name} ${c.type}`)).toEqual([
        'id uuid',
        'team_id uuid',
        'kind text',
        'name text',
        'state text',
        'current_version integer',
        'origin_key text',
        'origin_version integer',
        'platform_latest integer',
        'customized boolean',
        'revision bigint',
        'created_by uuid',
        'updated_by uuid',
        'created_at timestamp with time zone',
        'updated_at timestamp with time zone',
      ]);
      const { id: _, ...rest } = head();
      const [row] = await inTeam(
        (tx) => tx<{ id: string }[]>`insert into sineobex.team_presets ${values(tx, rest)} returning id`,
      );
      expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('refuses a head with a part missing', async () => {
      for (const column of [
        'team_id',
        'kind',
        'name',
        'state',
        'current_version',
        'customized',
        'revision',
      ]) {
        expect(
          await refusal(
            db.owner`insert into sineobex.team_presets ${values(db.owner, head({ [column]: null }))}`,
          ),
          column,
        ).toEqual({ code: NOT_NULL });
      }
      for (const column of ['kind', 'name', 'current_version', 'revision']) {
        const rest = Object.fromEntries(Object.entries(head()).filter(([c]) => c !== column));
        expect(
          await refusal(db.owner`insert into sineobex.team_presets ${values(db.owner, rest)}`),
          `no ${column}`,
        ).toEqual({ code: NOT_NULL });
      }
    });

    it('is one of the eight kinds', async () => {
      for (const kind of KINDS) {
        expect(await refusal(insertHead(head({ kind }))), kind).toBeNull();
      }
      for (const kind of ['billing_code_map', 'alert_rule', 'Item', '']) {
        expect(await refusal(insertHead(head({ kind }))), kind).toEqual({
          code: CHECK,
          constraint: 'team_presets_kind_check',
        });
      }
    });

    it('keeps its kind for good, whatever else changes', async () => {
      const id = await preset({ kind: 'flag' });
      const change = (set: Row) =>
        refusal(inTeam((tx) => tx`update sineobex.team_presets set ${tx(set)} where id = ${id}`));
      expect(await change({ kind: 'item' })).toEqual({ code: CHECK, constraint: 'team_presets_kind_fixed' });
      expect(await change({ kind: 'item', name: 'Demo: Frost risk, renamed' })).toEqual({
        code: CHECK,
        constraint: 'team_presets_kind_fixed',
      });
      // As the owner too: it is the table's rule, not a right.
      expect(await refusal(db.owner`update sineobex.team_presets set kind = 'bag' where id = ${id}`)).toEqual(
        {
          code: CHECK,
          constraint: 'team_presets_kind_fixed',
        },
      );
      expect(await change({ kind: 'flag' })).toBeNull();
      expect(await change({ name: 'Demo: Frost risk, renamed', current_version: 2, revision: 2 })).toBeNull();
      const [row] = await db.owner`select kind, name from sineobex.team_presets where id = ${id}`;
      expect(row).toEqual({ kind: 'flag', name: 'Demo: Frost risk, renamed' });
    });

    it('is named in 1 to 80 characters', async () => {
      for (const name of ['', '   ', 'é'.repeat(81)]) {
        expect(await refusal(insertHead(head({ name }))), `${name.length} characters`).toEqual({
          code: CHECK,
          constraint: 'team_presets_name_check',
        });
      }
      expect(await refusal(insertHead(head({ name: 'é'.repeat(80) })))).toBeNull();
      expect(await refusal(insertHead(head({ name: 'D' })))).toBeNull();
    });

    it('keeps an active name its own within its kind and team, and an archived one frees it', async () => {
      const first = await preset({ kind: 'bundle', name: 'Demo: Foot check' });
      const taken = { code: UNIQUE, constraint: 'team_presets_active_name' };
      for (const name of ['Demo: Foot check', 'demo: FOOT CHECK']) {
        expect(await refusal(insertHead(head({ kind: 'bundle', name }))), name).toEqual(taken);
      }
      // Another kind, or another team, may use it.
      expect(await refusal(insertHead(head({ kind: 'bag', name: 'Demo: Foot check' })))).toBeNull();
      expect(
        await refusal(
          insertHead(head({ team_id: otherTeam, kind: 'bundle', name: 'Demo: Foot check' }), otherTeam),
        ),
      ).toBeNull();
      // Archived, the first keeps its name and gives it up; restoring it while the name is taken fails.
      await inTeam((tx) => tx`update sineobex.team_presets set state = 'archived' where id = ${first}`);
      const second = await preset({ kind: 'bundle', name: 'Demo: Foot check' });
      expect(
        await refusal(
          inTeam((tx) => tx`update sineobex.team_presets set state = 'active' where id = ${first}`),
        ),
      ).toEqual(taken);
      const rows = await db.owner<{ id: string; name: string; state: string }[]>`
        select id, name, state from sineobex.team_presets
        where team_id = ${team} and kind = 'bundle' and lower(name) = 'demo: foot check' order by state`;
      expect(rows).toEqual([
        { id: second, name: 'Demo: Foot check', state: 'active' },
        { id: first, name: 'Demo: Foot check', state: 'archived' },
      ]);
    });

    it('is active or archived', async () => {
      for (const state of ['deleted', 'Active', '']) {
        expect(await refusal(insertHead(head({ state }))), state).toEqual({
          code: CHECK,
          constraint: 'team_presets_state_check',
        });
      }
      expect(await refusal(insertHead(head({ state: 'archived' })))).toBeNull();
    });

    it('holds one settings preset per team, whatever its state or name', async () => {
      const one = { code: UNIQUE, constraint: 'team_presets_one_settings' };
      const fresh = await makeTeam(db.owner, 'Preset Settings Team');
      const settings = (over: Row = {}) =>
        head({ team_id: fresh, kind: 'settings', name: 'Team settings', ...over });
      expect(await refusal(insertHead(settings(), fresh))).toBeNull();
      expect(await refusal(insertHead(settings({ name: 'Demo: more settings' }), fresh))).toEqual(one);
      expect(
        await refusal(insertHead(settings({ name: 'Demo: old settings', state: 'archived' }), fresh)),
      ).toEqual(one);
      // Every other kind may have many; every team has its own settings.
      expect(await refusal(insertHead(head({ team_id: fresh, kind: 'bag' }), fresh))).toBeNull();
      expect(await refusal(insertHead(head({ team_id: fresh, kind: 'bag' }), fresh))).toBeNull();
      const other = await makeTeam(db.owner, 'Preset Settings Other Team');
      expect(await refusal(insertHead(settings({ team_id: other }), other))).toBeNull();
    });

    it('names a platform preset at most once in a team', async () => {
      const once = { code: UNIQUE, constraint: 'team_presets_team_id_origin_key_key' };
      const platform = { origin_key: 'bundle.demo_foot_care', origin_version: 1, platform_latest: 1 };
      expect(await refusal(insertHead(head({ kind: 'bundle', ...platform, created_by: null })))).toBeNull();
      // Archived or not: taking an update as a new preset first lets the old one go (origin_key null).
      expect(
        await refusal(insertHead(head({ kind: 'bundle', state: 'archived', ...platform, created_by: null }))),
      ).toEqual(once);
      expect(
        await refusal(insertHead(head({ team_id: otherTeam, kind: 'bundle', ...platform }), otherTeam)),
      ).toBeNull();
      // A team's own presets name none, as many as it likes.
      expect(await refusal(insertHead(head({ origin_key: null })))).toBeNull();
      expect(await refusal(insertHead(head({ origin_key: null })))).toBeNull();
    });

    it('counts its versions and the platform’s from 1, and is always at a revision', async () => {
      for (const [column, value] of [
        ['current_version', 0],
        ['origin_version', 0],
        ['platform_latest', 0],
        ['revision', 0],
        ['revision', -1],
      ] as const) {
        expect(await refusal(insertHead(head({ [column]: value }))), `${column} ${value}`).toEqual({
          code: CHECK,
          constraint: `team_presets_${column}_check`,
        });
      }
      expect(
        await refusal(insertHead(head({ current_version: 7, origin_version: 2, platform_latest: 3 }))),
      ).toBeNull();
    });

    it('names real people and a real team', async () => {
      const nobody = randomUUID();
      for (const column of ['created_by', 'updated_by']) {
        expect(await refusal(insertHead(head({ [column]: nobody }))), column).toEqual({
          code: FOREIGN_KEY,
          constraint: `team_presets_${column}_fkey`,
        });
      }
      // As the owner, so a made-up team is answered by the key and not by the team policy.
      expect(
        await refusal(
          db.owner`insert into sineobex.team_presets ${values(db.owner, head({ team_id: nobody }))}`,
        ),
      ).toEqual({ code: FOREIGN_KEY, constraint: 'team_presets_team_id_fkey' });
    });

    it('moves its time of last change when it changes', async () => {
      const id = await preset();
      await inTeam(
        (tx) => tx`update sineobex.team_presets set current_version = 2, revision = 2, customized = true
                   where id = ${id}`,
      );
      const [row] = await db.owner<{ moved: boolean }[]>`
        select updated_at > created_at as moved from sineobex.team_presets where id = ${id}`;
      expect(row).toEqual({ moved: true });
    });
  });

  describe('a version', () => {
    it('is a body of a preset of its own team, taken from the app role and given back', async () => {
      const id = await preset({ kind: 'item', name: 'Demo: Gauze' });
      await insertVersion(version(id, { version: 2, body: { name: 'Demo: Gauze', unit: 'each' } }));
      const rows = await inTeam(
        (tx) => tx`
          select version, body, source, created_by, extract(epoch from now() - created_at)::float8 < 60 as recent
          from sineobex.team_preset_versions where preset_id = ${id} order by version`,
      );
      expect(rows).toEqual([
        { version: 1, body: { name: 'Demo: gauze' }, source: 'team', created_by: admin, recent: true },
        {
          version: 2,
          body: { name: 'Demo: Gauze', unit: 'each' },
          source: 'team',
          created_by: admin,
          recent: true,
        },
      ]);
      expect((await columnsOf(db.owner, 'team_preset_versions')).map((c) => `${c.name} ${c.type}`)).toEqual([
        'team_id uuid',
        'preset_id uuid',
        'version integer',
        'body jsonb',
        'source text',
        'created_by uuid',
        'created_at timestamp with time zone',
      ]);
    });

    it('is one row per version, counted from 1', async () => {
      const id = await preset();
      expect(await refusal(insertVersion(version(id)))).toEqual({
        code: UNIQUE,
        constraint: 'team_preset_versions_pkey',
      });
      for (const v of [0, -1]) {
        expect(await refusal(insertVersion(version(id, { version: v }))), `${v}`).toEqual({
          code: CHECK,
          constraint: 'team_preset_versions_version_check',
        });
      }
    });

    it('names only a preset of its own team', async () => {
      const theirs = await preset({}, otherTeam);
      const refused = { code: FOREIGN_KEY, constraint: 'team_preset_versions_team_id_preset_id_fkey' };
      // As the request: a foreign key check ignores row-level security, so the key holds the team.
      expect(await refusal(insertVersion(version(theirs)))).toEqual(refused);
      expect(await refusal(insertVersion(version(randomUUID())))).toEqual(refused);
      // As the owner, which no policy stops.
      expect(
        await refusal(
          db.owner`insert into sineobex.team_preset_versions ${values(db.owner, version(theirs))}`,
        ),
      ).toEqual(refused);
    });

    it('holds a JSON object of at most 32 KiB, as PostgreSQL writes it out', async () => {
      const id = await preset();
      for (const json of ['null', '[]', '"Demo: gauze"', '3']) {
        expect(
          await refusal(
            inTeam(
              (
                tx,
              ) => tx`insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source, created_by)
                         values (${team}, ${id}, 2, ${json}::jsonb, 'team', ${admin})`,
            ),
          ),
          json,
        ).toEqual({ code: CHECK, constraint: 'team_preset_versions_body_check' });
      }
      // {"name": "…"} is 12 bytes and the name.
      const sized = (bytes: number) => ({ name: 'D'.repeat(bytes - 12) });
      const [measured] = await db.owner<{ n: number }[]>`
        select octet_length(${db.owner.json(sized(32_768) as never)}::jsonb::text) as n`;
      expect(measured!.n).toBe(32_768);
      expect(await refusal(insertVersion(version(id, { version: 2, body: sized(32_769) })))).toEqual({
        code: CHECK,
        constraint: 'team_preset_versions_body_size',
      });
      expect(await refusal(insertVersion(version(id, { version: 2, body: sized(32_768) })))).toBeNull();
    });

    it('comes from the team or the platform, and no person writes a platform version', async () => {
      const id = await preset();
      expect(
        await refusal(insertVersion(version(id, { version: 2, source: 'imported', created_by: null }))),
      ).toEqual({ code: CHECK, constraint: 'team_preset_versions_source_check' });
      expect(await refusal(insertVersion(version(id, { version: 2, source: 'platform' })))).toEqual({
        code: CHECK,
        constraint: 'team_preset_versions_platform_no_author',
      });
      expect(
        await refusal(insertVersion(version(id, { version: 2, source: 'platform', created_by: null }))),
      ).toBeNull();
      expect(await refusal(insertVersion(version(id, { version: 3, created_by: otherAdmin })))).toBeNull();
      expect(
        await refusal(
          db.owner`insert into sineobex.team_preset_versions ${values(db.owner, version(id, { version: 4, created_by: randomUUID() }))}`,
        ),
      ).toEqual({ code: FOREIGN_KEY, constraint: 'team_preset_versions_created_by_fkey' });
    });

    it('refuses a version with a part missing', async () => {
      const id = await preset();
      for (const column of ['team_id', 'preset_id', 'version', 'body', 'source']) {
        expect(
          await refusal(
            db.owner`insert into sineobex.team_preset_versions ${values(db.owner, version(id, { version: 2, [column]: null }))}`,
          ),
          column,
        ).toEqual({ code: NOT_NULL });
      }
    });

    it('is never changed or removed', async () => {
      const id = await preset();
      // The app role has no right to try.
      expect(
        await refusal(
          inTeam(
            (tx) =>
              tx`update sineobex.team_preset_versions set body = '{"name": "Demo: x"}' where preset_id = ${id}`,
          ),
        ),
      ).toEqual({ code: DENIED });
      expect(
        await refusal(inTeam((tx) => tx`delete from sineobex.team_preset_versions where preset_id = ${id}`)),
      ).toEqual({ code: DENIED });
      // Nor the owner: the table is append-only.
      await expect(
        db.owner`update sineobex.team_preset_versions set source = 'platform', created_by = null where preset_id = ${id}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        db.owner`delete from sineobex.team_preset_versions where preset_id = ${id}`,
      ).rejects.toThrow(/append-only/);
      expect(
        await db.owner`select version, body from sineobex.team_preset_versions where preset_id = ${id}`,
      ).toEqual([{ version: 1, body: { name: 'Demo: gauze' } }]);
    });
  });

  describe('an event', () => {
    it('is about one preset or one note type of its own team, taken and given back', async () => {
      const id = await preset();
      const key = noteType().key as string;
      await insertNoteType(noteType({ key }));
      await insertEvent(event({ preset_id: id }));
      await insertEvent(
        event({ note_type_key: key, act: 'updated', version: 2, reason: 'Demo: a new field' }),
      );
      const rows = await inTeam(
        (tx) => tx`
          select preset_id, note_type_key, act, version, reason, created_by
          from sineobex.team_preset_events where preset_id = ${id} or note_type_key = ${key} order by act`,
      );
      expect(rows).toEqual([
        {
          preset_id: id,
          note_type_key: null,
          act: 'created',
          version: 1,
          reason: 'Demo: the team asked for it',
          created_by: admin,
        },
        {
          preset_id: null,
          note_type_key: key,
          act: 'updated',
          version: 2,
          reason: 'Demo: a new field',
          created_by: admin,
        },
      ]);
      expect((await columnsOf(db.owner, 'team_preset_events')).map((c) => `${c.name} ${c.type}`)).toEqual([
        'id uuid',
        'team_id uuid',
        'preset_id uuid',
        'note_type_key text',
        'act text',
        'version integer',
        'reason text',
        'created_by uuid',
        'created_at timestamp with time zone',
      ]);
    });

    it('names exactly one of a preset and a note type', async () => {
      const id = await preset();
      const key = noteType().key as string;
      await insertNoteType(noteType({ key }));
      const one = { code: CHECK, constraint: 'team_preset_events_one_subject' };
      expect(await refusal(insertEvent(event()))).toEqual(one);
      expect(await refusal(insertEvent(event({ preset_id: id, note_type_key: key })))).toEqual(one);
    });

    it('names only a preset or a note type of its own team', async () => {
      const theirs = await preset({}, otherTeam);
      const theirKey = noteType().key as string;
      await insertNoteType(noteType({ team_id: otherTeam, key: theirKey }), otherTeam);
      const presetKey = { code: FOREIGN_KEY, constraint: 'team_preset_events_team_id_preset_id_fkey' };
      const typeKey = { code: FOREIGN_KEY, constraint: 'team_preset_events_team_id_note_type_key_fkey' };
      expect(await refusal(insertEvent(event({ preset_id: theirs })))).toEqual(presetKey);
      expect(await refusal(insertEvent(event({ preset_id: randomUUID() })))).toEqual(presetKey);
      expect(await refusal(insertEvent(event({ note_type_key: theirKey })))).toEqual(typeKey);
      expect(await refusal(insertEvent(event({ note_type_key: 'wound_care' })))).toEqual(typeKey);
    });

    it('says what was done, to which version', async () => {
      const id = await preset();
      const acts = ['created', 'updated', 'archived', 'restored', 'update_taken', 'reordered'];
      for (const act of acts)
        expect(await refusal(insertEvent(event({ preset_id: id, act }))), act).toBeNull();
      for (const act of ['installed', 'platform_updated']) {
        expect(
          await refusal(insertEvent(event({ preset_id: id, act, reason: null, created_by: null }))),
          act,
        ).toBeNull();
      }
      for (const act of ['deleted', 'published', '']) {
        expect(await refusal(insertEvent(event({ preset_id: id, act }))), act).toEqual({
          code: CHECK,
          constraint: 'team_preset_events_act_check',
        });
      }
      expect(await refusal(insertEvent(event({ preset_id: id, version: 0 })))).toEqual({
        code: CHECK,
        constraint: 'team_preset_events_version_check',
      });
      for (const column of ['team_id', 'act', 'version']) {
        expect(
          await refusal(
            db.owner`insert into sineobex.team_preset_events ${values(db.owner, event({ preset_id: id, [column]: null }))}`,
          ),
          column,
        ).toEqual({ code: NOT_NULL });
      }
    });

    it('keeps a reason of 3 to 300 characters', async () => {
      const id = await preset();
      for (const reason of ['', 'no', '  no  ', 'é'.repeat(301)]) {
        expect(
          await refusal(insertEvent(event({ preset_id: id, reason }))),
          `${reason.length} characters`,
        ).toEqual({
          code: CHECK,
          constraint: 'team_preset_events_reason_check',
        });
      }
      expect(await refusal(insertEvent(event({ preset_id: id, reason: 'é'.repeat(300) })))).toBeNull();
      expect(await refusal(insertEvent(event({ preset_id: id, reason: 'typ' })))).toBeNull();
    });

    it('has a reason exactly when a person acted, and only the installer acts as nobody', async () => {
      const id = await preset();
      const withPerson = { code: CHECK, constraint: 'team_preset_events_reason_with_person' };
      const installer = { code: CHECK, constraint: 'team_preset_events_installer_acts' };
      // A person's act without a reason, or a reason with nobody to give it. Each case breaks one rule.
      expect(await refusal(insertEvent(event({ preset_id: id, reason: null })))).toEqual(withPerson);
      expect(
        await refusal(insertEvent(event({ preset_id: id, act: 'installed', created_by: null }))),
      ).toEqual(withPerson);
      // The installer is the only one that acts as nobody, and nobody else acts as the installer.
      expect(await refusal(insertEvent(event({ preset_id: id, act: 'installed' })))).toEqual(installer);
      expect(
        await refusal(insertEvent(event({ preset_id: id, act: 'platform_updated', version: 2 }))),
      ).toEqual(installer);
      expect(
        await refusal(insertEvent(event({ preset_id: id, act: 'updated', reason: null, created_by: null }))),
      ).toEqual(installer);
      expect(
        await refusal(
          insertEvent(event({ preset_id: id, act: 'installed', reason: null, created_by: null })),
        ),
      ).toBeNull();
      expect(await refusal(insertEvent(event({ preset_id: id, act: 'archived' })))).toBeNull();
      expect(
        await refusal(
          db.owner`insert into sineobex.team_preset_events ${values(db.owner, event({ preset_id: id, created_by: randomUUID() }))}`,
        ),
      ).toEqual({ code: FOREIGN_KEY, constraint: 'team_preset_events_created_by_fkey' });
    });

    it('is never changed or removed', async () => {
      const id = await preset();
      await insertEvent(event({ preset_id: id }));
      expect(
        await refusal(
          inTeam(
            (tx) =>
              tx`update sineobex.team_preset_events set reason = 'Demo: rewritten' where preset_id = ${id}`,
          ),
        ),
      ).toEqual({ code: DENIED });
      expect(
        await refusal(inTeam((tx) => tx`delete from sineobex.team_preset_events where preset_id = ${id}`)),
      ).toEqual({ code: DENIED });
      await expect(
        db.owner`update sineobex.team_preset_events set reason = 'Demo: rewritten' where preset_id = ${id}`,
      ).rejects.toThrow(/append-only/);
      await expect(db.owner`delete from sineobex.team_preset_events where preset_id = ${id}`).rejects.toThrow(
        /append-only/,
      );
      expect(await db.owner`select reason from sineobex.team_preset_events where preset_id = ${id}`).toEqual([
        { reason: 'Demo: the team asked for it' },
      ]);
    });
  });

  describe('the team revision', () => {
    it('starts a team made later at revision 0 with an epoch of its own, at its first write', async () => {
      const fresh = await makeTeam(db.owner, 'Preset Revision Team');
      expect(await db.owner`select 1 from sineobex.team_preset_state where team_id = ${fresh}`).toEqual([]);
      await as(fresh, (tx) => tx`insert into sineobex.team_preset_state (team_id) values (${fresh})`);
      const [row] = await db.owner<{ revision: string; epoch: string }[]>`
        select revision, epoch from sineobex.team_preset_state where team_id = ${fresh}`;
      expect(row!.revision).toBe('0');
      expect(row!.epoch).toMatch(/^[0-9a-f-]{36}$/);
      expect(
        await refusal(
          as(fresh, (tx) => tx`insert into sineobex.team_preset_state (team_id) values (${fresh})`),
        ),
      ).toEqual({ code: UNIQUE, constraint: 'team_preset_state_pkey' });
      // The app role moves it forward; it is never below 0.
      await as(
        fresh,
        (tx) => tx`update sineobex.team_preset_state set revision = revision + 1 where team_id = ${fresh}`,
      );
      const below = await makeTeam(db.owner, 'Preset Revision Below Team');
      expect(
        await refusal(
          as(
            below,
            (tx) => tx`insert into sineobex.team_preset_state (team_id, revision) values (${below}, -1)`,
          ),
        ),
      ).toEqual({ code: CHECK, constraint: 'team_preset_state_revision_check' });
      expect((await columnsOf(db.owner, 'team_preset_state')).map((c) => `${c.name} ${c.type}`)).toEqual([
        'team_id uuid',
        'revision bigint',
        'epoch uuid',
      ]);
      expect(
        await refusal(db.owner`insert into sineobex.team_preset_state (team_id) values (${randomUUID()})`),
      ).toEqual({ code: FOREIGN_KEY, constraint: 'team_preset_state_team_id_fkey' });
    });

    // A phone holding revision N asks for what changed after N (phase 5 design 6.1): a revision
    // taken again at or below N, after the team's revision went back, would never reach it.
    it('never moves back, whoever moves it', async () => {
      const fresh = await makeTeam(db.owner, 'Preset Revision Forward Team');
      for (let i = 0; i < 5; i++) await as(fresh, (tx) => takeRevision(tx, fresh));
      const back = { code: CHECK, constraint: 'team_preset_state_revision_forward' };
      for (const to of [4, 1, 0])
        expect(
          await refusal(
            as(
              fresh,
              (tx) => tx`update sineobex.team_preset_state set revision = ${to} where team_id = ${fresh}`,
            ),
          ),
          `to ${to}`,
        ).toEqual(back);
      expect(
        await refusal(db.owner`update sineobex.team_preset_state set revision = 1 where team_id = ${fresh}`),
      ).toEqual(back);
      // Standing still is no step back, and takeRevision still takes the next.
      await as(
        fresh,
        (tx) => tx`update sineobex.team_preset_state set revision = revision where team_id = ${fresh}`,
      );
      expect(await as(fresh, (tx) => takeRevision(tx, fresh))).toBe(6);
    });

    // The epoch is renewed after a restore, as the owner (docs/setup.md): a new one makes every
    // phone download its team's presets again, so the app role never writes one.
    it('lets the app role write only the revision of a state row', async () => {
      const fresh = await makeTeam(db.owner, 'Preset Revision Rights Team');
      const elsewhere = await makeTeam(db.owner, 'Preset Revision Elsewhere Team');
      await as(fresh, (tx) => takeRevision(tx, fresh));
      const [before] = await db.owner<{ epoch: string }[]>`
        select epoch from sineobex.team_preset_state where team_id = ${fresh}`;
      expect(
        await refusal(
          as(
            fresh,
            (tx) =>
              tx`update sineobex.team_preset_state set epoch = ${randomUUID()} where team_id = ${fresh}`,
          ),
        ),
      ).toEqual({ code: DENIED });
      expect(
        await refusal(
          as(
            fresh,
            (tx) => tx`update sineobex.team_preset_state set team_id = ${elsewhere} where team_id = ${fresh}`,
          ),
        ),
      ).toEqual({ code: DENIED });
      expect(
        await db.owner`select epoch, revision::int as revision from sineobex.team_preset_state
                       where team_id = ${fresh}`,
      ).toEqual([{ epoch: before!.epoch, revision: 1 }]);
      const rights = await db.owner<{ column: string; change: boolean }[]>`
        select c as column, has_column_privilege('sineobex_app', 'sineobex.team_preset_state', c, 'update') as change
        from unnest(array['team_id', 'revision', 'epoch']) c`;
      expect(rights).toEqual([
        { column: 'team_id', change: false },
        { column: 'revision', change: true },
        { column: 'epoch', change: false },
      ]);
    });

    it('gives a team its own epoch, renewed by the restore step', async () => {
      await firstWrite(team);
      await firstWrite(otherTeam);
      const [a, b] = await db.owner<{ epoch: string }[]>`
        select epoch from sineobex.team_preset_state where team_id in (${team}, ${otherTeam}) order by team_id`;
      expect(a!.epoch).not.toBe(b!.epoch);
      // docs/setup.md, "After a database restore".
      await db.owner`update sineobex.team_preset_state set epoch = gen_random_uuid()`;
      const [c, d] = await db.owner<{ epoch: string }[]>`
        select epoch from sineobex.team_preset_state where team_id in (${team}, ${otherTeam}) order by team_id`;
      expect([c!.epoch, d!.epoch]).not.toContain(a!.epoch);
      expect([c!.epoch, d!.epoch]).not.toContain(b!.epoch);
      expect(c!.epoch).not.toBe(d!.epoch);
    });
  });

  describe('a note type head', () => {
    it('is taken from the app role and given back, with what a new head leaves out filled in', async () => {
      const key = noteType().key as string;
      await insertNoteType({
        team_id: team,
        key,
        title: 'Demo: a note type',
        current_version: 2,
        revision: 0,
      });
      const [row] = await inTeam(
        (tx) => tx`
          select title, state, current_version, platform_latest, customized, revision, updated_by,
                 extract(epoch from now() - updated_at)::float8 < 60 as recent
          from sineobex.note_types where key = ${key}`,
      );
      expect(row).toEqual({
        title: 'Demo: a note type',
        state: 'active',
        current_version: 2,
        platform_latest: null,
        customized: false,
        revision: '0',
        updated_by: null,
        recent: true,
      });
      expect((await columnsOf(db.owner, 'note_types')).map((c) => `${c.name} ${c.type}`)).toEqual([
        'team_id uuid',
        'key text',
        'title text',
        'state text',
        'current_version integer',
        'platform_latest integer',
        'customized boolean',
        'revision bigint',
        'updated_by uuid',
        'updated_at timestamp with time zone',
      ]);
    });

    it('names its key as note type versions do, once per team', async () => {
      for (const key of ['Wound_care', '9lives', 'a', 'wound-care', `a${'b'.repeat(61)}`, '']) {
        expect(await refusal(insertNoteType(noteType({ key }))), key).toEqual({
          code: CHECK,
          constraint: 'note_types_key_check',
        });
      }
      // A key the team makes: t_ and 12 hex characters (phase 5 design 4.3).
      expect(await refusal(insertNoteType(noteType({ key: 't_000000000001' })))).toBeNull();
      expect(await refusal(insertNoteType(noteType({ key: 't_000000000001' })))).toEqual({
        code: UNIQUE,
        constraint: 'note_types_pkey',
      });
      expect(
        await refusal(insertNoteType(noteType({ team_id: otherTeam, key: 't_000000000001' }), otherTeam)),
      ).toBeNull();
    });

    it('is active or archived, at a version from 1', async () => {
      expect(await refusal(insertNoteType(noteType({ state: 'deleted' })))).toEqual({
        code: CHECK,
        constraint: 'note_types_state_check',
      });
      for (const [column, value] of [
        ['current_version', 0],
        ['platform_latest', 0],
        ['revision', -1],
      ] as const) {
        expect(await refusal(insertNoteType(noteType({ [column]: value }))), column).toEqual({
          code: CHECK,
          constraint: `note_types_${column}_check`,
        });
      }
      for (const column of [
        'team_id',
        'key',
        'title',
        'state',
        'current_version',
        'customized',
        'revision',
      ]) {
        expect(
          await refusal(
            db.owner`insert into sineobex.note_types ${values(db.owner, noteType({ [column]: null }))}`,
          ),
          column,
        ).toEqual({ code: NOT_NULL });
      }
      expect(await refusal(insertNoteType(noteType({ updated_by: randomUUID() })))).toEqual({
        code: FOREIGN_KEY,
        constraint: 'note_types_updated_by_fkey',
      });
    });

    it('moves its time of last change when it changes', async () => {
      const key = noteType().key as string;
      await insertNoteType(noteType({ key }));
      const [before] = await db.owner<{ at: Date }[]>`
        select updated_at as at from sineobex.note_types where team_id = ${team} and key = ${key}`;
      await inTeam(
        (tx) => tx`update sineobex.note_types set state = 'archived', customized = true, revision = 2,
                   updated_by = ${admin} where key = ${key}`,
      );
      const [after] = await db.owner<{ at: Date; state: string }[]>`
        select updated_at as at, state from sineobex.note_types where team_id = ${team} and key = ${key}`;
      expect(after!.state).toBe('archived');
      expect(after!.at.getTime()).toBeGreaterThan(before!.at.getTime());
    });
  });

  describe('row-level security and the app role’s rights', () => {
    const TABLES = [
      'team_presets',
      'team_preset_versions',
      'team_preset_events',
      'team_preset_state',
      'note_types',
    ];

    it('hides every row of a team from another team, and from a request with no team', async () => {
      await firstWrite(team);
      const id = await preset();
      const key = noteType().key as string;
      await insertNoteType(noteType({ key }));
      await insertEvent(event({ preset_id: id }));
      const seen = (ctx: { teamId?: string }) =>
        asApp(db.appUrl, { ...ctx, userId: admin }, async (tx) => ({
          team_presets: await tx`select distinct team_id from sineobex.team_presets`,
          team_preset_versions: await tx`select distinct team_id from sineobex.team_preset_versions`,
          team_preset_events: await tx`select distinct team_id from sineobex.team_preset_events`,
          team_preset_state: await tx`select distinct team_id from sineobex.team_preset_state`,
          note_types: await tx`select distinct team_id from sineobex.note_types`,
        }));
      const mine = await seen({ teamId: team });
      const theirs = await seen({ teamId: otherTeam });
      const nobodys = await seen({});
      for (const table of TABLES) {
        expect(mine[table as keyof typeof mine], table).toEqual([{ team_id: team }]);
        expect(theirs[table as keyof typeof theirs], table).not.toContainEqual({ team_id: team });
        expect(nobodys[table as keyof typeof nobodys], table).toEqual([]);
      }
    });

    it('takes nothing written or changed across teams', async () => {
      const id = await preset();
      const key = noteType().key as string;
      await insertNoteType(noteType({ key }));
      // Acting in the other team, nobody writes into this one.
      expect(await refusal(insertHead(head(), otherTeam))).toEqual({ code: DENIED });
      expect(await refusal(insertVersion(version(id, { version: 2 }), otherTeam))).toEqual({ code: DENIED });
      expect(await refusal(insertEvent(event({ preset_id: id }), otherTeam))).toEqual({ code: DENIED });
      expect(await refusal(insertNoteType(noteType(), otherTeam))).toEqual({ code: DENIED });
      const stray = await makeTeam(db.owner, 'Preset Stray Team');
      expect(
        await refusal(
          as(otherTeam, (tx) => tx`insert into sineobex.team_preset_state (team_id) values (${stray})`),
        ),
      ).toEqual({ code: DENIED });
      // Nor changes what is here.
      const changed = await as(otherTeam, async (tx) => [
        ...(await tx`update sineobex.team_presets set name = 'Demo: renamed' where id = ${id} returning id`),
        ...(await tx`update sineobex.note_types set state = 'archived' where key = ${key} returning key`),
        ...(await tx`update sineobex.team_preset_state set revision = revision + 1 where team_id = ${team}
                     returning team_id`),
      ]);
      expect(changed).toEqual([]);
      // Nor moves its own preset into this team.
      const own = await preset({}, otherTeam);
      expect(
        await refusal(
          as(otherTeam, (tx) => tx`update sineobex.team_presets set team_id = ${team} where id = ${own}`),
        ),
      ).toEqual({ code: DENIED });
    });

    it('lets a platform-scope request write and read any team’s presets, as team creation installs them', async () => {
      const fresh = await makeTeam(db.owner, 'Preset Platform Team');
      const row = head({ team_id: fresh, kind: 'bundle', origin_key: 'bundle.demo_kit', created_by: null });
      const seen = await asApp(db.appUrl, { userId: admin, platform: true }, async (tx) => {
        await tx`insert into sineobex.team_preset_state (team_id, revision) values (${fresh}, 1)`;
        await tx`insert into sineobex.team_presets ${values(tx, { ...row, updated_by: null })}`;
        await tx`insert into sineobex.team_preset_versions ${values(
          tx,
          version(row.id as string, { team_id: fresh, source: 'platform', created_by: null }),
        )}`;
        await tx`insert into sineobex.team_preset_events ${values(
          tx,
          event({ team_id: fresh, preset_id: row.id, act: 'installed', reason: null, created_by: null }),
        )}`;
        return tx<{ teamId: string }[]>`
          select distinct p.team_id as "teamId" from sineobex.team_presets p
          where p.team_id in (${team}, ${fresh})`;
      });
      expect(seen.map((r) => r.teamId).sort()).toEqual([team, fresh].sort());
    });

    it('gives the app role every right but delete, no update of a version or an event, and of a state row only its revision', async () => {
      const rights = await db.owner<
        { table: string; read: boolean; add: boolean; change: boolean; remove: boolean }[]
      >`
        select t as table,
               has_table_privilege('sineobex_app', 'sineobex.' || t, 'select') as read,
               has_table_privilege('sineobex_app', 'sineobex.' || t, 'insert') as add,
               has_table_privilege('sineobex_app', 'sineobex.' || t, 'update') as change,
               has_table_privilege('sineobex_app', 'sineobex.' || t, 'delete') as remove
        from unnest(${TABLES}::text[]) t order by t`;
      expect(rights).toEqual([
        { table: 'note_types', read: true, add: true, change: true, remove: false },
        { table: 'team_preset_events', read: true, add: true, change: false, remove: false },
        // Its revision only: the rows themselves are not the app role's to change.
        { table: 'team_preset_state', read: true, add: true, change: false, remove: false },
        { table: 'team_preset_versions', read: true, add: true, change: false, remove: false },
        { table: 'team_presets', read: true, add: true, change: true, remove: false },
      ]);
      const id = await preset();
      const key = noteType().key as string;
      await insertNoteType(noteType({ key }));
      for (const statement of [
        (tx: TransactionSql) => tx`delete from sineobex.team_presets where id = ${id}`,
        (tx: TransactionSql) => tx`delete from sineobex.note_types where key = ${key}`,
        (tx: TransactionSql) => tx`delete from sineobex.team_preset_state where team_id = ${team}`,
      ]) {
        expect(await refusal(inTeam(statement))).toEqual({ code: DENIED });
      }
    });
  });
});

describe('0023 on a database that holds teams and note types already', () => {
  let db: ScratchDatabase;
  let dir: string;
  let withTypes: string;
  let without: string;
  let edited: string;
  let before: unknown[];

  const versionsOf = (owner: Sql) =>
    owner`select to_jsonb(v) as row from sineobex.note_type_versions v order by team_id, key, version`;

  beforeAll(async () => {
    // Every migration before 0023, and teams with the note type versions phase 4 writes.
    dir = await mkdtemp(join(tmpdir(), 'sineobex-0022-'));
    for (const f of await readdir(MIGRATIONS_DIR)) {
      if (f.endsWith('.sql') && f < '0023') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    db = await createScratchDatabase({ migrate: false });
    await migrate(db.owner, { dir });
    withTypes = await makeTeam(db.owner, 'Preset Upgrade Team');
    without = await makeTeam(db.owner, 'Preset Upgrade Empty Team');
    edited = await makeTeam(db.owner, 'Preset Upgrade Edited Team');
    const put = (team: string, key: string, version: number, definition: Row, origin = 'preset') =>
      db.owner`insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin, preset_version)
               values (${team}, ${key}, ${version}, ${db.owner.json(definition as never)}, ${HASH}, ${origin},
                       ${origin === 'preset' ? version : null})`;
    await put(withTypes, 'wound_care', 1, { key: 'wound_care', version: 1, title: 'Demo: wound care' });
    await put(withTypes, 'wound_care', 2, {
      key: 'wound_care',
      version: 2,
      title: 'Demo: wound care, worded again',
    });
    await put(withTypes, 'outreach', 1, { key: 'outreach', version: 1, title: 'Demo: outreach' });
    await put(edited, 'vitals', 1, { key: 'vitals', version: 1, title: 'Demo: vitals' });
    await put(
      edited,
      'vitals',
      2,
      { key: 'vitals', version: 2, title: 'Demo: vitals, the team’s own' },
      'team',
    );
    await put(edited, 'untitled', 1, { key: 'untitled', version: 1 });
    await put(edited, 'blank_title', 1, { key: 'blank_title', version: 1, title: '  ' });
    before = await versionsOf(db.owner);
    await migrate(db.owner);
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('gives every team a state row at revision 0, each with an epoch of its own', async () => {
    const rows = await db.owner<{ teamId: string; revision: string; epoch: string }[]>`
      select team_id as "teamId", revision, epoch from sineobex.team_preset_state`;
    expect(rows.map((r) => r.teamId).sort()).toEqual([withTypes, without, edited].sort());
    expect(rows.map((r) => r.revision)).toEqual(['0', '0', '0']);
    expect(new Set(rows.map((r) => r.epoch)).size).toBe(3);
  });

  it('gives every key a team holds its head, at its newest version, at revision 0', async () => {
    const heads = await db.owner`
      select team_id, key, title, state, current_version, platform_latest, customized, revision, updated_by
      from sineobex.note_types order by team_id, key`;
    const expected = [
      [withTypes, 'outreach', 'Demo: outreach', 1, 1, false],
      [withTypes, 'wound_care', 'Demo: wound care, worded again', 2, 2, false],
      // The team's own version is the newest: customized, so no platform version goes above it.
      [edited, 'vitals', 'Demo: vitals, the team’s own', 2, 1, true],
      // A definition with no title, or a blank one, is named by its key.
      [edited, 'untitled', 'untitled', 1, 1, false],
      [edited, 'blank_title', 'blank_title', 1, 1, false],
    ].map(([team_id, key, title, current_version, platform_latest, customized]) => ({
      team_id,
      key,
      title,
      state: 'active',
      current_version,
      platform_latest,
      customized,
      revision: '0',
      updated_by: null,
    }));
    const order = (rows: Row[]) =>
      [...rows].sort((a, b) =>
        `${a.team_id as string} ${a.key as string}` < `${b.team_id as string} ${b.key as string}` ? -1 : 1,
      );
    expect(order(heads as unknown as Row[])).toEqual(order(expected));
    // A team holding no versions has no heads.
    expect(heads.filter((h) => h.team_id === without)).toEqual([]);
  });

  it('keeps every note type version as it was', async () => {
    expect(await versionsOf(db.owner)).toEqual(before);
  });

  it('leaves a team made afterwards without a state row until its first write', async () => {
    const later = await makeTeam(db.owner, 'Preset Upgrade Later Team');
    expect(await db.owner`select 1 from sineobex.team_preset_state where team_id = ${later}`).toEqual([]);
  });
});
