import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS_DIR } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser, refusal } from './helpers.ts';

// 0022: a notice names the note it is about (phase 4 design, D104; lifecycle 4.6, 4.10). A held
// sign-off that will not reach the chart tells its sender by a notice on the sign-off, which waits
// in the review queue and is never in the sync read, so the notice also names its note. Made-up
// people only.

const FOREIGN_KEY = '23503';
const NOTE_KEY = 'user_notices_team_id_note_id_fkey';

async function insertNote(owner: Sql, team: string, author: string): Promise<string> {
  const encounter = randomUUID();
  await owner`insert into sineobex.encounters (id, team_id, kind, author_user_id, started_at)
              values (${encounter}, ${team}, 'medical', ${author}, now())`;
  const id = randomUUID();
  await owner`
    insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, data)
    values (${id}, ${team}, ${encounter}, 'demo_note', ${author}, '{"plan": "Demo: rest and fluids"}')`;
  return id;
}

describe('0022 the note a notice names', () => {
  let db: ScratchDatabase;
  let team: string;
  let otherTeam: string;
  let worker: string;
  let noteId: string;
  let otherNote: string;

  const as = <T>(teamId: string, run: (tx: TransactionSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: worker }, run);
  const inTeam = <T>(run: (tx: TransactionSql) => Promise<T>) => as(team, run);

  /** A held sign-off's notice, as the API writes it: on the sign-off, naming its note. */
  const notice = (tx: Sql | TransactionSql, note: string | null, teamId = team) =>
    tx<{ id: string; noteId: string | null }[]>`
      insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id, note_id)
      values (${teamId}, ${worker}, 'signoff_not_applied', 'note_signoff', ${randomUUID()}, ${note})
      returning id, note_id as "noteId"`;

  beforeAll(async () => {
    db = await createScratchDatabase();
    team = await makeTeam(db.owner, 'Notice Team');
    otherTeam = await makeTeam(db.owner, 'Notice Other Team');
    worker = await makeUser(db.owner, 'notice-worker@example.com');
    noteId = await insertNote(db.owner, team, worker);
    otherNote = await insertNote(db.owner, otherTeam, worker);
  });
  afterAll(() => db.drop());

  it('names a note of its own team, written and read by the app role', async () => {
    const [row] = await inTeam((tx) => notice(tx, noteId));
    expect(row!.noteId).toBe(noteId);
    const read = await inTeam(
      (tx) => tx`select note_id as "noteId" from sineobex.user_notices where id = ${row!.id}`,
    );
    expect(read).toEqual([{ noteId }]);
  });

  it('names no note unless told: every other notice leaves it out', async () => {
    const [row] = await inTeam(
      (tx) => tx<{ noteId: string | null }[]>`
        insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
        values (${team}, ${worker}, 'change_not_applied', 'encounter_note', ${noteId})
        returning note_id as "noteId"`,
    );
    expect(row).toEqual({ noteId: null });
    expect((await inTeam((tx) => notice(tx, null)))[0]!.noteId).toBeNull();
  });

  it('never names a note of another team, or one the chart does not hold', async () => {
    const refused = { code: FOREIGN_KEY, constraint: NOTE_KEY };
    // As the request: a foreign key check ignores row-level security, so the key holds the team.
    expect(await refusal(inTeam((tx) => notice(tx, otherNote)))).toEqual(refused);
    expect(await refusal(inTeam((tx) => notice(tx, randomUUID())))).toEqual(refused);
    // As the owner, which no policy stops.
    expect(await refusal(notice(db.owner, otherNote))).toEqual(refused);
    // The other team's own notice, on its own note, is fine.
    expect((await as(otherTeam, (tx) => notice(tx, otherNote, otherTeam)))[0]!.noteId).toBe(otherNote);
  });

  it('is hidden from another team with the rest of the notice', async () => {
    const [row] = await inTeam((tx) => notice(tx, noteId));
    expect(
      await as(otherTeam, (tx) => tx`select note_id from sineobex.user_notices where id = ${row!.id}`),
    ).toEqual([]);
  });
});

describe('0022 on a database that holds notices already', () => {
  let db: ScratchDatabase;
  let dir: string;
  let id: string;
  let before: Record<string, unknown>;

  const rowOf = async () =>
    (
      await db.owner<{ row: Record<string, unknown> }[]>`
      select to_jsonb(n) as row from sineobex.user_notices n where id = ${id}`
    )[0]!.row;

  beforeAll(async () => {
    // Every migration before 0022, and a notice written under them.
    dir = await mkdtemp(join(tmpdir(), 'sineobex-0021-'));
    for (const f of await readdir(MIGRATIONS_DIR)) {
      if (f.endsWith('.sql') && f < '0022') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    db = await createScratchDatabase({ migrate: false });
    await migrate(db.owner, { dir });
    const team = await makeTeam(db.owner, 'Notice Upgrade Team');
    const worker = await makeUser(db.owner, 'notice-upgrade@example.com');
    const note = await insertNote(db.owner, team, worker);
    const [row] = await db.owner<{ id: string }[]>`
      insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id, read_at)
      values (${team}, ${worker}, 'late_change_kept', 'encounter_note', ${note}, now()) returning id`;
    id = row!.id;
    before = await rowOf();
    await migrate(db.owner);
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps every notice as it was, naming no note', async () => {
    expect(before).not.toHaveProperty('note_id');
    expect(await rowOf()).toEqual({ ...before, note_id: null });
  });
});
