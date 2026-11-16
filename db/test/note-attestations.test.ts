import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS_DIR } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser, refusal } from './helpers.ts';

// 0020: attestations and assignments (phase 4 design, lifecycle 2.4), two append-only tables
// written online, and patient_of_change for the entities phase 4 adds. Made-up people only.

const CHECK = '23514';
const FOREIGN_KEY = '23503';
const NOT_NULL = '23502';
const DENIED = '42501';
const HASH = 'cd'.repeat(32);
const TABLES = ['note_attestations', 'note_assignments'] as const;
type Table = (typeof TABLES)[number];
type Row = Record<string, unknown>;

/** A patient with nothing but what the table insists on. */
async function insertPatient(owner: Sql, team: string, author: string): Promise<string> {
  const id = randomUUID();
  await owner`
    insert into sineobex.patients (id, team_id, canonical_id, preferred_name, registered_at, author_user_id)
    values (${id}, ${team}, ${id}, 'Demo person', now(), ${author})`;
  return id;
}

async function insertEncounter(owner: Sql, team: string, author: string, patient: string | null = null) {
  const id = randomUUID();
  await owner`insert into sineobex.encounters (id, team_id, patient_id, kind, author_user_id, started_at)
              values (${id}, ${team}, ${patient}, 'medical', ${author}, now())`;
  return id;
}

async function insertNote(owner: Sql, team: string, author: string, encounter: string) {
  const id = randomUUID();
  await owner`
    insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, data)
    values (${id}, ${team}, ${encounter}, 'demo_note', ${author}, '{"plan": "Demo: dressing changed"}')`;
  return id;
}

async function insertDevice(owner: Sql, team: string, user: string) {
  const id = randomUUID();
  await owner`insert into sineobex.devices (id, team_id, user_id, platform, app_version, public_key)
              values (${id}, ${team}, ${user}, 'other', 'test', ${'A'.repeat(43)})`;
  return id;
}

/** A create held for review: the record is not on the chart, and the queue must still name its patient. */
async function holdCreate(
  owner: Sql,
  by: { team: string; device: string; user: string },
  entity: string,
  record: string,
  value: Row,
) {
  await owner`
    insert into sineobex.quarantine_items (team_id, device_id, user_id, change_id, entity, record_id, op,
      value, value_hash, device_time, reason)
    values (${by.team}, ${by.device}, ${by.user}, ${randomUUID()}, ${entity}, ${record}, 'create',
      ${owner.json(value as never)}, ${'0'.repeat(64)}, now(), 'permission')`;
}

describe('0020 note attestations and assignments', () => {
  let db: ScratchDatabase;
  let team: string;
  let otherTeam: string;
  let attending: string;
  let admin: string;
  let departed: string;
  let noteId: string;
  let signoffId: string;
  let otherNote: string;
  let otherSignoff: string;

  const as = <T>(teamId: string, run: (tx: TransactionSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: attending }, run);
  const inTeam = <T>(run: (tx: TransactionSql) => Promise<T>) => as(team, run);

  const signoff = async (ofNote: string, teamId = team) => {
    const id = randomUUID();
    await db.owner`
      insert into sineobex.note_signoffs (id, team_id, note_id, act, effect, content_hash, signer_user_id,
        signer_name, signer_credential, needs_attestation, statement_version, signed_at, clock_verified)
      values (${id}, ${teamId}, ${ofNote}, 'sign', 'signed', ${HASH}, ${departed}, 'Demo Resident', 'resident',
        true, 'demo-1', now(), true)`;
    return id;
  };

  // One whole row of each table, as the API writes it: the server makes the ID and the time.
  const rows: Record<Table, (over?: Row) => Row> = {
    note_attestations: (over = {}) => ({
      team_id: team,
      note_id: noteId,
      signoff_id: signoffId,
      content_hash: HASH,
      attending_user_id: attending,
      attending_name: 'Demo Attending',
      attending_npi: '0000000000',
      statement_version: 'demo-1',
      ...over,
    }),
    note_assignments: (over = {}) => ({
      team_id: team,
      note_id: noteId,
      from_user_id: departed,
      to_user_id: attending,
      assigned_by: admin,
      reason: 'Demo: the author left the team',
      ...over,
    }),
  };
  const values = (tx: Sql | TransactionSql, row: Row) => {
    const out: Row = { ...row };
    if ('attending_fields' in out && out.attending_fields !== null) {
      out.attending_fields = tx.json(out.attending_fields as never);
    }
    return tx(out);
  };
  const insert = (table: Table, over: Row = {}, teamId = team) =>
    as(teamId, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into sineobex.${tx(table)} ${values(tx, rows[table](over))} returning id`;
      return row!.id;
    });
  /** The refusal of one row that differs from a whole one by `over`. */
  const refused = (table: Table, over: Row, teamId = team) => refusal(insert(table, over, teamId));
  const refusedAsOwner = (table: Table, over: Row) =>
    refusal(db.owner`insert into sineobex.${db.owner(table)} ${values(db.owner, rows[table](over))}`);

  beforeAll(async () => {
    db = await createScratchDatabase();
    team = await makeTeam(db.owner, 'Attestation Team');
    otherTeam = await makeTeam(db.owner, 'Attestation Other Team');
    attending = await makeUser(db.owner, 'attest-attending@example.com');
    admin = await makeUser(db.owner, 'attest-admin@example.com');
    departed = await makeUser(db.owner, 'attest-departed@example.com');
    noteId = await insertNote(db.owner, team, departed, await insertEncounter(db.owner, team, departed));
    signoffId = await signoff(noteId);
    otherNote = await insertNote(
      db.owner,
      otherTeam,
      departed,
      await insertEncounter(db.owner, otherTeam, departed),
    );
    otherSignoff = await signoff(otherNote, otherTeam);
  });
  afterAll(() => db.drop());

  describe('both tables', () => {
    it('take a row from the app role, and the server makes its ID', async () => {
      for (const table of TABLES) {
        const first = await insert(table);
        const second = await insert(table);
        expect(first, table).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(second, table).not.toBe(first);
        const found = await inTeam((tx) => tx`select id from sineobex.${tx(table)} where id = ${first}`);
        expect(found, table).toEqual([{ id: first }]);
      }
    });

    it('never change or lose a row once written', async () => {
      const column = { note_attestations: 'attending_name', note_assignments: 'reason' } as const;
      for (const table of TABLES) {
        const id = await insert(table);
        // The owner may try, and the trigger refuses.
        expect(
          await refusal(
            db.owner`update sineobex.${db.owner(table)} set ${db.owner(column[table])} = 'Demo: rewritten'
                     where id = ${id}`,
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
        await insert(table);
        const seen = (teamId: string) =>
          as(
            teamId,
            (tx) => tx<{ teamId: string }[]>`select distinct team_id as "teamId" from sineobex.${tx(table)}`,
          );
        expect(await seen(team), table).toEqual([{ teamId: team }]);
        expect(await seen(otherTeam), table).toEqual([]);
        // Acting in the other team, nobody writes into this one. Without "returning": reading the
        // row back would be refused by the rule for reads, whatever the rule for writes says.
        expect(
          await refusal(
            as(otherTeam, (tx) => tx`insert into sineobex.${tx(table)} ${values(tx, rows[table]())}`),
          ),
          table,
        ).toEqual({ code: DENIED });
      }
    });

    it('point only at a note of their own team', async () => {
      for (const table of TABLES) {
        const constraint = `${table}_team_id_note_id_fkey`;
        expect(await refused(table, { note_id: randomUUID() }), table).toEqual({
          code: FOREIGN_KEY,
          constraint,
        });
        expect(await refused(table, { note_id: otherNote }), table).toEqual({
          code: FOREIGN_KEY,
          constraint,
        });
        // The other team's own row, on its own note, is fine.
        const theirs = { team_id: otherTeam, note_id: otherNote };
        await insert(
          table,
          table === 'note_attestations' ? { ...theirs, signoff_id: otherSignoff } : theirs,
          otherTeam,
        );
      }
    });

    it('name real people and a real team', async () => {
      const nobody = randomUUID();
      const cases: [Table, string][] = [
        ['note_attestations', 'attending_user_id'],
        ['note_attestations', 'team_id'],
        ['note_assignments', 'from_user_id'],
        ['note_assignments', 'to_user_id'],
        ['note_assignments', 'assigned_by'],
        ['note_assignments', 'team_id'],
      ];
      for (const [table, column] of cases) {
        // As the owner, so a made-up team is answered by the key and not by the team policy.
        expect(await refusedAsOwner(table, { [column]: nobody }), `${table}.${column}`).toEqual({
          code: FOREIGN_KEY,
          constraint: `${table}_${column}_fkey`,
        });
      }
    });

    it('refuse a row with a part missing', async () => {
      const filledIn: Record<Table, string[]> = {
        note_attestations: ['id', 'attending_fields', 'attested_at'],
        note_assignments: ['id', 'assigned_at'],
      };
      for (const table of TABLES) {
        const given = Object.keys(rows[table]());
        for (const column of [...given, ...filledIn[table]]) {
          expect(await refusedAsOwner(table, { [column]: null }), `${table}.${column}`).toEqual({
            code: NOT_NULL,
          });
        }
        // Nothing is made up for a part the API leaves out.
        for (const column of given) {
          const rest = Object.fromEntries(Object.entries(rows[table]()).filter(([c]) => c !== column));
          expect(
            await refusal(db.owner`insert into sineobex.${db.owner(table)} ${values(db.owner, rest)}`),
            `${table} without ${column}`,
          ).toEqual({ code: NOT_NULL });
        }
      }
    });

    it('record the server’s own time', async () => {
      const at = { note_attestations: 'attested_at', note_assignments: 'assigned_at' } as const;
      for (const table of TABLES) {
        const id = await insert(table);
        const [row] = await db.owner<{ age: number }[]>`
          select extract(epoch from now() - ${db.owner(at[table])})::float8 as age
          from sineobex.${db.owner(table)} where id = ${id}`;
        expect(row!.age, table).toBeGreaterThanOrEqual(0);
        expect(row!.age, table).toBeLessThan(60);
      }
    });

    it('have their indexes', async () => {
      const indexes = await db.owner<{ name: string; columns: string[] }[]>`
        select c.relname as name,
               array(select a.attname::text from unnest(i.indkey::int2[]) with ordinality k (attnum, n)
                     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum order by k.n) as columns
        from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid
        where t.relname in ('note_attestations', 'note_assignments') and not i.indisprimary
        order by c.relname`;
      // An assignment is rare and read with its note: it has no index of its own.
      expect(indexes).toEqual([
        { name: 'note_attestations_note', columns: ['team_id', 'note_id', 'attested_at'] },
      ]);
    });
  });

  describe('an attestation', () => {
    it('names the signature attested, one of its team', async () => {
      const constraint = 'note_attestations_team_id_signoff_id_fkey';
      expect(await refused('note_attestations', { signoff_id: randomUUID() })).toEqual({
        code: FOREIGN_KEY,
        constraint,
      });
      expect(await refused('note_attestations', { signoff_id: otherSignoff })).toEqual({
        code: FOREIGN_KEY,
        constraint,
      });
    });

    it('is written again when a corrected note is attested again', async () => {
      const again = await signoff(noteId);
      const first = await insert('note_attestations');
      const second = await insert('note_attestations', { signoff_id: again, content_hash: 'ef'.repeat(32) });
      const found = await db.owner<{ id: string; signoffId: string }[]>`
        select id, signoff_id as "signoffId" from sineobex.note_attestations where id in ${db.owner([first, second])}
        order by attested_at`;
      expect(found).toEqual([
        { id: first, signoffId },
        { id: second, signoffId: again },
      ]);
    });

    it('carries a hash of 64 lower-case hex characters', async () => {
      for (const hash of ['cd'.repeat(31), 'cd'.repeat(33), 'CD'.repeat(32), `${'cd'.repeat(31)}zz`, '']) {
        expect(await refused('note_attestations', { content_hash: hash }), hash).toEqual({
          code: CHECK,
          constraint: 'note_attestations_content_hash_check',
        });
      }
    });

    it('keeps the attending’s NPI, and the license fields as an object', async () => {
      for (const fields of [[], 'MD-0000', 3]) {
        expect(
          await refused('note_attestations', { attending_fields: fields }),
          JSON.stringify(fields),
        ).toEqual({ code: CHECK, constraint: 'note_attestations_attending_fields_check' });
      }
      const plain = await insert('note_attestations');
      const licensed = await insert('note_attestations', {
        attending_fields: { licenseNumber: 'MD-0000', licenseState: 'ZZ' },
      });
      const found = await db.owner`
        select id, attending_name, attending_npi, attending_fields, statement_version, content_hash
        from sineobex.note_attestations where id in ${db.owner([plain, licensed])} order by id = ${licensed}`;
      const same = {
        attending_name: 'Demo Attending',
        attending_npi: '0000000000',
        statement_version: 'demo-1',
        content_hash: HASH,
      };
      expect(found).toEqual([
        { id: plain, ...same, attending_fields: {} },
        { id: licensed, ...same, attending_fields: { licenseNumber: 'MD-0000', licenseState: 'ZZ' } },
      ]);
    });
  });

  describe('an assignment', () => {
    it('says who was replaced, by whom and with whom', async () => {
      const id = await insert('note_assignments');
      const [row] = await db.owner`
        select note_id, from_user_id, to_user_id, assigned_by, reason from sineobex.note_assignments
        where id = ${id}`;
      expect(row).toEqual({
        note_id: noteId,
        from_user_id: departed,
        to_user_id: attending,
        assigned_by: admin,
        reason: 'Demo: the author left the team',
      });
    });

    it('gives a reason of 3 to 500 characters', async () => {
      const refusedReason = { code: CHECK, constraint: 'note_assignments_reason_check' };
      for (const reason of ['', 'no', '  no  ', 'é'.repeat(501)]) {
        expect(await refused('note_assignments', { reason }), `${reason.length} characters`).toEqual(
          refusedReason,
        );
      }
      expect(await refused('note_assignments', { reason: 'é'.repeat(500) })).toBeNull();
      expect(await refused('note_assignments', { reason: 'typ' })).toBeNull();
    });
  });

  describe('the patient of a held change (patient_of_change)', () => {
    let onChart: string;
    let heldOnly: string;
    let visit: string;
    let heldVisit: string;
    let note: string;
    let heldNote: string;
    let heldNoteOfHeldVisit: string;

    // As the app role, the way the review queue asks.
    const of = (entity: string, value: unknown, record: string = randomUUID()) =>
      inTeam(
        async (tx) =>
          (
            await tx<{ p: string | null }[]>`
              select sineobex.patient_of_change(${entity}, ${record}, ${tx.json(value as never)}) as p`
          )[0]!.p,
      );

    beforeAll(async () => {
      const by = { team, device: await insertDevice(db.owner, team, departed), user: departed };
      onChart = await insertPatient(db.owner, team, departed);
      heldOnly = await insertPatient(db.owner, team, departed);
      visit = await insertEncounter(db.owner, team, departed, onChart);
      note = await insertNote(db.owner, team, departed, visit);
      heldVisit = randomUUID();
      await holdCreate(db.owner, by, 'encounter', heldVisit, { patientId: heldOnly, kind: 'medical' });
      heldNote = randomUUID();
      await holdCreate(db.owner, by, 'encounter_note', heldNote, { encounterId: visit });
      heldNoteOfHeldVisit = randomUUID();
      await holdCreate(db.owner, by, 'encounter_note', heldNoteOfHeldVisit, { encounterId: heldVisit });
    });

    for (const entity of ['note_signoff', 'note_correction']) {
      it(`a ${entity} is about its note’s patient, wherever the note and its visit are`, async () => {
        expect(await of(entity, { noteId: note })).toBe(onChart);
        expect(await of(entity, { noteId: heldNote })).toBe(onChart);
        expect(await of(entity, { noteId: heldNoteOfHeldVisit })).toBe(heldOnly);
        // The record's own ID is no note: only the value says which note.
        expect(await of(entity, { reason: 'Demo: nothing named' }, note)).toBeNull();
        expect(await of(entity, { noteId: randomUUID() })).toBeNull();
        expect(await of(entity, { noteId: 'not-an-id' })).toBeNull();
        expect(await of(entity, 'draft')).toBeNull();
      });
    }

    it('an addendum is about its visit’s patient, on the chart or held', async () => {
      expect(await of('note_addendum', { encounterId: visit, noteId: null })).toBe(onChart);
      expect(await of('note_addendum', { encounterId: heldVisit, noteId: heldNoteOfHeldVisit })).toBe(
        heldOnly,
      );
      // Through the visit it names, never through the note: the note may be one of another visit.
      expect(await of('note_addendum', { encounterId: heldVisit, noteId: note })).toBe(heldOnly);
      expect(await of('note_addendum', { noteId: note }, visit)).toBeNull();
      expect(await of('note_addendum', { encounterId: randomUUID() })).toBeNull();
      expect(await of('note_addendum', { encounterId: 7 })).toBeNull();
    });

    it('a note and a visit resolve as they did', async () => {
      expect(await of('encounter', 'draft', visit)).toBe(onChart);
      expect(await of('encounter', null, heldVisit)).toBe(heldOnly);
      expect(await of('encounter_note', 'x', note)).toBe(onChart);
      expect(await of('encounter_note', 'x', heldNote)).toBe(onChart);
      expect(await of('encounter_note', 'x', heldNoteOfHeldVisit)).toBe(heldOnly);
      // A note is found by its own ID, never by a noteId in its value.
      expect(await of('encounter_note', { noteId: note })).toBeNull();
    });
  });
});

describe('0020 on a database that already answers for held changes', () => {
  let db: ScratchDatabase;
  let dir: string;
  let patient: string;
  let other: string;
  let note: string;
  type Probe = [entity: string, record: string, value: unknown];
  let probes: Probe[];
  let signoffProbe: Probe;
  let before: (string | null)[];
  let signoffBefore: (string | null)[];

  const answers = async (asked: Probe[]) => {
    const out: (string | null)[] = [];
    for (const [entity, record, value] of asked) {
      const [row] = await db.owner<{ p: string | null }[]>`
        select sineobex.patient_of_change(${entity}, ${record}, ${db.owner.json(value as never)}) as p`;
      out.push(row!.p);
    }
    return out;
  };

  beforeAll(async () => {
    // Every migration before 0020, with a row or a held create behind every branch of the function.
    dir = await mkdtemp(join(tmpdir(), 'sineobex-0019-'));
    for (const f of await readdir(MIGRATIONS_DIR)) {
      if (f.endsWith('.sql') && f < '0020') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    db = await createScratchDatabase({ migrate: false });
    await migrate(db.owner, { dir });
    const o = db.owner;
    const team = await makeTeam(o, 'Held Changes Team');
    const author = await makeUser(o, 'held-changes@example.com');
    const by = { team, device: await insertDevice(o, team, author), user: author };
    patient = await insertPatient(o, team, author);
    other = await insertPatient(o, team, author);

    const alias = randomUUID();
    await o`insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id)
            values (${alias}, ${team}, ${patient}, 'Demo alias', ${author})`;
    const allergy = randomUUID();
    await o`insert into sineobex.patient_allergies (id, team_id, patient_id, substance, recorded_at, author_user_id)
            values (${allergy}, ${team}, ${patient}, 'Demo: latex', now(), ${author})`;
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
    await holdCreate(o, by, 'problem', heldProblem, { patientId: other, title: 'Demo: rash', status: 'new' });
    const link = randomUUID();
    await o`insert into sineobex.patient_id_links (id, team_id, patient_id, token, token_hash, status, reason,
              effective_at, clock_verified, made_offline, issued_by)
            values (${link}, ${team}, ${patient}, ${'A'.repeat(22)}, ${'0'.repeat(64)}, 'active', 'first_card', now(),
              true, false, ${author})`;
    const visit = await insertEncounter(o, team, author, patient);
    note = await insertNote(o, team, author, visit);
    const heldVisit = randomUUID();
    await holdCreate(o, by, 'encounter', heldVisit, { patientId: other, kind: 'medical' });
    const heldNote = randomUUID();
    await holdCreate(o, by, 'encounter_note', heldNote, { encounterId: heldVisit });

    // A record that names another patient in its value: where both are known, the row decides.
    const elsewhere = { patientId: other };
    probes = [
      ['patient', patient, elsewhere],
      ['patient_alias', alias, elsewhere],
      ['patient_alias', randomUUID(), elsewhere],
      ['patient_allergy', allergy, elsewhere],
      ['patient_allergy', randomUUID(), { reason: 'Demo: entered twice' }],
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
      ['audit', randomUUID(), { action: 'patient.viewed', patientId: patient }],
      ['audit', randomUUID(), { patientId: 'MRN-0042' }],
      ['audit', randomUUID(), [patient]],
    ];
    signoffProbe = ['note_signoff', randomUUID(), { noteId: note }];
    before = await answers(probes);
    signoffBefore = await answers([signoffProbe]);
    await migrate(db.owner);
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('gives every answer it gave before', async () => {
    expect(before).toEqual([
      ...[patient, patient, other, patient, null, patient, patient, other, patient],
      ...[patient, patient, other, null],
      ...[patient, other, other, patient, other, null],
      ...[patient, null, null],
    ]);
    expect(await answers(probes)).toEqual(before);
  });

  it('names the patient of a sign-off, which it could not before', async () => {
    expect(signoffBefore).toEqual([null]);
    expect(await answers([signoffProbe])).toEqual([patient]);
  });
});
