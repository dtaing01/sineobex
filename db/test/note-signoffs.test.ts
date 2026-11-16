import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS_DIR } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser } from './helpers.ts';

// 0019: sign-offs, addenda and corrections (phase 4 design, lifecycle 2.3). Three append-only
// tables, and the tie between a signed note and the sign-off that signs it. Made-up people only.

/** What a refused statement names: its SQLSTATE and its constraint. Never its message. */
async function refusal(run: PromiseLike<unknown>): Promise<{ code?: string; constraint?: string } | null> {
  try {
    await run;
  } catch (err) {
    const e = err as { code?: string; constraint_name?: string };
    return { code: e.code, constraint: e.constraint_name };
  }
  return null;
}

const CHECK = '23514';
const FOREIGN_KEY = '23503';
const NOT_NULL = '23502';
const DENIED = '42501';
const CREDENTIALS = ['attending', 'resident', 'np', 'pa', 'student', 'chw', 'none'];
const HASH = 'ab'.repeat(32);
const TABLES = ['note_signoffs', 'note_addenda', 'note_corrections'] as const;
type Table = (typeof TABLES)[number];
type Row = Record<string, unknown>;

describe('0019 note sign-offs, addenda and corrections', () => {
  let db: ScratchDatabase;
  let team: string;
  let otherTeam: string;
  let signer: string;
  let device: string;
  let encounterId: string;
  let noteId: string;
  let otherEncounter: string;
  let otherNote: string;

  const as = <T>(teamId: string, run: (tx: TransactionSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: signer }, run);
  const inTeam = <T>(run: (tx: TransactionSql) => Promise<T>) => as(team, run);

  const encounter = async (teamId = team) => {
    const id = randomUUID();
    await db.owner`insert into sineobex.encounters (id, team_id, kind, author_user_id, started_at)
                   values (${id}, ${teamId}, 'medical', ${signer}, now())`;
    return id;
  };
  const note = async (inEncounter: string, teamId = team) => {
    const id = randomUUID();
    await db.owner`
      insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, medical, data)
      values (${id}, ${teamId}, ${inEncounter}, 'demo_note', ${signer}, true, '{"plan": "Demo: dressing changed"}')`;
    return id;
  };

  // One whole row of each table, as the API writes it.
  const rows: Record<Table, (over?: Row) => Row> = {
    note_signoffs: (over = {}) => ({
      id: randomUUID(),
      team_id: team,
      note_id: noteId,
      act: 'sign',
      effect: 'signed',
      content_hash: HASH,
      signer_user_id: signer,
      signer_name: 'Demo Signer',
      signer_credential: 'attending',
      needs_attestation: false,
      statement_version: 'demo-1',
      signed_at: new Date(),
      clock_verified: true,
      ...over,
    }),
    note_addenda: (over = {}) => ({
      id: randomUUID(),
      team_id: team,
      encounter_id: encounterId,
      note_id: noteId,
      text: 'Demo: culture result came back',
      written_at: new Date(),
      clock_verified: true,
      author_user_id: signer,
      author_name: 'Demo Signer',
      author_credential: 'np',
      ...over,
    }),
    note_corrections: (over = {}) => ({
      id: randomUUID(),
      team_id: team,
      note_id: noteId,
      changes: [{ field: 'data.plan', oldValue: 'Demo: a', newValue: 'Demo: b', historyId: null }],
      outcome: 'corrected',
      reason: 'Demo: wrong side written',
      corrector_user_id: signer,
      corrector_name: 'Demo Signer',
      corrector_credential: 'attending',
      corrected_at: new Date(),
      clock_verified: true,
      ...over,
    }),
  };
  const JSON_COLUMNS = ['changes', 'signer_fields'];
  const values = (tx: Sql | TransactionSql, row: Row) => {
    const out: Row = { ...row };
    for (const c of JSON_COLUMNS) if (c in out && out[c] !== null) out[c] = tx.json(out[c] as never);
    return tx(out);
  };
  const insert = (table: Table, over: Row = {}, teamId = team) => {
    const row = rows[table](over);
    return {
      id: row.id as string,
      done: as(teamId, (tx) => tx`insert into sineobex.${tx(table)} ${values(tx, row)}`),
    };
  };
  /** The refusal of one row that differs from a whole one by `over`. */
  const refused = (table: Table, over: Row, teamId = team) => refusal(insert(table, over, teamId).done);

  beforeAll(async () => {
    db = await createScratchDatabase();
    team = await makeTeam(db.owner, 'Sign-off Team');
    otherTeam = await makeTeam(db.owner, 'Sign-off Other Team');
    signer = await makeUser(db.owner, 'signoff-signer@example.com');
    device = randomUUID();
    await db.owner`insert into sineobex.devices (id, team_id, user_id, platform, app_version, public_key)
                   values (${device}, ${team}, ${signer}, 'other', 'test', ${'A'.repeat(43)})`;
    encounterId = await encounter();
    noteId = await note(encounterId);
    otherEncounter = await encounter(otherTeam);
    otherNote = await note(otherEncounter, otherTeam);
  });
  afterAll(() => db.drop());

  describe('all three tables', () => {
    it('take a whole row from the app role and give it back', async () => {
      for (const table of TABLES) {
        const { id, done } = insert(table, { created_device_id: device, change_id: randomUUID() });
        await done;
        const found = await inTeam((tx) => tx`select id from sineobex.${tx(table)} where id = ${id}`);
        expect(found, table).toEqual([{ id }]);
      }
    });

    it('never change or lose a row once written', async () => {
      for (const table of TABLES) {
        const { id, done } = insert(table);
        await done;
        // The owner may try, and the trigger refuses.
        expect(
          await refusal(
            db.owner`update sineobex.${db.owner(table)} set clock_verified = false where id = ${id}`,
          ),
          table,
        ).toEqual({ code: DENIED });
        expect(
          await refusal(db.owner`delete from sineobex.${db.owner(table)} where id = ${id}`),
          table,
        ).toEqual({ code: DENIED });
        // The app role has no right to try.
        const [rights] = await db.owner<{ read: boolean; add: boolean; change: boolean; remove: boolean }[]>`
          select has_table_privilege('sineobex_app', ${`sineobex.${table}`}, 'select') as read,
                 has_table_privilege('sineobex_app', ${`sineobex.${table}`}, 'insert') as add,
                 has_table_privilege('sineobex_app', ${`sineobex.${table}`}, 'update') as change,
                 has_table_privilege('sineobex_app', ${`sineobex.${table}`}, 'delete') as remove`;
        expect(rights, table).toEqual({ read: true, add: true, change: false, remove: false });
      }
    });

    it('hide a team’s rows from another team, and take none written across teams', async () => {
      for (const table of TABLES) {
        await insert(table).done;
        const seen = (teamId: string) =>
          as(
            teamId,
            (tx) => tx<{ teamId: string }[]>`select distinct team_id as "teamId" from sineobex.${tx(table)}`,
          );
        expect(await seen(team), table).toEqual([{ teamId: team }]);
        expect(await seen(otherTeam), table).toEqual([]);
        // Acting in the other team, nobody writes into this one.
        expect(await refused(table, {}, otherTeam), table).toEqual({ code: DENIED });
      }
    });

    it('point only at a note, or a visit, of their own team', async () => {
      const cases: [Table, Row, string][] = [
        ['note_signoffs', { note_id: randomUUID() }, 'note_signoffs_team_id_note_id_fkey'],
        ['note_signoffs', { note_id: otherNote }, 'note_signoffs_team_id_note_id_fkey'],
        ['note_corrections', { note_id: randomUUID() }, 'note_corrections_team_id_note_id_fkey'],
        ['note_corrections', { note_id: otherNote }, 'note_corrections_team_id_note_id_fkey'],
        ['note_addenda', { note_id: randomUUID() }, 'note_addenda_team_id_note_id_fkey'],
        ['note_addenda', { note_id: otherNote }, 'note_addenda_team_id_note_id_fkey'],
        ['note_addenda', { encounter_id: randomUUID() }, 'note_addenda_team_id_encounter_id_fkey'],
        ['note_addenda', { encounter_id: otherEncounter }, 'note_addenda_team_id_encounter_id_fkey'],
      ];
      for (const [table, over, constraint] of cases) {
        expect(await refused(table, over), constraint).toEqual({ code: FOREIGN_KEY, constraint });
      }
      // The other team's own rows, on its own note, are fine.
      for (const table of TABLES) {
        const over = { team_id: otherTeam, note_id: otherNote, encounter_id: otherEncounter };
        const row = rows[table](table === 'note_addenda' ? over : { team_id: otherTeam, note_id: otherNote });
        await as(otherTeam, (tx) => tx`insert into sineobex.${tx(table)} ${values(tx, row)}`);
      }
    });

    it('name real people and a real phone', async () => {
      const nobody = randomUUID();
      const cases: [Table, string][] = [
        ['note_signoffs', 'signer_user_id'],
        ['note_signoffs', 'approved_by'],
        ['note_signoffs', 'created_device_id'],
        ['note_addenda', 'author_user_id'],
        ['note_addenda', 'created_device_id'],
        ['note_corrections', 'corrector_user_id'],
        ['note_corrections', 'created_device_id'],
        ['note_signoffs', 'team_id'],
        ['note_addenda', 'team_id'],
        ['note_corrections', 'team_id'],
      ];
      for (const [table, column] of cases) {
        // As the owner, so a made-up team is answered by the key and not by the team policy.
        const row = rows[table]({ [column]: nobody });
        expect(
          await refusal(db.owner`insert into sineobex.${db.owner(table)} ${values(db.owner, row)}`),
          `${table}.${column}`,
        ).toEqual({ code: FOREIGN_KEY, constraint: `${table}_${column}_fkey` });
      }
    });

    it('refuse a row with a part missing', async () => {
      const required: Record<Table, string[]> = {
        note_signoffs: [
          ...['id', 'team_id', 'note_id', 'act', 'effect', 'content_hash', 'signer_user_id', 'signer_name'],
          ...['signer_credential', 'needs_attestation', 'statement_version', 'signed_at', 'clock_verified'],
        ],
        note_addenda: [
          ...['id', 'team_id', 'encounter_id', 'text', 'written_at', 'clock_verified', 'author_user_id'],
          ...['author_name', 'author_credential'],
        ],
        note_corrections: [
          ...['id', 'team_id', 'note_id', 'changes', 'outcome', 'reason', 'corrector_user_id'],
          ...['corrector_name', 'corrector_credential', 'corrected_at', 'clock_verified'],
        ],
      };
      for (const table of TABLES) {
        for (const column of required[table]) {
          const row = rows[table]({ [column]: null });
          expect(
            await refusal(db.owner`insert into sineobex.${db.owner(table)} ${values(db.owner, row)}`),
            `${table}.${column}`,
          ).toEqual({ code: NOT_NULL });
        }
      }
    });

    it('fill in the time of receipt, and what a row may leave out', async () => {
      const filled = async (table: Table, columns: string[]) => {
        const { id, done } = insert(table);
        await done;
        const [row] = await db.owner`
          select ${db.owner(columns)}, extract(epoch from now() - ${db.owner(table === 'note_signoffs' ? 'received_at' : 'created_at')})::float8 as age
          from sineobex.${db.owner(table)} where id = ${id}`;
        expect(row!.age, table).toBeGreaterThanOrEqual(0);
        expect(row!.age, table).toBeLessThan(60);
        return Object.fromEntries(Object.entries(row!).filter(([column]) => column !== 'age'));
      };
      expect(
        await filled('note_signoffs', [
          ...['signer_npi', 'signer_fields', 'claimed_credential', 'signed_device_time', 'change_id'],
          ...['created_device_id', 'approved_by'],
        ]),
      ).toEqual({
        signer_npi: null,
        signer_fields: {},
        claimed_credential: null,
        signed_device_time: null,
        change_id: null,
        created_device_id: null,
        approved_by: null,
      });
      expect(await filled('note_addenda', ['created_device_id', 'change_id'])).toEqual({
        created_device_id: null,
        change_id: null,
      });
      expect(
        await filled('note_corrections', [
          ...['requested_by_patient', 'claimed_credential', 'created_device_id', 'change_id'],
        ]),
      ).toEqual({
        requested_by_patient: false,
        claimed_credential: null,
        created_device_id: null,
        change_id: null,
      });
    });

    it('record a credential as one of the seven', async () => {
      const columns: [Table, string, boolean][] = [
        ['note_signoffs', 'signer_credential', false],
        ['note_signoffs', 'claimed_credential', true],
        ['note_addenda', 'author_credential', false],
        ['note_corrections', 'corrector_credential', false],
        ['note_corrections', 'claimed_credential', true],
      ];
      for (const [table, column, optional] of columns) {
        const label = `${table}.${column}`;
        const constraint = `${table}_${column}_check`;
        for (const credential of ['rn', 'Attending', '']) {
          expect(await refused(table, { [column]: credential }), label).toEqual({ code: CHECK, constraint });
        }
        for (const credential of CREDENTIALS) {
          expect(await refused(table, { [column]: credential }), `${label} ${credential}`).toBeNull();
        }
        if (optional) expect(await refused(table, { [column]: null }), label).toBeNull();
      }
    });

    it('have their indexes', async () => {
      const indexes = await db.owner<{ name: string; columns: string[] }[]>`
        select c.relname as name,
               array(select a.attname::text from unnest(i.indkey::int2[]) with ordinality k (attnum, n)
                     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum order by k.n) as columns
        from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid
        where t.relname in ('note_signoffs', 'note_addenda', 'note_corrections') and not i.indisprimary
        order by c.relname`;
      expect(indexes).toEqual([
        { name: 'note_addenda_encounter', columns: ['team_id', 'encounter_id', 'written_at'] },
        { name: 'note_corrections_note', columns: ['team_id', 'note_id', 'corrected_at'] },
        { name: 'note_signoffs_note', columns: ['team_id', 'note_id', 'received_at'] },
        // What other tables point at a sign-off by.
        { name: 'note_signoffs_team_id_key', columns: ['team_id', 'id'] },
      ]);
    });
  });

  describe('a sign-off', () => {
    it('says what was asked and what was done, in the words the rules use', async () => {
      for (const act of ['complete', 'sign', 'cosign']) {
        for (const effect of ['signed', 'completed', 'saved_unsigned', 'none']) {
          expect(await refused('note_signoffs', { act, effect }), `${act} ${effect}`).toBeNull();
        }
      }
      for (const act of ['attest', 'Sign', '']) {
        expect(await refused('note_signoffs', { act }), act).toEqual({
          code: CHECK,
          constraint: 'note_signoffs_act_check',
        });
      }
      for (const effect of ['draft', 'refused', '']) {
        expect(await refused('note_signoffs', { effect }), effect).toEqual({
          code: CHECK,
          constraint: 'note_signoffs_effect_check',
        });
      }
    });

    it('carries a hash of 64 lower-case hex characters', async () => {
      for (const hash of ['ab'.repeat(31), 'ab'.repeat(33), 'AB'.repeat(32), `${'ab'.repeat(31)}zz`, '']) {
        expect(await refused('note_signoffs', { content_hash: hash }), hash).toEqual({
          code: CHECK,
          constraint: 'note_signoffs_content_hash_check',
        });
      }
    });

    it('keeps the signer’s other credential fields as an object', async () => {
      for (const fields of [[], 'MD-0000', 3]) {
        expect(await refused('note_signoffs', { signer_fields: fields }), JSON.stringify(fields)).toEqual({
          code: CHECK,
          constraint: 'note_signoffs_signer_fields_check',
        });
      }
      const { id, done } = insert('note_signoffs', {
        signer_npi: '0000000000',
        signer_fields: { licenseState: 'ZZ', program: 'Demo: residency' },
        claimed_credential: 'resident',
        signed_device_time: new Date(),
        approved_by: signer,
      });
      await done;
      const [row] = await db.owner`
        select signer_npi, signer_fields, claimed_credential from sineobex.note_signoffs where id = ${id}`;
      expect(row).toEqual({
        signer_npi: '0000000000',
        signer_fields: { licenseState: 'ZZ', program: 'Demo: residency' },
        claimed_credential: 'resident',
      });
    });
  });

  describe('a signed note and its sign-off', () => {
    const AT = new Date();
    const set = (id: string, change: Row) =>
      refusal(inTeam((tx) => tx`update sineobex.encounter_notes set ${tx(change)} where id = ${id}`));
    const signedColumns = (signoffId: string | null) => ({
      status: 'signed',
      completed_at: AT,
      completed_by: signer,
      first_signed_at: AT,
      signoff_id: signoffId,
    });
    const TIED = { code: CHECK, constraint: 'encounter_notes_signoff_when_signed' };
    const POINTS = { code: FOREIGN_KEY, constraint: 'encounter_notes_signoff_fk' };

    it('the sign-off and the note are written in one transaction, and the visit follows', async () => {
      const visit = await encounter();
      const id = await note(visit);
      const signoff = rows.note_signoffs({ note_id: id });
      await inTeam(async (tx) => {
        await tx`insert into sineobex.note_signoffs ${values(tx, signoff)}`;
        await tx`update sineobex.encounter_notes set ${tx(signedColumns(signoff.id as string))} where id = ${id}`;
      });
      const [row] = await db.owner<{ status: string; signoff: string }[]>`
        select e.status, n.signoff_id as signoff from sineobex.encounters e
        join sineobex.encounter_notes n on n.encounter_id = e.id where e.id = ${visit}`;
      expect(row).toEqual({ status: 'signed', signoff: signoff.id });
    });

    it('a note is signed exactly while it names a sign-off', async () => {
      const visit = await encounter();
      const id = await note(visit);
      const { id: signoffId, done } = insert('note_signoffs', { note_id: id });
      await done;
      expect(await set(id, signedColumns(null))).toEqual(TIED);
      expect(await set(id, { signoff_id: signoffId })).toEqual(TIED);
      expect(
        await set(id, { status: 'completed', completed_at: AT, completed_by: signer, signoff_id: signoffId }),
      ).toEqual(TIED);
      expect(await set(id, signedColumns(signoffId))).toBeNull();
      // A student's correction sends it back to wait for a co-signer: the sign-off goes with the status.
      expect(await set(id, { status: 'completed' })).toEqual(TIED);
      expect(await set(id, { status: 'completed', signoff_id: null })).toBeNull();
    });

    it('the sign-off it names is one of its team', async () => {
      const visit = await encounter();
      const id = await note(visit);
      expect(await set(id, signedColumns(randomUUID()))).toEqual(POINTS);
      const foreign = rows.note_signoffs({ team_id: otherTeam, note_id: otherNote });
      await as(otherTeam, (tx) => tx`insert into sineobex.note_signoffs ${values(tx, foreign)}`);
      expect(await set(id, signedColumns(foreign.id as string))).toEqual(POINTS);
    });
  });

  describe('an addendum', () => {
    it('is attached to a note, or to the visit itself', async () => {
      const onVisit = insert('note_addenda', { note_id: null });
      await onVisit.done;
      const [row] = await db.owner`
        select encounter_id, note_id, text, author_name, author_credential, clock_verified
        from sineobex.note_addenda where id = ${onVisit.id}`;
      expect(row).toEqual({
        encounter_id: encounterId,
        note_id: null,
        text: 'Demo: culture result came back',
        author_name: 'Demo Signer',
        author_credential: 'np',
        clock_verified: true,
      });
    });

    it('holds 1 to 4,000 characters of text', async () => {
      const refusedText = { code: CHECK, constraint: 'note_addenda_text_check' };
      for (const text of ['', '   ', 'é'.repeat(4001)]) {
        expect(await refused('note_addenda', { text }), `${text.length} characters`).toEqual(refusedText);
      }
      expect(await refused('note_addenda', { text: 'é'.repeat(4000) })).toBeNull();
      expect(await refused('note_addenda', { text: 'D' })).toBeNull();
    });
  });

  describe('a correction', () => {
    const change = (field: unknown = 'data.plan') => ({
      field,
      oldValue: 'a',
      newValue: 'b',
      historyId: null,
    });
    const SHAPE = { code: CHECK, constraint: 'note_corrections_changes_shape' };

    it('changes one to ten answers together', async () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => change(`data.wound.${i}`));
      expect(await refused('note_corrections', { changes: [] })).toEqual(SHAPE);
      expect(await refused('note_corrections', { changes: many(11) })).toEqual(SHAPE);
      expect(await refused('note_corrections', { changes: many(1) })).toBeNull();
      expect(await refused('note_corrections', { changes: many(10) })).toBeNull();
      // Anything but a list is refused as a broken rule, never as an error of another kind.
      for (const changes of [{}, change(), 'data.plan', 3, true]) {
        expect(await refused('note_corrections', { changes }), JSON.stringify(changes)).toEqual(SHAPE);
      }
      // A JSON null is not a SQL null: the column's own rule lets it by, and the check stops it.
      const [json] = await db.owner<{ ok: boolean }[]>`
        select sineobex.note_correction_changes_ok('null'::jsonb) as ok`;
      expect(json).toEqual({ ok: false });
    });

    it('names an answer of the note in each change, never anything else of the visit', async () => {
      const bad = [
        [change('summary')],
        [change('status')],
        [change('data.')],
        [change('data')],
        [change('Data.plan')],
        [change(7)],
        [change(null)],
        [change(['data.plan'])],
        [{ oldValue: 'a', newValue: 'b' }],
        ['data.plan'],
        [[change()]],
        [null],
        [change(), change('summary')],
      ];
      for (const changes of bad) {
        expect(await refused('note_corrections', { changes }), JSON.stringify(changes)).toEqual(SHAPE);
      }
      // What was there before, what is there now and the history row are the API's to fill.
      expect(
        await refused('note_corrections', {
          changes: [
            { field: 'data.ems.activated', oldValue: false, newValue: true, historyId: '41' },
            { field: 'data.ems.time', oldValue: null, newValue: '14:05', historyId: '42' },
          ],
        }),
      ).toBeNull();
    });

    it('ends in one of five outcomes', async () => {
      for (const outcome of ['corrected', 'no_change', 'draft_edit', 'not_author']) {
        expect(await refused('note_corrections', { outcome }), outcome).toBeNull();
      }
      for (const outcome of ['refused', 'Corrected', '']) {
        expect(await refused('note_corrections', { outcome }), outcome).toEqual({
          code: CHECK,
          constraint: 'note_corrections_outcome_check',
        });
      }
    });

    it('is declined only when the patient asked for it', async () => {
      expect(await refused('note_corrections', { outcome: 'declined' })).toEqual({
        code: CHECK,
        constraint: 'note_corrections_declined_is_request',
      });
      expect(await refused('note_corrections', { outcome: 'declined', requested_by_patient: false })).toEqual(
        { code: CHECK, constraint: 'note_corrections_declined_is_request' },
      );
      expect(
        await refused('note_corrections', { outcome: 'declined', requested_by_patient: true }),
      ).toBeNull();
      // A request that is accepted is a correction like any other.
      expect(
        await refused('note_corrections', { outcome: 'corrected', requested_by_patient: true }),
      ).toBeNull();
    });

    it('gives a reason of 3 to 500 characters', async () => {
      const refusedReason = { code: CHECK, constraint: 'note_corrections_reason_check' };
      for (const reason of ['', 'no', '  no  ', 'é'.repeat(501)]) {
        expect(await refused('note_corrections', { reason }), `${reason.length} characters`).toEqual(
          refusedReason,
        );
      }
      expect(await refused('note_corrections', { reason: 'é'.repeat(500) })).toBeNull();
      expect(await refused('note_corrections', { reason: 'typ' })).toBeNull();
    });
  });
});

describe('0019 on a database that already holds notes', () => {
  let db: ScratchDatabase;
  let dir: string;
  let signedByHand: string;

  beforeAll(async () => {
    // Every migration before 0018: phase 2 had no sign-offs, and a preview row could be marked signed.
    dir = await mkdtemp(join(tmpdir(), 'sineobex-0017-'));
    for (const f of await readdir(MIGRATIONS_DIR)) {
      if (f.endsWith('.sql') && f < '0018') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    db = await createScratchDatabase({ migrate: false });
    await migrate(db.owner, { dir });
    const team = await makeTeam(db.owner, 'Phase Two Sign-off Team');
    const author = await makeUser(db.owner, 'phase-two-signer@example.com');
    const encounterId = randomUUID();
    signedByHand = randomUUID();
    await db.owner`insert into sineobex.encounters (id, team_id, kind, author_user_id, started_at)
                   values (${encounterId}, ${team}, 'medical', ${author}, now())`;
    await db.owner`
      insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, status, author_user_id)
      values (${signedByHand}, ${team}, ${encounterId}, 'demo_note', 'signed', ${author})`;
    await migrate(db.owner);
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('leaves a row signed by hand as it is, and holds it to the rule at its next change', async () => {
    const [row] = await db.owner<{ status: string; signoff: string | null }[]>`
      select status, signoff_id as signoff from sineobex.encounter_notes where id = ${signedByHand}`;
    expect(row).toEqual({ status: 'signed', signoff: null });
    const [check] = await db.owner<{ validated: boolean }[]>`
      select convalidated as validated from pg_constraint
      where conrelid = 'sineobex.encounter_notes'::regclass and conname = 'encounter_notes_signoff_when_signed'`;
    expect(check).toEqual({ validated: false });
    // Made whole in every other way, it still names no sign-off.
    expect(
      await refusal(
        db.owner`update sineobex.encounter_notes
                 set medical = true, completed_at = now(), completed_by = author_user_id, first_signed_at = now()
                 where id = ${signedByHand}`,
      ),
    ).toEqual({ code: CHECK, constraint: 'encounter_notes_signoff_when_signed' });
  });
});
