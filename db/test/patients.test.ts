import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate, setEnvironment } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser } from './helpers.ts';

// Phase 3 (patients): migrations 0009-0012 (phase 3 design 1, 13.4). Made-up people only.

interface PatientRow {
  id?: string;
  preferred?: string | null;
  given?: string | null;
  family?: string | null;
  descriptor?: string | null;
  birthYear?: number | null;
  birthDate?: string | null;
}

async function insertPatient(sql: Sql | TransactionSql, team: string, author: string, p: PatientRow = {}) {
  const id = p.id ?? randomUUID();
  const precision = p.birthDate ? 'day' : p.birthYear ? 'year' : null;
  const year = p.birthDate ? Number(p.birthDate.slice(0, 4)) : (p.birthYear ?? null);
  await sql`
    insert into sineobex.patients (id, team_id, canonical_id, preferred_name, legal_given_name, legal_family_name,
      visual_descriptor, birth_precision, birth_date, birth_year, registered_at, author_user_id)
    values (${id}, ${team}, ${id}, ${p.preferred === undefined ? 'Demo person' : p.preferred}, ${p.given ?? null},
      ${p.family ?? null}, ${p.descriptor ?? null}, ${precision}, ${p.birthDate ?? null}, ${year}, now(), ${author})`;
  return id;
}

async function keys(sql: Sql, patient: string) {
  return sql<{ source: string; norm: string; dmCodes: string[] }[]>`
    select source, norm, dm_codes as "dmCodes" from sineobex.patient_name_keys
    where patient_id = ${patient} order by source, norm`;
}

describe('0009-0012 on a database holding phase 2 rows', () => {
  let db: ScratchDatabase;
  let dir: string;

  beforeAll(async () => {
    db = await createScratchDatabase({ migrate: false });
    dir = await mkdtemp(join(tmpdir(), 'mig-phase2-'));
    for (const f of await readdir(MIGRATIONS_DIR)) {
      if (f < '0009') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('applies over encounters that name patients that never existed and keeps them', async () => {
    await migrate(db.owner, { dir });
    await setEnvironment(db.owner, 'test');
    const team = await makeTeam(db.owner, 'Phase 2 Team');
    const user = await makeUser(db.owner, 'phase2@example.com');
    const encounter = randomUUID();
    const ghost = randomUUID();
    await db.owner`insert into sineobex.encounters (id, team_id, patient_id, kind, author_user_id, started_at)
                   values (${encounter}, ${team}, ${ghost}, 'medical', ${user}, now())`;
    await db.owner`insert into sineobex.field_history (team_id, entity, record_id, field, version, value, kind, changed_by)
                   values (${team}, 'encounter', ${encounter}, 'status', 1, '"draft"', 'created', ${user})`;

    const result = await migrate(db.owner);
    expect(result.applied).toEqual(['0009', '0010', '0011', '0012']);
    const [row] = await db.owner<{ patientId: string }[]>`
      select patient_id as "patientId" from sineobex.encounters where id = ${encounter}`;
    expect(row!.patientId).toBe(ghost);
    // No foreign key on encounters.patient_id yet: that is 0013, with the API's own check.
    await db.owner`update sineobex.encounters set patient_id = ${randomUUID()} where id = ${encounter}`;
    const history = await db.owner`select 1 from sineobex.field_history where record_id = ${encounter}`;
    expect(history).toHaveLength(1);
  });
});

describe('patients schema', () => {
  let db: ScratchDatabase;
  let teamA: string;
  let teamB: string;
  let author: string;

  beforeAll(async () => {
    db = await createScratchDatabase();
    teamA = await makeTeam(db.owner, 'Team A');
    teamB = await makeTeam(db.owner, 'Team B');
    author = await makeUser(db.owner, 'author@example.com');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('adds no permission and changes no role (D37)', async () => {
    const [known] = await db.owner<{ k: string[] }[]>`select sineobex.known_permissions() as k`;
    expect(known!.k).toEqual([
      'team.manage_users',
      'team.manage_presets',
      'team.view_audit',
      'patients.view',
      'patients.edit',
      'patients.correct_identity',
      'patients.review_duplicates',
      'patients.view_sensitive',
      'patients.view_sensitive_exams',
      'patients.reverse_resolved',
      'encounters.chart',
      'checkins.create',
      'referrals.create',
      'routes.view',
      'routes.manage',
      'inventory.view',
      'inventory.manage',
      'billing.view_codes',
      'exports.billing',
      'exports.grant',
      'exports.data',
      'quarantine.review',
      'devices.manage',
    ]);
    const roles = await db.owner<{ key: string; permissions: string[] }[]>`
      select key, permissions from sineobex.roles where is_standard order by key`;
    expect(Object.fromEntries(roles.map((r) => [r.key, r.permissions]))).toEqual({
      billing_data: [
        'patients.view',
        'billing.view_codes',
        'inventory.view',
        'exports.billing',
        'exports.grant',
      ],
      healthcare_staff: [
        'patients.view',
        'patients.edit',
        'patients.view_sensitive',
        'encounters.chart',
        'checkins.create',
        'referrals.create',
        'routes.view',
        'inventory.view',
      ],
      logistics: [
        'patients.view',
        'patients.edit',
        'patients.view_sensitive',
        'encounters.chart',
        'checkins.create',
        'referrals.create',
        'routes.view',
        'routes.manage',
        'inventory.view',
        'inventory.manage',
      ],
      program_admin: known!.k,
    });
  });

  it('keeps search keys in step with names, street names and descriptions', async () => {
    const p = await insertPatient(db.owner, teamA, author, {
      preferred: 'Del',
      given: 'Delbert',
      family: 'Smithfield',
      descriptor: 'Demo: tall, grey beard',
    });
    expect(await keys(db.owner, p)).toEqual([
      { source: 'descriptor', norm: 'demo tall grey beard', dmCodes: [] },
      { source: 'legal', norm: 'delbert smithfield', dmCodes: ['SM0F', 'TLPR', 'XMTF'] },
      { source: 'preferred', norm: 'del', dmCodes: ['TL'] },
    ]);

    await db.owner`update sineobex.patients set preferred_name = 'Delly', legal_family_name = null where id = ${p}`;
    const alias = randomUUID();
    await db.owner`insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id)
                   values (${alias}, ${teamA}, ${p}, 'Smitty', ${author})`;
    expect((await keys(db.owner, p)).map((k) => `${k.source}:${k.norm}`)).toEqual([
      'alias:smitty',
      'descriptor:demo tall grey beard',
      'legal:delbert',
      'preferred:delly',
    ]);

    await db.owner`update sineobex.patient_aliases set status = 'removed', removed_reason = 'Wrong patient',
                     removed_by = ${author}, removed_at = now() where id = ${alias}`;
    expect((await keys(db.owner, p)).map((k) => k.source)).toEqual(['descriptor', 'legal', 'preferred']);
  });

  it('computes stable sound-alike codes', async () => {
    const rows = await db.owner<{ a: string[]; b: string[]; c: string[]; d: string[] }[]>`
      select sineobex.name_codes('smitty') as a, sineobex.name_codes('delbert smithfield') as b,
             sineobex.name_codes(null) as c, sineobex.name_codes('a b') as d`;
    expect(rows[0]).toEqual({ a: ['SMT', 'XMT'], b: ['SM0F', 'TLPR', 'XMTF'], c: [], d: [] });
  });

  it('holds the merge and recognisability checks', async () => {
    const survivor = await insertPatient(db.owner, teamA, author);
    const id = randomUUID();
    // Merged without a survivor, or active with someone else's canonical ID: refused.
    await expect(db.owner`
      insert into sineobex.patients (id, team_id, status, canonical_id, preferred_name, registered_at, author_user_id)
      values (${id}, ${teamA}, 'merged', ${id}, 'Demo', now(), ${author})`).rejects.toThrow(
      /check constraint/,
    );
    await expect(db.owner`
      insert into sineobex.patients (id, team_id, canonical_id, preferred_name, registered_at, author_user_id)
      values (${id}, ${teamA}, ${survivor}, 'Demo', now(), ${author})`).rejects.toThrow(/check constraint/);
    // Nothing left to recognise someone by: refused, whatever path the write takes.
    const only = await insertPatient(db.owner, teamA, author, { preferred: 'Sunny' });
    await expect(
      db.owner`update sineobex.patients set preferred_name = null where id = ${only}`,
    ).rejects.toThrow(/patients_recognisable/);
    await expect(insertPatient(db.owner, teamA, author, { preferred: null })).rejects.toThrow(
      /patients_recognisable/,
    );
  });

  it('never lets a row point at another team’s patient', async () => {
    const theirs = await insertPatient(db.owner, teamA, author);
    await expect(db.owner`
      insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id)
      values (${randomUUID()}, ${teamB}, ${theirs}, 'Ace', ${author})`).rejects.toThrow(/foreign key/);
    await expect(db.owner`
      insert into sineobex.problems (id, team_id, patient_id, title, sensitive, status, status_changed_at,
        status_changed_by, status_checked_at, author_user_id)
      values (${randomUUID()}, ${teamB}, ${theirs}, 'Cough', false, 'new', now(), ${author}, now(), ${author})`).rejects.toThrow(
      /foreign key/,
    );
  });

  it('keeps consents, corrections, problem notes and decisions append-only', async () => {
    const p = await insertPatient(db.owner, teamA, author);
    const consent = randomUUID();
    await db.owner`insert into sineobex.patient_consents (id, team_id, patient_id, kind, decision, method,
                     script_version, language, recorded_by, recorded_at, clock_verified)
                   values (${consent}, ${teamA}, ${p}, 'care_and_record', 'given', 'verbal', '2026-10-1', 'en',
                     ${author}, now(), true)`;
    await expect(
      db.owner`update sineobex.patient_consents set decision = 'unable' where id = ${consent}`,
    ).rejects.toThrow(/append-only/);
    await expect(db.owner`delete from sineobex.patient_consents where id = ${consent}`).rejects.toThrow(
      /append-only/,
    );
    // "Unable" needs a reason; a decision must fit its kind.
    await expect(db.owner`insert into sineobex.patient_consents (id, team_id, patient_id, kind, decision, method,
                     script_version, language, recorded_by, recorded_at, clock_verified)
                   values (${randomUUID()}, ${teamA}, ${p}, 'care_and_record', 'unable', 'verbal', '2026-10-1', 'en',
                     ${author}, now(), true)`).rejects.toThrow(/check constraint/);

    await db.owner`insert into sineobex.patient_corrections (team_id, patient_id, kind, entity, record_id, reason, decided_by)
                   values (${teamA}, ${p}, 'identity', 'patient', ${p}, 'Patient showed an ID card', ${author})`;
    await expect(db.owner`update sineobex.patient_corrections set reason = 'edited'`).rejects.toThrow(
      /append-only/,
    );

    const problem = randomUUID();
    await db.owner`insert into sineobex.problems (id, team_id, patient_id, title, sensitive, status,
                     status_changed_at, status_changed_by, status_checked_at, author_user_id)
                   values (${problem}, ${teamA}, ${p}, 'Burn, left forearm', false, 'new', now(), ${author}, now(), ${author})`;
    await db.owner`insert into sineobex.problem_notes (id, team_id, problem_id, text, written_at, author_user_id)
                   values (${randomUUID()}, ${teamA}, ${problem}, 'Dressing changed', now(), ${author})`;
    await expect(db.owner`update sineobex.problem_notes set text = 'edited'`).rejects.toThrow(/append-only/);

    const other = await insertPatient(db.owner, teamA, author);
    const [a, b] = [p, other].sort();
    const [pair] = await db.owner<{ id: string }[]>`
      insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, sources)
      values (${teamA}, ${a!}, ${b!}, 0.9, '{staff_report}') returning id`;
    await db.owner`insert into sineobex.duplicate_decisions (team_id, pair_id, decision, comment, decided_by)
                   values (${teamA}, ${pair!.id}, 'not_sure', 'Check the ID card', ${author})`;
    await expect(db.owner`delete from sineobex.duplicate_decisions`).rejects.toThrow(/append-only/);
    // A pair is stored in one order only.
    await expect(db.owner`
      insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, sources)
      values (${teamA}, ${b!}, ${a!}, 0.9, '{staff_report}')`).rejects.toThrow(/check constraint/);
  });

  it('widens field history kinds without dropping the old ones', async () => {
    const p = await insertPatient(db.owner, teamA, author);
    for (const kind of ['set', 'kept_both', 'confirmed', 'redirected', 'merge_fill', 'cleared_by_allergy']) {
      await db.owner`insert into sineobex.field_history (team_id, entity, record_id, field, version, value, kind, changed_by)
                     values (${teamA}, 'patient', ${p}, 'usualArea', 1, '"Demo: Elm St"', ${kind}, ${author})`;
    }
    await expect(db.owner`insert into sineobex.field_history (team_id, entity, record_id, field, version, value, kind, changed_by)
                     values (${teamA}, 'patient', ${p}, 'usualArea', 1, '"x"', 'deleted', ${author})`).rejects.toThrow(
      /field_history_kind_check/,
    );
  });

  it('allows one active ID link per record, and a token once across every team', async () => {
    const p = await insertPatient(db.owner, teamA, author);
    const q = await insertPatient(db.owner, teamB, author);
    const link = (team: string, patient: string, token: string, hash: string) => db.owner`
      insert into sineobex.patient_id_links (id, team_id, patient_id, token, token_hash, status, reason, effective_at,
        clock_verified, made_offline, issued_by)
      values (${randomUUID()}, ${team}, ${patient}, ${token}, ${hash}, 'active', 'first_card', now(), true, false, ${author})`;
    await link(teamA, p, 'AAAAAAAAAAAAAAAAAAAAAA', 'a'.repeat(64));
    await expect(link(teamA, p, 'BBBBBBBBBBBBBBBBBBBBBB', 'b'.repeat(64))).rejects.toThrow(
      /patient_id_links_one_active/,
    );
    await expect(link(teamB, q, 'AAAAAAAAAAAAAAAAAAAAAA', 'a'.repeat(64))).rejects.toThrow(
      /patient_id_links_token_hash/,
    );
    // A taken hash is a quiet no-op for the handshake's insert, in any team.
    const taken = await db.owner`
      insert into sineobex.patient_id_links (id, team_id, patient_id, token, token_hash, status, reason, effective_at,
        clock_verified, made_offline, issued_by)
      values (${randomUUID()}, ${teamB}, ${q}, 'AAAAAAAAAAAAAAAAAAAAAA', ${'a'.repeat(64)}, 'active', 'first_card', now(),
        true, false, ${author})
      on conflict (token_hash) do nothing returning id`;
    expect(taken).toHaveLength(0);
  });

  it('moves the team index version when an index entry would change', async () => {
    const version = async () =>
      (
        await db.owner<
          { v: string }[]
        >`select version::text as v from sineobex.team_index_versions where team_id = ${teamB}`
      )[0]?.v ?? '0';
    const before = Number(await version());
    const p = await insertPatient(db.owner, teamB, author);
    const afterInsert = Number(await version());
    expect(afterInsert).toBeGreaterThan(before);
    await db.owner`update sineobex.patients set usual_area = 'Demo: library steps' where id = ${p}`;
    expect(Number(await version())).toBeGreaterThan(afterInsert);
    // A statement that changes nothing moves nothing.
    const now = Number(await version());
    await db.owner`update sineobex.patients set usual_area = 'x' where false`;
    expect(Number(await version())).toBe(now);
  });

  it('finds the patient a change is about, on the chart or held for review', async () => {
    const p = await insertPatient(db.owner, teamA, author);
    const alias = randomUUID();
    await db.owner`insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id)
                   values (${alias}, ${teamA}, ${p}, 'Ace', ${author})`;
    const encounter = randomUUID();
    await db.owner`insert into sineobex.encounters (id, team_id, patient_id, kind, author_user_id, started_at)
                   values (${encounter}, ${teamA}, ${p}, 'medical', ${author}, now())`;
    const heldProblem = randomUUID();
    const device = randomUUID();
    await db.owner`insert into sineobex.devices (id, team_id, user_id, platform, app_version, public_key)
                   values (${device}, ${teamA}, ${author}, 'android', '0.3.0', ${'A'.repeat(43)})`;
    await db.owner`insert into sineobex.quarantine_items (team_id, device_id, user_id, change_id, entity, record_id, op,
                     value, value_hash, device_time, reason)
                   values (${teamA}, ${device}, ${author}, ${randomUUID()}, 'problem', ${heldProblem}, 'create',
                     ${db.owner.json({ patientId: p, title: 'Cough', status: 'new' })}, ${'0'.repeat(64)}, now(), 'permission')`;
    const of = async (entity: string, record: string, value: unknown) =>
      (
        await db.owner<{ p: string | null }[]>`
        select sineobex.patient_of_change(${entity}, ${record}, ${db.owner.json(value as never)}) as p`
      )[0]!.p;
    expect(await of('patient', p, null)).toBe(p);
    expect(await of('patient_alias', alias, 'x')).toBe(p);
    expect(await of('patient_allergy', randomUUID(), { patientId: p })).toBe(p);
    expect(await of('problem_note', randomUUID(), { problemId: heldProblem, text: 'x' })).toBe(p);
    expect(await of('encounter', encounter, 'draft')).toBe(p);
    expect(await of('audit', randomUUID(), { action: 'patient.viewed', patientId: p })).toBe(p);
    expect(await of('audit', randomUUID(), { patientId: 'MRN-0042' })).toBeNull();
  });

  it('hides every new table from another team, and lets the app delete no patient', async () => {
    const p = await insertPatient(db.owner, teamA, author, { preferred: 'Hidden' });
    const tables = [
      'patients',
      'patient_aliases',
      'patient_name_keys',
      'patient_allergies',
      'patient_consents',
      'field_reviews',
      'patient_corrections',
      'team_index_versions',
      'problems',
      'problem_notes',
      'duplicate_pairs',
      'duplicate_decisions',
      'patient_merges',
      'patient_id_links',
    ];
    const countIn = (team: string) =>
      asApp(db.appUrl, { teamId: team, userId: author }, async (tx) => {
        const out: Record<string, number> = {};
        for (const t of tables) {
          const [r] = await tx.unsafe<{ n: number }[]>(
            `select count(*)::int as n from sineobex.${t} where team_id = '${teamA}'`,
          );
          out[t] = r!.n;
        }
        return out;
      });
    const fromB = await countIn(teamB);
    expect(Object.values(fromB).every((n) => n === 0)).toBe(true);
    const fromA = await countIn(teamA);
    for (const t of ['patients', 'patient_name_keys', 'patient_aliases', 'patient_consents', 'problems']) {
      expect(fromA[t]).toBeGreaterThan(0);
    }
    await expect(
      asApp(
        db.appUrl,
        { teamId: teamA, userId: author },
        (tx) => tx`delete from sineobex.patients where id = ${p}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp(
        db.appUrl,
        { teamId: teamA, userId: author },
        (tx) => tx`update sineobex.patient_consents set reason = 'x'`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('candidate retrieval', () => {
  let db: ScratchDatabase;
  let author: string;
  let teams: string[];
  const SOURCES = ['legal', 'preferred', 'alias', 'descriptor'];
  // The target sorts last by ID, so a cut by ID alone would lose it.
  const TARGET = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

  beforeAll(async () => {
    db = await createScratchDatabase();
    author = await makeUser(db.owner, 'bulk@example.com');
    teams = [];
    for (let i = 0; i < 10; i++) teams.push(await makeTeam(db.owner, `Bulk Team ${i}`));
    await db.owner.begin(async (tx) => {
      // 2,000 made-up names per team from syllables, birth years spread over 1930-1999.
      for (const team of teams) {
        await tx`
          with syl as (select array['ka','lo','mi','ne','su','ta','vo','ri','be','do','fa','gu','ji','ho','pe'] as s)
          insert into sineobex.patients (id, team_id, canonical_id, preferred_name, birth_precision, birth_year,
            registered_at, author_user_id)
          select g.id, ${team}, g.id,
                 initcap(s[1 + (g.n * 7) % 15] || s[1 + (g.n * 11) % 15] || s[1 + (g.n * 13) % 15]) || ' '
                   || initcap(s[1 + (g.n * 3) % 15] || s[1 + (g.n * 5) % 15] || s[1 + g.n % 15] || s[1 + (g.n / 15) % 15]),
                 'year', 1930 + g.n % 70, now(), ${author}
          from syl, (select n, gen_random_uuid() as id from generate_series(1, 2000) as n) g`;
      }
      const team = teams[0]!;
      // 300 patients sharing the target's birth year, and 160 decoys whose names start like the
      // query: word similarity alone rates "smity" as close to "smit abcde" as to "smitty".
      await tx`
        insert into sineobex.patients (id, team_id, canonical_id, preferred_name, birth_precision, birth_year,
          registered_at, author_user_id)
        select g.id, ${team}, g.id, 'Zed ' || g.n, 'year', 1946, now(), ${author}
        from (select n, gen_random_uuid() as id from generate_series(1, 300) as n) g`;
      await tx`
        insert into sineobex.patients (id, team_id, canonical_id, preferred_name, birth_precision, birth_year,
          registered_at, author_user_id)
        select g.id, ${team}, g.id, (array['Smit', 'Smith', 'Smitts'])[1 + g.n % 3] || ' ' || chr(97 + g.n % 26)
          || chr(97 + (g.n / 26) % 26) || 'xq', 'year', 1946, now(), ${author}
        from (select n, gen_random_uuid() as id from generate_series(1, 160) as n) g`;
      await tx`
        insert into sineobex.patients (id, team_id, canonical_id, preferred_name, birth_precision, birth_year,
          registered_at, author_user_id)
        values (${TARGET}, ${team}, ${TARGET}, 'Del', 'year', 1946, now(), ${author})`;
      await tx`insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id)
               values (${randomUUID()}, ${team}, ${TARGET}, 'Smitty', ${author})`;
      // A similar name in another team never appears.
      await insertPatient(tx, teams[1]!, author, { preferred: 'Smitty', birthYear: 1946 });
      // Births for the date search: exact, swapped, year only, outside the range.
      await insertPatient(tx, team, author, { preferred: 'Exact Day', birthDate: '1980-03-07' });
      await insertPatient(tx, team, author, { preferred: 'Swapped Day', birthDate: '1980-07-03' });
      await insertPatient(tx, team, author, { preferred: 'Year Only', birthYear: 1981 });
      await insertPatient(tx, team, author, { preferred: 'Far Off', birthYear: 1990 });
    });
    await db.owner`analyze sineobex.patients`;
    await db.owner`analyze sineobex.patient_name_keys`;
  }, 120_000);
  afterAll(async () => {
    await db.drop();
  });

  const candidates = (
    team: string,
    norms: string[],
    tokens: string[],
    yearLo: number | null,
    yearHi: number | null,
  ) =>
    asApp(
      db.appUrl,
      { teamId: team, userId: author },
      (tx) => tx<{ canonicalId: string; nameRank: number; yearInRange: boolean }[]>`
        select canonical_id as "canonicalId", name_rank as "nameRank", year_in_range as "yearInRange"
        from sineobex.patient_candidates(${norms}, ${tokens}, ${yearLo}, ${yearHi}, ${SOURCES},
                                         0.3, 0.5, 100, 200)`,
    );

  it('ranks before it cuts: a misspelled street name finds the target first', async () => {
    const found = await candidates(teams[0]!, ['smity'], ['smity'], 1946, 1946);
    expect(found[0]!.canonicalId).toBe(TARGET);
    expect(found.length).toBeLessThanOrEqual(200);
    const noYear = await candidates(teams[0]!, ['smity'], ['smity'], null, null);
    expect(noYear[0]!.canonicalId).toBe(TARGET);
  });

  it('never retrieves by birth year alone', async () => {
    // A query that neither spells nor sounds like any name, with the year 300 patients share.
    const found = await candidates(teams[0]!, ['aeiouy'], ['aeiouy'], 1946, 1946);
    expect(found).toEqual([]);
  });

  it('returns nothing from another team', async () => {
    const other = await candidates(teams[2]!, ['smity'], ['smity'], 1946, 1946);
    expect(other).toEqual([]);
    const own = await candidates(teams[1]!, ['smity'], ['smity'], 1946, 1946);
    expect(own).toHaveLength(1);
  });

  it('searches a full birth date exact first, then swapped, then by year, bounded', async () => {
    const byBirth = (date: string, limit = 200) =>
      asApp(
        db.appUrl,
        { teamId: teams[0]!, userId: author },
        (tx) => tx<{ canonicalId: string }[]>`
          select b.canonical_id as "canonicalId", p.preferred_name as name
          from sineobex.patient_candidates_by_birth(${date}::date, 3, ${limit}) b
          join sineobex.patients p on p.id = b.canonical_id`,
      );
    const names = (await byBirth('1980-03-07')).map((r) => (r as unknown as { name: string }).name);
    expect(names.slice(0, 2)).toEqual(['Exact Day', 'Swapped Day']);
    expect(names).not.toContain('Far Off');
    expect(names.length).toBeGreaterThan(2);
    expect(await byBirth('1980-03-07', 1)).toHaveLength(1);
    // A day above 12 can't be a month: make_date is never called with it.
    await expect(byBirth('1980-03-25')).resolves.toBeDefined();
  });

  it('bounds every branch by a team-led index, never a sequential scan', async () => {
    const plans = await asApp(db.appUrl, { teamId: teams[3]!, userId: author }, async (tx) => {
      await tx`select set_config('pg_trgm.similarity_threshold', '0.3', true),
                      set_config('pg_trgm.word_similarity_threshold', '0.5', true)`;
      const explain = async (q: string) =>
        (
          (await tx.unsafe<{ 'QUERY PLAN': unknown }[]>(`explain (format json) ${q}`))[0]![
            'QUERY PLAN'
          ] as unknown[]
        )[0];
      return [
        await explain(`
          select k.patient_id, ((similarity(k.norm, 'smity') + word_similarity('smity', k.norm)) / 2)::real as r
          from sineobex.patient_name_keys k
          where k.team_id = sineobex.current_team_id() and k.source = any ('{legal,preferred,alias,descriptor}')
            and (k.norm % 'smity' or 'smity' <% k.norm)
          order by 2 desc, k.patient_id limit 100`),
        await explain(`
          select k.patient_id from sineobex.patient_name_keys k
          where k.team_id = sineobex.current_team_id() and k.source = any ('{legal,preferred,alias,descriptor}')
            and k.source <> 'descriptor' and (k.tokens && '{smity}' or k.dm_codes && '{SMT,XMT}')
          order by 1 limit 100`),
        await explain(`
          select p.canonical_id from sineobex.patients p
          where p.team_id = sineobex.current_team_id() and p.birth_year between 1977 and 1983
            and (p.birth_date = '1980-03-07' or p.birth_date = '1980-07-03' or p.birth_date is null)
          limit 200`),
      ];
    });
    const scans: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const n = node as {
        'Node Type'?: string;
        'Relation Name'?: string;
        'Index Name'?: string;
        Plans?: unknown[];
      };
      if (n['Relation Name']) scans.push(`${n['Node Type']}:${n['Relation Name']}:${n['Index Name'] ?? ''}`);
      for (const child of n.Plans ?? []) walk(child);
      if ('Plan' in (node as object)) walk((node as { Plan: unknown }).Plan);
    };
    for (const plan of plans) walk(plan);
    expect(scans.filter((s) => s.startsWith('Seq Scan'))).toEqual([]);
    expect(scans.length).toBeGreaterThanOrEqual(3);
  });
});
