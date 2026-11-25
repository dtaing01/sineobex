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

// 0024: a patient's flag changes (phase 5 design 4.5, 6.2). A change sets or clears one flag, is
// created once and may be marked entered in error once, with a reason; nothing else about it ever
// changes, and nothing deletes it. patient_of_change learns the entity, a notice names the patient
// a held change was about, and the team index moves at every change. Made-up people and flags only.

const CHECK = '23514';
const FOREIGN_KEY = '23503';
const NOT_NULL = '23502';
const DENIED = '42501';
type Row = Record<string, unknown>;

/** What the mark writes: the status, why, who and when, and its bookkeeping. */
const MARK_COLUMNS = [
  'status',
  'error_reason',
  'error_by',
  'error_at',
  'version',
  'field_versions',
  'field_meta',
];

async function insertPatient(owner: Sql, team: string, author: string): Promise<string> {
  const id = randomUUID();
  await owner`
    insert into sineobex.patients (id, team_id, canonical_id, preferred_name, registered_at, author_user_id)
    values (${id}, ${team}, ${id}, 'Demo person', now(), ${author})`;
  return id;
}

async function insertDevice(owner: Sql, team: string, user: string): Promise<string> {
  const id = randomUUID();
  await owner`insert into sineobex.devices (id, team_id, user_id, platform, app_version, public_key)
              values (${id}, ${team}, ${user}, 'other', 'test', ${'A'.repeat(43)})`;
  return id;
}

let presets = 0;
/** A preset head as the admin routes write one: under the revision its write takes. */
async function insertPreset(
  owner: Sql,
  team: string,
  { kind = 'flag', state = 'active' }: { kind?: string; state?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await owner.begin(async (tx) => {
    const revision = await takeRevision(tx, team);
    await tx`
      insert into sineobex.team_presets (id, team_id, kind, name, state, current_version, revision)
      values (${id}, ${team}, ${kind}, ${`Demo: ${kind} ${++presets}`}, ${state}, 1, ${revision})`;
  });
  return id;
}

/** A change held for review: the record is not on the chart, and the queue must still name its patient. */
async function hold(
  owner: Sql,
  by: { team: string; device: string; user: string },
  entity: string,
  record: string,
  value: unknown,
  held: { op?: string; at?: Date } = {},
) {
  await owner`
    insert into sineobex.quarantine_items (team_id, device_id, user_id, change_id, entity, record_id, op,
      value, value_hash, device_time, reason, received_at)
    values (${by.team}, ${by.device}, ${by.user}, ${randomUUID()}, ${entity}, ${record}, ${held.op ?? 'create'},
      ${owner.json(value as never)}, ${'0'.repeat(64)}, now(), 'permission', ${held.at ?? new Date()})`;
}

describe('0024 patient flag changes', () => {
  let db: ScratchDatabase;
  let team: string;
  let otherTeam: string;
  let worker: string;
  let admin: string;
  let device: string;
  let otherDevice: string;
  let patient: string;
  let elsewhere: string;
  let otherPatient: string;
  let flag: string;
  let secondFlag: string;
  let otherFlag: string;

  const as = <T>(teamId: string, run: (tx: TransactionSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: worker }, run);
  const inTeam = <T>(run: (tx: TransactionSql) => Promise<T>) => as(team, run);

  // A whole change, as the API writes one a phone made: set by the worker, a minute before now.
  const change = (over: Row = {}): Row => ({
    id: randomUUID(),
    team_id: team,
    patient_id: patient,
    flag_id: flag,
    action: 'set',
    reason: 'Demo: slept outside in the frost',
    effective_at: new Date(Date.now() - 60_000),
    device_time: new Date(Date.now() - 60_000),
    clock_verified: true,
    author_user_id: worker,
    created_device_id: device,
    change_id: randomUUID(),
    ...over,
  });
  const JSON_COLUMNS = ['field_versions', 'field_meta'];
  const values = (tx: Sql | TransactionSql, row: Row) => {
    const out: Row = { ...row };
    for (const c of JSON_COLUMNS) if (c in out && out[c] !== null) out[c] = tx.json(out[c] as never);
    return tx(out);
  };
  const insert = (over: Row = {}, teamId = team) => {
    const row = change(over);
    return {
      id: row.id as string,
      done: as(teamId, (tx) => tx`insert into sineobex.patient_flag_changes ${values(tx, row)}`),
    };
  };
  const omit = (row: Row, ...columns: string[]) =>
    Object.fromEntries(Object.entries(row).filter(([c]) => !columns.includes(c)));
  /** The refusal of one change that differs from a whole one by `over`. */
  const refused = (over: Row, teamId = team) => refusal(insert(over, teamId).done);
  const refusedAsOwner = (over: Row) =>
    refusal(db.owner`insert into sineobex.patient_flag_changes ${values(db.owner, change(over))}`);
  const made = async (over: Row = {}, teamId = team) => {
    const { id, done } = insert(over, teamId);
    await done;
    return id;
  };
  /** One update of one change, as the app role in the team or as the owner, whom no policy stops. */
  const update = (id: string, set: Row, { owner = false } = {}) =>
    refusal(
      owner
        ? db.owner`update sineobex.patient_flag_changes set ${values(db.owner, set)} where id = ${id}`
        : inTeam((tx) => tx`update sineobex.patient_flag_changes set ${values(tx, set)} where id = ${id}`),
    );
  /** Everything the change holds, as the owner reads it. */
  const rowOf = async (id: string) =>
    (
      await db.owner<{ row: Row }[]>`
        select to_jsonb(f) as row from sineobex.patient_flag_changes f where id = ${id}`
    )[0]!.row;
  /** The mark as the sync write makes it (set_once, with bookkeeping), from the version it stands on. */
  const theMark = (version: number, over: Row = {}): Row => ({
    status: 'entered_in_error',
    error_reason: 'Demo: set on the wrong person',
    error_by: admin,
    error_at: new Date(),
    field_versions: { enteredInError: 1 },
    field_meta: { enteredInError: { by: admin, at: new Date().toISOString(), changeId: randomUUID() } },
    version: version + 1,
    ...over,
  });

  beforeAll(async () => {
    db = await createScratchDatabase();
    team = await makeTeam(db.owner, 'Flag Team');
    otherTeam = await makeTeam(db.owner, 'Flag Other Team');
    worker = await makeUser(db.owner, 'flag-worker@example.com');
    admin = await makeUser(db.owner, 'flag-admin@example.com');
    device = await insertDevice(db.owner, team, worker);
    otherDevice = await insertDevice(db.owner, team, admin);
    patient = await insertPatient(db.owner, team, worker);
    elsewhere = await insertPatient(db.owner, team, worker);
    otherPatient = await insertPatient(db.owner, otherTeam, worker);
    flag = await insertPreset(db.owner, team);
    secondFlag = await insertPreset(db.owner, team);
    otherFlag = await insertPreset(db.owner, otherTeam);
  });
  afterAll(() => db.drop());

  it('takes a change from the app role and gives it back', async () => {
    const at = new Date(Date.now() - 120_000);
    const id = await made({ effective_at: at, device_time: at, action: 'clear' });
    const found = await inTeam(
      (tx) => tx`
        select patient_id, flag_id, action, reason, effective_at, device_time, clock_verified, author_user_id,
               created_device_id
        from sineobex.patient_flag_changes where id = ${id}`,
    );
    expect(found).toEqual([
      {
        patient_id: patient,
        flag_id: flag,
        action: 'clear',
        reason: 'Demo: slept outside in the frost',
        effective_at: at,
        device_time: at,
        clock_verified: true,
        author_user_id: worker,
        created_device_id: device,
      },
    ]);
  });

  it('takes and gives back a change of any team to a platform-scope request', async () => {
    const row = change();
    const seen = await asApp(db.appUrl, { userId: worker, platform: true }, async (tx) => {
      await tx`insert into sineobex.patient_flag_changes ${values(tx, row)}`;
      return tx<
        { teamId: string }[]
      >`select team_id as "teamId" from sineobex.patient_flag_changes where id = ${row.id as string}`;
    });
    expect(seen).toEqual([{ teamId: team }]);
  });

  it('holds a flag, an action, a reason, its times, who and from where, the mark and the bookkeeping', async () => {
    const columns = await db.owner<{ name: string; type: string }[]>`
      select column_name as name, data_type as type from information_schema.columns
      where table_schema = 'sineobex' and table_name = 'patient_flag_changes' order by ordinal_position`;
    expect(columns.map((c) => `${c.name} ${c.type}`)).toEqual([
      'id uuid',
      'team_id uuid',
      'patient_id uuid',
      'flag_id uuid',
      'action text',
      'reason text',
      'effective_at timestamp with time zone',
      'device_time timestamp with time zone',
      'clock_verified boolean',
      'author_user_id uuid',
      'created_device_id uuid',
      'change_id uuid',
      'approved_by uuid',
      'status text',
      'error_reason text',
      'error_by uuid',
      'error_at timestamp with time zone',
      'version integer',
      'field_versions jsonb',
      'field_meta jsonb',
      'received_at timestamp with time zone',
      'updated_at timestamp with time zone',
    ]);
  });

  it('fills in what a new change leaves out', async () => {
    const id = await made({ device_time: null, created_device_id: null, change_id: null });
    const [row] = await db.owner`
      select status, error_reason, error_by, error_at, approved_by, field_versions, field_meta, version,
             extract(epoch from now() - received_at)::float8 as age, updated_at = received_at as untouched
      from sineobex.patient_flag_changes where id = ${id}`;
    const { age, ...rest } = row as { age: number };
    expect(rest).toEqual({
      status: 'active',
      error_reason: null,
      error_by: null,
      error_at: null,
      approved_by: null,
      field_versions: {},
      field_meta: {},
      version: 1,
      untouched: true,
    });
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(60);
    const plain = omit(change(), 'clock_verified');
    await inTeam((tx) => tx`insert into sineobex.patient_flag_changes ${values(tx, plain)}`);
    const [verified] = await db.owner<{ clockVerified: boolean }[]>`
      select clock_verified as "clockVerified" from sineobex.patient_flag_changes where id = ${plain.id as string}`;
    expect(verified).toEqual({ clockVerified: false });
  });

  it('takes a change made in the portal, which names no phone, no phone time and no sync change', async () => {
    const id = await made({
      device_time: null,
      created_device_id: null,
      change_id: null,
      effective_at: new Date(),
    });
    const [row] = await db.owner`
      select device_time, created_device_id, change_id from sineobex.patient_flag_changes where id = ${id}`;
    expect(row).toEqual({ device_time: null, created_device_id: null, change_id: null });
  });

  it('takes a change a Program Admin accepted from review, naming who', async () => {
    const id = await made({ approved_by: admin });
    const [row] = await db.owner`select approved_by from sineobex.patient_flag_changes where id = ${id}`;
    expect(row).toEqual({ approved_by: admin });
  });

  it('refuses a change with a part missing', async () => {
    const required = [
      ...['id', 'team_id', 'patient_id', 'flag_id', 'action', 'reason', 'effective_at', 'clock_verified'],
      ...['author_user_id', 'status', 'version', 'field_versions', 'field_meta', 'received_at', 'updated_at'],
    ];
    for (const column of required) {
      expect(await refusedAsOwner({ [column]: null }), column).toEqual({ code: NOT_NULL });
    }
    // The server says what, for whom and when: nothing is made up for a part left out. The phone,
    // its time and the sync change are the portal's to leave out.
    const optional = ['device_time', 'created_device_id', 'change_id', 'clock_verified'];
    for (const column of Object.keys(change()).filter((c) => !optional.includes(c))) {
      const rest = omit(change(), column);
      expect(
        await refusal(db.owner`insert into sineobex.patient_flag_changes ${values(db.owner, rest)}`),
        `no ${column}`,
      ).toEqual({ code: NOT_NULL });
    }
  });

  it('sets or clears a flag, and does nothing else', async () => {
    for (const action of ['toggle', 'Set', 'cleared', '', 'set ']) {
      expect(await refused({ action }), JSON.stringify(action)).toEqual({
        code: CHECK,
        constraint: 'patient_flag_changes_action_check',
      });
    }
    expect(await refused({ action: 'set' })).toBeNull();
    expect(await refused({ action: 'clear' })).toBeNull();
  });

  it('gives a reason of 1 to 500 code points, counted as the phone counts them', async () => {
    const refusedReason = { code: CHECK, constraint: 'patient_flag_changes_reason_check' };
    // One code point each, two UTF-16 units each in TypeScript and Dart: counted once here.
    const astral = '\u{1F9CA}';
    for (const reason of ['', '   ', 'é'.repeat(501), astral.repeat(501)]) {
      expect(await refused({ reason }), `${[...reason].length} code points`).toEqual(refusedReason);
    }
    for (const reason of ['D', 'é'.repeat(500), astral.repeat(500), `  ${'é'.repeat(500)}  `]) {
      expect(await refused({ reason }), `${[...reason].length} code points`).toBeNull();
    }
  });

  it('is never dated after the server received it', async () => {
    const receivedAt = new Date(Date.now() - 3_600_000);
    const tied = { code: CHECK, constraint: 'patient_flag_changes_not_after_receipt' };
    expect(
      await refused({ received_at: receivedAt, effective_at: new Date(receivedAt.getTime() + 1) }),
    ).toEqual(tied);
    // A phone whose clock runs ahead is answered by the server's receipt, never by its own time.
    expect(await refused({ effective_at: new Date(Date.now() + 60_000) })).toEqual(tied);
    expect(await refused({ received_at: receivedAt, effective_at: receivedAt })).toBeNull();
    expect(
      await refused({ received_at: receivedAt, effective_at: new Date(receivedAt.getTime() - 86_400_000) }),
    ).toBeNull();
  });

  it('is about a patient of its own team', async () => {
    const constraint = 'patient_flag_changes_team_id_patient_id_fkey';
    expect(await refused({ patient_id: randomUUID() })).toEqual({ code: FOREIGN_KEY, constraint });
    expect(await refused({ patient_id: otherPatient })).toEqual({ code: FOREIGN_KEY, constraint });
    // As the owner, which no policy stops: the key holds the team.
    expect(await refusedAsOwner({ patient_id: otherPatient })).toEqual({ code: FOREIGN_KEY, constraint });
  });

  it('names a preset of its own team: that the preset is a flag is the sync rule’s to check', async () => {
    const constraint = 'patient_flag_changes_team_id_flag_id_fkey';
    expect(await refused({ flag_id: randomUUID() })).toEqual({ code: FOREIGN_KEY, constraint });
    expect(await refused({ flag_id: otherFlag })).toEqual({ code: FOREIGN_KEY, constraint });
    expect(await refusedAsOwner({ flag_id: otherFlag })).toEqual({ code: FOREIGN_KEY, constraint });
    // The other team's own change, of its own flag, is fine.
    expect(
      await refused(
        { team_id: otherTeam, patient_id: otherPatient, flag_id: otherFlag, created_device_id: null },
        otherTeam,
      ),
    ).toBeNull();
    // A flag archived since stays on the patient (design 5.1), and the database takes any kind.
    expect(await refused({ flag_id: await insertPreset(db.owner, team, { state: 'archived' }) })).toBeNull();
    expect(await refused({ flag_id: await insertPreset(db.owner, team, { kind: 'item' }) })).toBeNull();
  });

  it('names real people, a real phone and a real team', async () => {
    const nobody = randomUUID();
    for (const column of ['team_id', 'author_user_id', 'created_device_id', 'approved_by']) {
      // As the owner, so a made-up team is answered by the key and not by the team policy.
      expect(await refusedAsOwner({ [column]: nobody }), column).toEqual({
        code: FOREIGN_KEY,
        constraint: `patient_flag_changes_${column}_fkey`,
      });
    }
    expect(
      await refusedAsOwner({
        status: 'entered_in_error',
        error_reason: 'Demo: wrong person',
        error_by: nobody,
        error_at: new Date(),
      }),
    ).toEqual({ code: FOREIGN_KEY, constraint: 'patient_flag_changes_error_by_fkey' });
  });

  describe('entered in error', () => {
    const retraction = () => ({
      status: 'entered_in_error',
      error_reason: 'Demo: set on the wrong person',
      error_by: admin,
      error_at: new Date(),
    });
    const TIED = { code: CHECK, constraint: 'patient_flag_changes_error_with_status' };

    it('is the only other state', async () => {
      for (const status of ['cleared', 'archived', 'Active', '']) {
        expect(await refused({ status }), status).toEqual({
          code: CHECK,
          constraint: 'patient_flag_changes_status_check',
        });
      }
      expect(await refused(retraction())).toBeNull();
    });

    it('says why, who and when, all three, and an active change says none', async () => {
      const whole = retraction();
      for (const column of ['error_reason', 'error_by', 'error_at']) {
        // The mark without one of its parts.
        expect(await refused({ ...whole, [column]: null }), `without ${column}`).toEqual(TIED);
        // One part without the mark.
        const part = { [column]: whole[column as keyof typeof whole] };
        expect(await refused(part), `only ${column}`).toEqual(TIED);
      }
      expect(await refused({ status: 'entered_in_error' })).toEqual(TIED);
      expect(await refused({ ...whole, status: 'active' })).toEqual(TIED);
      expect(await refused(whole)).toBeNull();
      // A mark that leaves out why or when is refused as an insert is.
      const id = await made();
      expect(await update(id, theMark(1, { error_reason: null }))).toEqual(TIED);
      expect(await update(id, theMark(1, { error_at: null }))).toEqual(TIED);
    });

    it('gives a reason of 3 to 300 characters', async () => {
      const refusedReason = { code: CHECK, constraint: 'patient_flag_changes_error_reason_check' };
      for (const reason of ['', 'no', '  no  ', 'é'.repeat(301)]) {
        expect(
          await refused({ ...retraction(), error_reason: reason }),
          `${reason.length} characters`,
        ).toEqual(refusedReason);
      }
      expect(await refused({ ...retraction(), error_reason: 'é'.repeat(300) })).toBeNull();
      expect(await refused({ ...retraction(), error_reason: 'typ' })).toBeNull();
    });
  });

  describe('the one mark (the guard)', () => {
    const MARKED_ONCE = { code: CHECK, constraint: 'patient_flag_changes_marked_once' };
    const ONLY_THE_MARK = { code: CHECK, constraint: 'patient_flag_changes_only_the_mark' };
    const MARK_VERSION = { code: CHECK, constraint: 'patient_flag_changes_mark_version' };
    const keeps = (column: string) => ({ code: CHECK, constraint: `patient_flag_changes_keeps_${column}` });
    /** The row without what the mark writes and the touch trigger moves. */
    const kept = (row: Row) =>
      Object.fromEntries(
        Object.entries(row).filter(([c]) => !MARK_COLUMNS.includes(c) && c !== 'updated_at'),
      );

    it('marks a change once, with its bookkeeping, and keeps everything else', async () => {
      const id = await made();
      const before = await rowOf(id);
      const markedAt = new Date(Date.now() - 1_000);
      const meta = { enteredInError: { by: admin, at: markedAt.toISOString(), changeId: randomUUID() } };
      // As the sync write makes it: the status, why, who and when, then its bookkeeping.
      const marked = await inTeam(
        (tx) => tx<{ version: number }[]>`
          update sineobex.patient_flag_changes
          set status = 'entered_in_error', error_reason = 'Demo: set on the wrong person', error_by = ${admin},
              error_at = ${markedAt},
              field_versions = field_versions || jsonb_build_object('enteredInError'::text, 1::int),
              field_meta = field_meta || ${tx.json(meta as never)},
              version = version + 1
          where id = ${id} returning version`,
      );
      expect(marked).toEqual([{ version: 2 }]);
      const after = await rowOf(id);
      expect(kept(after)).toEqual(kept(before));
      expect(after).toMatchObject({
        status: 'entered_in_error',
        error_reason: 'Demo: set on the wrong person',
        error_by: admin,
        version: 2,
        field_versions: { enteredInError: 1 },
        field_meta: meta,
      });
      expect(new Date(after.error_at as string)).toEqual(markedAt);
      const [moved] = await db.owner<{ moved: boolean }[]>`
        select updated_at > received_at as moved from sineobex.patient_flag_changes where id = ${id}`;
      expect(moved).toEqual({ moved: true });
    });

    it('refuses a second mark, whatever it says, and every update after the mark', async () => {
      const id = await made();
      expect(await update(id, theMark(1))).toBeNull();
      const marked = await rowOf(id);
      for (const owner of [false, true]) {
        const who = owner ? 'as the owner' : 'as the app role';
        expect(
          await update(id, theMark(2, { error_reason: 'Demo: a second reason' }), { owner }),
          who,
        ).toEqual(MARKED_ONCE);
        expect(await update(id, theMark(2, { error_by: worker }), { owner }), who).toEqual(MARKED_ONCE);
        // Taken back, or touched without a change.
        expect(
          await update(
            id,
            { status: 'active', error_reason: null, error_by: null, error_at: null, version: 3 },
            { owner },
          ),
          who,
        ).toEqual(MARKED_ONCE);
        expect(await update(id, { version: 2 }, { owner }), who).toEqual(MARKED_ONCE);
        expect(await update(id, { reason: 'Demo: rewritten' }, { owner }), who).toEqual(MARKED_ONCE);
      }
      expect(await rowOf(id)).toEqual(marked);
    });

    it('refuses an update that is not the mark, one that changes nothing or only the bookkeeping too', async () => {
      const id = await made();
      const before = await rowOf(id);
      for (const owner of [false, true]) {
        const who = owner ? 'as the owner' : 'as the app role';
        expect(await update(id, { version: 1 }, { owner }), `${who}: nothing`).toEqual(ONLY_THE_MARK);
        expect(await update(id, { status: 'active' }, { owner }), `${who}: active`).toEqual(ONLY_THE_MARK);
        expect(
          await update(id, { version: 2, field_versions: { enteredInError: 1 }, field_meta: {} }, { owner }),
          `${who}: the bookkeeping`,
        ).toEqual(ONLY_THE_MARK);
        expect(await update(id, { updated_at: new Date() }, { owner }), `${who}: its time`).toEqual(
          ONLY_THE_MARK,
        );
      }
      expect(await rowOf(id)).toEqual(before);
    });

    it('keeps every column but the mark’s, with the mark or without it', async () => {
      const id = await made({ approved_by: null });
      const before = await rowOf(id);
      const later = new Date(Date.now() + 3_600_000);
      // A value each column could hold, unlike the one it holds.
      const others: Row = {
        id: randomUUID(),
        team_id: otherTeam,
        patient_id: elsewhere,
        flag_id: secondFlag,
        action: 'clear',
        reason: 'Demo: rewritten later',
        effective_at: new Date(Date.now() - 86_400_000),
        device_time: new Date(Date.now() - 86_400_000),
        clock_verified: false,
        author_user_id: admin,
        created_device_id: otherDevice,
        change_id: randomUUID(),
        approved_by: admin,
        received_at: later,
      };
      // Every column is the mark's or kept: one a later migration adds must be named here too.
      const columns = Object.keys(before).sort();
      expect(columns).toEqual([...MARK_COLUMNS, 'updated_at', ...Object.keys(others)].sort());
      for (const [column, value] of Object.entries(others)) {
        expect(await update(id, { [column]: value }, { owner: true }), `${column} alone`).toEqual(
          keeps(column),
        );
        expect(
          await update(id, { ...theMark(1), [column]: value }, { owner: true }),
          `${column} with the mark`,
        ).toEqual(keeps(column));
      }
      // A create sent again as an upsert rewrites nothing either: its update is an update.
      expect(
        await refusal(
          inTeam(
            (tx) => tx`
              insert into sineobex.patient_flag_changes ${values(tx, change({ id, reason: 'Demo: sent again' }))}
              on conflict (id) do update set reason = excluded.reason`,
          ),
        ),
      ).toEqual(keeps('reason'));
      expect(await rowOf(id)).toEqual(before);
    });

    it('moves the version by one with the mark', async () => {
      const id = await made();
      for (const version of [1, 3, 0]) {
        expect(await update(id, { ...theMark(1), version }), `version ${version}`).toEqual(MARK_VERSION);
      }
      expect(await update(id, theMark(1))).toBeNull();
    });

    it('refuses a mark without its bookkeeping, or with bookkeeping that is not the mark’s', async () => {
      const MARK_BOOKKEEPING = { code: CHECK, constraint: 'patient_flag_changes_mark_bookkeeping' };
      const id = await made();
      const before = await rowOf(id);
      const markedAt = new Date();
      const meta = (over: Row = {}) => ({
        by: admin,
        at: markedAt.toISOString(),
        changeId: randomUUID(),
        ...over,
      });
      const { field_versions: _v, field_meta: _m, ...bare } = theMark(1, { error_at: markedAt });
      const wrong: [string, Row][] = [
        // The status, why, who and when and the version, and nothing of the field's.
        ['no bookkeeping', bare],
        ['emptied', { field_versions: {}, field_meta: {} }],
        ['no field version', { field_versions: {} }],
        ['another field’s version', { field_versions: { somethingElse: 9 } }],
        ['the field’s version and another’s', { field_versions: { enteredInError: 1, somethingElse: 9 } }],
        ['a later field version', { field_versions: { enteredInError: 2 } }],
        ['no field meta', { field_meta: {} }],
        ['another field’s meta', { field_meta: { somethingElse: meta() } }],
        ['the field’s meta and another’s', { field_meta: { enteredInError: meta(), somethingElse: meta() } }],
        ['meta naming someone else', { field_meta: { enteredInError: meta({ by: worker }) } }],
        ['meta naming nobody', { field_meta: { enteredInError: meta({ by: null }) } }],
        [
          'meta naming someone else, long ago',
          { field_meta: { enteredInError: meta({ by: worker, at: '1999-01-01T00:00:00.000Z' }) } },
        ],
        ['meta that is no object', { field_meta: { enteredInError: 'Demo: marked' } }],
      ];
      for (const owner of [false, true]) {
        const who = owner ? 'as the owner' : 'as the app role';
        for (const [what, over] of wrong) {
          const set = what === 'no bookkeeping' ? over : theMark(1, { error_at: markedAt, ...over });
          expect(await update(id, set, { owner }), `${who}: ${what}`).toEqual(MARK_BOOKKEEPING);
        }
      }
      expect(await rowOf(id)).toEqual(before);
      // The mark as the sync write makes it, its meta naming who marked it, is taken.
      expect(
        await update(id, theMark(1, { error_at: markedAt, field_meta: { enteredInError: meta() } })),
      ).toBeNull();
    });

    it('keeps the field meta it had, beside the mark’s', async () => {
      const MARK_BOOKKEEPING = { code: CHECK, constraint: 'patient_flag_changes_mark_bookkeeping' };
      const earlier = { by: worker, at: new Date(Date.now() - 60_000).toISOString(), changeId: null };
      const id = await made({ field_versions: { somethingElse: 3 }, field_meta: { somethingElse: earlier } });
      const mark = { by: admin, at: new Date().toISOString(), changeId: randomUUID() };
      expect(
        await update(
          id,
          theMark(1, { field_versions: { enteredInError: 1 }, field_meta: { enteredInError: mark } }),
        ),
        'the others dropped',
      ).toEqual(MARK_BOOKKEEPING);
      expect(
        await update(
          id,
          theMark(1, {
            field_versions: { somethingElse: 3, enteredInError: 1 },
            field_meta: { somethingElse: { ...earlier, by: admin }, enteredInError: mark },
          }),
        ),
        'another rewritten',
      ).toEqual(MARK_BOOKKEEPING);
      expect(
        await update(
          id,
          theMark(1, {
            field_versions: { somethingElse: 3, enteredInError: 1 },
            field_meta: { somethingElse: earlier, enteredInError: mark },
          }),
        ),
      ).toBeNull();
      expect(await rowOf(id)).toMatchObject({
        version: 2,
        field_versions: { somethingElse: 3, enteredInError: 1 },
        field_meta: { somethingElse: earlier, enteredInError: mark },
      });
    });
  });

  it('is never deleted by the app role', async () => {
    const id = await made();
    expect(
      await refusal(inTeam((tx) => tx`delete from sineobex.patient_flag_changes where id = ${id}`)),
    ).toEqual({ code: DENIED });
    const [rights] = await db.owner<{ read: boolean; add: boolean; change: boolean; remove: boolean }[]>`
      select has_table_privilege('sineobex_app', 'sineobex.patient_flag_changes', 'select') as read,
             has_table_privilege('sineobex_app', 'sineobex.patient_flag_changes', 'insert') as add,
             has_table_privilege('sineobex_app', 'sineobex.patient_flag_changes', 'update') as change,
             has_table_privilege('sineobex_app', 'sineobex.patient_flag_changes', 'delete') as remove`;
    expect(rights).toEqual({ read: true, add: true, change: true, remove: false });
  });

  it('hides a team’s changes from another team, and takes none written or marked across teams', async () => {
    const id = await made();
    const seen = (teamId: string) =>
      as(
        teamId,
        (tx) =>
          tx<{ teamId: string }[]>`select distinct team_id as "teamId" from sineobex.patient_flag_changes`,
      );
    expect(await seen(team)).toEqual([{ teamId: team }]);
    expect(await seen(otherTeam)).not.toContainEqual({ teamId: team });
    // Acting in the other team, nobody writes into this one, and nobody marks what is here.
    expect(await refused({}, otherTeam)).toEqual({ code: DENIED });
    const markedThere = await as(
      otherTeam,
      (tx) => tx`
        update sineobex.patient_flag_changes
        set status = 'entered_in_error', error_reason = 'Demo: not ours', error_by = ${admin}, error_at = now(),
            version = version + 1
        where id = ${id} returning id`,
    );
    expect(markedThere).toEqual([]);
    expect(await rowOf(id)).toMatchObject({ status: 'active', version: 1 });
  });

  it('has the key other tables point at, and the index a chart reads in order', async () => {
    const indexes = await db.owner<{ name: string; definition: string; unique: boolean }[]>`
      select c.relname as name, regexp_replace(pg_get_indexdef(i.indexrelid), '^.* USING ', '') as definition,
             i.indisunique as unique
      from pg_index i join pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'sineobex.patient_flag_changes'::regclass and not i.indisprimary order by c.relname`;
    expect(indexes).toEqual([
      {
        name: 'patient_flag_changes_patient',
        definition: 'btree (team_id, patient_id, effective_at, id)',
        unique: false,
      },
      { name: 'patient_flag_changes_team_id_key', definition: 'btree (team_id, id)', unique: true },
    ]);
  });

  it('has its triggers: the guard, the touch, and the team index’s', async () => {
    const triggers = await db.owner<{ name: string; fn: string }[]>`
      select t.tgname as name, p.proname as fn from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'sineobex.patient_flag_changes'::regclass and not t.tgisinternal order by t.tgname`;
    expect(triggers).toEqual([
      { name: 'patient_flag_changes_index_insert', fn: 'bump_team_index' },
      { name: 'patient_flag_changes_index_update', fn: 'bump_team_index' },
      { name: 'patient_flag_changes_one_mark', fn: 'guard_flag_change' },
      { name: 'patient_flag_changes_touch', fn: 'touch_updated_at' },
    ]);
  });

  describe('the team index version', () => {
    const version = async (teamId: string) =>
      Number(
        (
          await db.owner<{ v: string }[]>`
            select version::text as v from sineobex.team_index_versions where team_id = ${teamId}`
        )[0]?.v ?? '0',
      );

    it('moves at a new change and at its mark, for its own team only', async () => {
      const others = await version(otherTeam);
      const start = await version(team);
      const id = await made();
      const afterCreate = await version(team);
      expect(afterCreate).toBeGreaterThan(start);
      expect(await update(id, theMark(1))).toBeNull();
      expect(await version(team)).toBeGreaterThan(afterCreate);
      expect(await version(otherTeam)).toBe(others);
    });

    it('stays where it is for a create sent again, or a statement that changes nothing', async () => {
      const row = change();
      await inTeam((tx) => tx`insert into sineobex.patient_flag_changes ${values(tx, row)}`);
      const now = await version(team);
      // A retry of the same change: the API's insert takes nothing a second time.
      const again = await inTeam(
        (tx) => tx`
          insert into sineobex.patient_flag_changes ${values(tx, row)} on conflict (id) do nothing returning id`,
      );
      expect(again).toEqual([]);
      await inTeam((tx) => tx`update sineobex.patient_flag_changes set version = version + 1 where false`);
      expect(await version(team)).toBe(now);
    });
  });

  describe('a notice names its patient (user_notices.patient_id)', () => {
    const PATIENT_KEY = 'user_notices_team_id_patient_id_fkey';
    /** A held flag change's notice, as the API writes it: on the change, naming its patient. */
    const notice = (tx: Sql | TransactionSql, about: string | null, teamId = team) =>
      tx<{ id: string; patientId: string | null }[]>`
        insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id, patient_id)
        values (${teamId}, ${worker}, 'flag_change_not_applied', 'patient_flag_change', ${randomUUID()}, ${about})
        returning id, patient_id as "patientId"`;

    it('names a patient of its own team, written and read by the app role', async () => {
      const [row] = await inTeam((tx) => notice(tx, patient));
      expect(row!.patientId).toBe(patient);
      const read = await inTeam(
        (tx) => tx`select patient_id as "patientId" from sineobex.user_notices where id = ${row!.id}`,
      );
      expect(read).toEqual([{ patientId: patient }]);
    });

    it('names no patient unless told: every other notice leaves it out', async () => {
      const [row] = await inTeam(
        (tx) => tx<{ patientId: string | null }[]>`
          insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
          values (${team}, ${worker}, 'change_not_applied', 'patient', ${patient})
          returning patient_id as "patientId"`,
      );
      expect(row).toEqual({ patientId: null });
      expect((await inTeam((tx) => notice(tx, null)))[0]!.patientId).toBeNull();
    });

    it('never names a patient of another team, or one the chart does not hold', async () => {
      const refusedKey = { code: FOREIGN_KEY, constraint: PATIENT_KEY };
      // As the request: a foreign key check ignores row-level security, so the key holds the team.
      expect(await refusal(inTeam((tx) => notice(tx, otherPatient)))).toEqual(refusedKey);
      // A patient whose create is still held: the API names one only once it is on the chart.
      expect(await refusal(inTeam((tx) => notice(tx, randomUUID())))).toEqual(refusedKey);
      // As the owner, which no policy stops.
      expect(await refusal(notice(db.owner, otherPatient))).toEqual(refusedKey);
      // The other team's own notice, about its own patient, is fine.
      expect((await as(otherTeam, (tx) => notice(tx, otherPatient, otherTeam)))[0]!.patientId).toBe(
        otherPatient,
      );
    });

    it('is hidden from another team with the rest of the notice', async () => {
      const [row] = await inTeam((tx) => notice(tx, patient));
      expect(
        await as(otherTeam, (tx) => tx`select patient_id from sineobex.user_notices where id = ${row!.id}`),
      ).toEqual([]);
    });
  });

  describe('the patient of a held change (patient_of_change)', () => {
    const MARK = { reason: 'Demo: set on the wrong person' };
    // As the app role, the way the review queue asks.
    const of = (record: string, value: unknown, teamId = team) =>
      as(
        teamId,
        async (tx) =>
          (
            await tx<{ p: string | null }[]>`
              select sineobex.patient_of_change('patient_flag_change', ${record}, ${tx.json(value as never)}) as p`
          )[0]!.p,
      );
    const by = () => ({ team, device, user: worker });

    it('a held mark on a change on the chart is about that change’s patient, whatever the value says', async () => {
      const id = await made();
      await hold(db.owner, by(), 'patient_flag_change', id, MARK, { op: 'set' });
      // Marking it entered in error sends a reason and no patient.
      expect(await of(id, MARK)).toBe(patient);
      expect(await of(id, { patientId: elsewhere })).toBe(patient);
      // The queue asks of each item what it holds.
      const listed = await inTeam(
        (tx) => tx<{ p: string | null }[]>`
          select sineobex.patient_of_change(q.entity, q.record_id, q.value) as p from sineobex.quarantine_items q
          where q.record_id = ${id}`,
      );
      expect(listed).toEqual([{ p: patient }]);
    });

    it('a held create is about the patient it names', async () => {
      const value = { patientId: patient, flagId: flag, action: 'set', reason: 'Demo: slept outside' };
      expect(await of(randomUUID(), value)).toBe(patient);
      expect(await of(randomUUID(), MARK)).toBeNull();
      expect(await of(randomUUID(), { patientId: 'not-an-id' })).toBeNull();
      expect(await of(randomUUID(), 'set')).toBeNull();
    });

    it('a held mark on a held create is about the patient the latest create names', async () => {
      const id = randomUUID();
      const create = (patientId: string) => ({
        patientId,
        flagId: flag,
        action: 'set',
        reason: 'Demo: cold night',
      });
      await hold(db.owner, by(), 'patient_flag_change', id, create(elsewhere), {
        at: new Date(Date.now() - 60_000),
      });
      // Created again while held, naming another patient: the later create answers.
      await hold(db.owner, by(), 'patient_flag_change', id, create(patient), {
        at: new Date(Date.now() - 30_000),
      });
      await hold(db.owner, by(), 'patient_flag_change', id, MARK, { op: 'set' });
      expect(await of(id, MARK)).toBe(patient);
      // A later held change of the record that is not its create never answers for it.
      await hold(db.owner, by(), 'patient_flag_change', id, { patientId: elsewhere }, { op: 'set' });
      expect(await of(id, MARK)).toBe(patient);
      // The value's own patient still answers first, as it did.
      expect(await of(id, { patientId: elsewhere })).toBe(elsewhere);
      // Another team's request learns nothing of it.
      expect(await of(id, MARK, otherTeam)).toBeNull();
    });

    it('another team’s change on the chart names no patient to this team', async () => {
      const theirs = await made(
        { team_id: otherTeam, patient_id: otherPatient, flag_id: otherFlag, created_device_id: null },
        otherTeam,
      );
      expect(await of(theirs, MARK)).toBeNull();
      expect(await of(theirs, MARK, otherTeam)).toBe(otherPatient);
    });
  });

  it('says a patient’s priority flag column is unused', async () => {
    const [row] = await db.owner<{ comment: string | null }[]>`
      select col_description('sineobex.patients'::regclass, a.attnum) as comment from pg_attribute a
      where a.attrelid = 'sineobex.patients'::regclass and a.attname = 'priority_flag_key'`;
    expect(row!.comment).toBe(
      "Unused. A patient's flags are worked out from their flag changes (patient_flag_changes; 0024).",
    );
  });
});

describe('0024 on a database that already answers for held changes', () => {
  let db: ScratchDatabase;
  let dir: string;
  let patient: string;
  let other: string;
  let heldFlagChange: string;
  let noticeId: string;
  type Probe = [entity: string, record: string, value: unknown];
  let probes: Probe[];
  let before: (string | null)[];
  let heldMarkBefore: string | null;
  let noticeBefore: Row;
  let commentBefore: string | null;

  const answers = async (asked: Probe[]) => {
    const out: (string | null)[] = [];
    for (const [entity, record, value] of asked) {
      const [row] = await db.owner<{ p: string | null }[]>`
        select sineobex.patient_of_change(${entity}, ${record}, ${db.owner.json(value as never)}) as p`;
      out.push(row!.p);
    }
    return out;
  };
  const heldMark = async () =>
    (await answers([['patient_flag_change', heldFlagChange, { reason: 'Demo: wrong person' }]]))[0]!;
  const noticeRow = async () =>
    (
      await db.owner<
        { row: Row }[]
      >`select to_jsonb(n) as row from sineobex.user_notices n where id = ${noticeId}`
    )[0]!.row;
  const comment = async () =>
    (
      await db.owner<{ comment: string | null }[]>`
        select col_description('sineobex.patients'::regclass, a.attnum) as comment from pg_attribute a
        where a.attrelid = 'sineobex.patients'::regclass and a.attname = 'priority_flag_key'`
    )[0]!.comment;

  beforeAll(async () => {
    // Every migration before 0024, with a row or a held create behind every branch of the function.
    dir = await mkdtemp(join(tmpdir(), 'sineobex-0023-'));
    for (const f of await readdir(MIGRATIONS_DIR)) {
      if (f.endsWith('.sql') && f < '0024') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    db = await createScratchDatabase({ migrate: false });
    await migrate(db.owner, { dir });
    const o = db.owner;
    const team = await makeTeam(o, 'Held Flags Team');
    const author = await makeUser(o, 'held-flags@example.com');
    const by = { team, device: await insertDevice(o, team, author), user: author };
    patient = await insertPatient(o, team, author);
    other = await insertPatient(o, team, author);

    const alias = randomUUID();
    await o`insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id)
            values (${alias}, ${team}, ${patient}, 'Demo alias', ${author})`;
    const allergy = randomUUID();
    await o`insert into sineobex.patient_allergies (id, team_id, patient_id, substance, recorded_at, author_user_id)
            values (${allergy}, ${team}, ${patient}, 'Demo: latex', now(), ${author})`;
    const heldAllergy = randomUUID();
    await hold(o, by, 'patient_allergy', heldAllergy, { patientId: other, substance: 'Demo: dust' });
    const consent = randomUUID();
    await o`insert into sineobex.patient_consents (id, team_id, patient_id, kind, decision, method, script_version,
              language, recorded_by, recorded_at, clock_verified)
            values (${consent}, ${team}, ${patient}, 'care_and_record', 'given', 'verbal', 'demo-1', 'en', ${author},
              now(), true)`;
    const problem = randomUUID();
    await o`insert into sineobex.problems (id, team_id, patient_id, title, sensitive, status, status_changed_at,
              status_changed_by, status_checked_at, author_user_id)
            values (${problem}, ${team}, ${patient}, 'Demo: cough', false, 'new', now(), ${author}, now(), ${author})`;
    const problemNote = randomUUID();
    await o`insert into sineobex.problem_notes (id, team_id, problem_id, text, written_at, author_user_id)
            values (${problemNote}, ${team}, ${problem}, 'Demo: better today', now(), ${author})`;
    const heldProblem = randomUUID();
    await hold(o, by, 'problem', heldProblem, { patientId: other, title: 'Demo: rash', status: 'new' });
    const link = randomUUID();
    await o`insert into sineobex.patient_id_links (id, team_id, patient_id, token, token_hash, status, reason,
              effective_at, clock_verified, made_offline, issued_by)
            values (${link}, ${team}, ${patient}, ${'A'.repeat(22)}, ${'0'.repeat(64)}, 'active', 'first_card', now(),
              true, false, ${author})`;
    const visit = randomUUID();
    await o`insert into sineobex.encounters (id, team_id, patient_id, kind, author_user_id, started_at)
            values (${visit}, ${team}, ${patient}, 'medical', ${author}, now())`;
    const note = randomUUID();
    await o`insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, data)
            values (${note}, ${team}, ${visit}, 'demo_note', ${author}, '{"plan": "Demo: rest"}')`;
    const heldVisit = randomUUID();
    await hold(o, by, 'encounter', heldVisit, { patientId: other, kind: 'medical' });
    const heldNote = randomUUID();
    await hold(o, by, 'encounter_note', heldNote, { encounterId: heldVisit });
    const referral = randomUUID();
    await o`insert into sineobex.referrals (id, team_id, patient_id, referred_on, details, recorded_at, author_user_id)
            values (${referral}, ${team}, ${patient}, '2026-03-04', 'Demo: foot clinic', now(), ${author})`;
    const heldReferral = randomUUID();
    await hold(o, by, 'referral', heldReferral, {
      patientId: other,
      referredOn: '2026-03-04',
      details: 'Demo',
    });
    // A flag change's create held before the table exists: a mark held on it names no patient yet.
    heldFlagChange = randomUUID();
    await hold(o, by, 'patient_flag_change', heldFlagChange, {
      patientId: other,
      flagId: randomUUID(),
      action: 'set',
      reason: 'Demo: cold night',
    });
    const [n] = await o<{ id: string }[]>`
      insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id, read_at)
      values (${team}, ${author}, 'late_change_kept', 'patient', ${patient}, now()) returning id`;
    noticeId = n!.id;

    // A record that names another patient in its value: where both are known, the row decides.
    const elsewhere = { patientId: other };
    const retracted = { reason: 'Demo: entered twice' };
    probes = [
      ['patient', patient, elsewhere],
      ['patient_alias', alias, elsewhere],
      ['patient_alias', randomUUID(), elsewhere],
      ['patient_allergy', allergy, elsewhere],
      ['patient_allergy', heldAllergy, retracted],
      ['patient_allergy', randomUUID(), retracted],
      ['patient_consent', consent, 'x'],
      ['problem', problem, elsewhere],
      ['problem', heldProblem, elsewhere],
      ['id_link', link, elsewhere],
      ['problem_note', problemNote, { problemId: heldProblem }],
      ['problem_note', randomUUID(), { problemId: problem }],
      ['problem_note', randomUUID(), { problemId: heldProblem }],
      ['problem_note', randomUUID(), { text: 'Demo: no problem named', patientId: patient }],
      ['encounter', visit, elsewhere],
      ['encounter', heldVisit, null],
      ['encounter', randomUUID(), elsewhere],
      ['encounter_note', note, elsewhere],
      ['encounter_note', heldNote, 'x'],
      ['encounter_note', randomUUID(), 'x'],
      ['note_signoff', randomUUID(), { noteId: note }],
      ['note_signoff', randomUUID(), { noteId: heldNote }],
      ['note_correction', randomUUID(), { noteId: note }],
      ['note_addendum', randomUUID(), { encounterId: visit, noteId: null }],
      ['note_addendum', randomUUID(), { encounterId: heldVisit, noteId: note }],
      ['referral', referral, retracted],
      ['referral', heldReferral, retracted],
      ['referral', randomUUID(), { patientId: patient, referredOn: '2026-03-04', details: 'Demo' }],
      ['patient_flag_change', randomUUID(), { patientId: patient, flagId: randomUUID(), action: 'set' }],
      ['patient_flag_change', randomUUID(), retracted],
      ['audit', randomUUID(), { action: 'patient.viewed', patientId: patient }],
      ['audit', randomUUID(), { patientId: 'not-an-id' }],
      ['audit', randomUUID(), [patient]],
    ];
    before = await answers(probes);
    heldMarkBefore = await heldMark();
    noticeBefore = await noticeRow();
    commentBefore = await comment();
    // 0024 alone: what a later migration changes is that one's to test.
    await copyFile(
      join(MIGRATIONS_DIR, '0024_patient_flag_changes.sql'),
      join(dir, '0024_patient_flag_changes.sql'),
    );
    const applied = await migrate(db.owner, { dir });
    expect(applied.applied).toEqual(['0024']);
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('gives every answer it gave before', async () => {
    expect(before).toEqual([
      ...[patient, patient, other, patient, other, null, patient, patient, other, patient],
      ...[patient, patient, other, null],
      ...[patient, other, other, patient, other, null],
      ...[patient, other, patient, patient, other],
      ...[patient, other, patient],
      ...[patient, null],
      ...[patient, null, null],
    ]);
    expect(await answers(probes)).toEqual(before);
  });

  it('names the patient of a mark held on a held flag change, which it could not before', async () => {
    expect(heldMarkBefore).toBeNull();
    expect(await heldMark()).toBe(other);
  });

  it('keeps every notice as it was, naming no patient', async () => {
    expect(noticeBefore).not.toHaveProperty('patient_id');
    expect(await noticeRow()).toEqual({ ...noticeBefore, patient_id: null });
  });

  it('says the priority flag column is unused, which only a line of 0009 said before', async () => {
    expect(commentBefore).toBeNull();
    expect(await comment()).toMatch(/^Unused\. /);
  });
});
