import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser, refusal } from './helpers.ts';

// 0021: referrals (phase 4 design, lifecycle 2.5 and 7). A date and free text, made on the phone,
// with one retraction; nothing of V2's status or completion. Made-up people only.

const CHECK = '23514';
const FOREIGN_KEY = '23503';
const NOT_NULL = '23502';
const DENIED = '42501';
type Row = Record<string, unknown>;

describe('0021 referrals', () => {
  let db: ScratchDatabase;
  let team: string;
  let otherTeam: string;
  let worker: string;
  let clinician: string;
  let device: string;
  let patient: string;
  let otherPatient: string;
  let visit: string;
  let otherVisit: string;

  const as = <T>(teamId: string, run: (tx: TransactionSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId, userId: worker }, run);
  const inTeam = <T>(run: (tx: TransactionSql) => Promise<T>) => as(team, run);

  const insertPatient = async (teamId: string) => {
    const id = randomUUID();
    await db.owner`
      insert into sineobex.patients (id, team_id, canonical_id, preferred_name, registered_at, author_user_id)
      values (${id}, ${teamId}, ${id}, 'Demo person', now(), ${worker})`;
    return id;
  };
  const insertVisit = async (teamId: string, ofPatient: string) => {
    const id = randomUUID();
    await db.owner`insert into sineobex.encounters (id, team_id, patient_id, kind, author_user_id, started_at)
                   values (${id}, ${teamId}, ${ofPatient}, 'non_medical', ${worker}, now())`;
    return id;
  };

  // A whole referral, as the API writes one a phone made.
  const referral = (over: Row = {}): Row => ({
    id: randomUUID(),
    team_id: team,
    patient_id: patient,
    referred_on: '2026-03-04',
    details: 'Demo: foot clinic, Tuesday mornings',
    recorded_at: new Date(),
    author_user_id: worker,
    ...over,
  });
  const JSON_COLUMNS = ['field_versions', 'field_meta'];
  const values = (tx: Sql | TransactionSql, row: Row) => {
    const out: Row = { ...row };
    for (const c of JSON_COLUMNS) if (c in out && out[c] !== null) out[c] = tx.json(out[c] as never);
    return tx(out);
  };
  const insert = (over: Row = {}, teamId = team) => {
    const row = referral(over);
    return {
      id: row.id as string,
      done: as(teamId, (tx) => tx`insert into sineobex.referrals ${values(tx, row)}`),
    };
  };
  /** The refusal of one referral that differs from a whole one by `over`. */
  const refused = (over: Row, teamId = team) => refusal(insert(over, teamId).done);
  const refusedAsOwner = (over: Row) =>
    refusal(db.owner`insert into sineobex.referrals ${values(db.owner, referral(over))}`);
  const made = async (over: Row = {}) => {
    const { id, done } = insert(over);
    await done;
    return id;
  };
  const set = (id: string, change: Row) =>
    refusal(inTeam((tx) => tx`update sineobex.referrals set ${tx(change)} where id = ${id}`));

  beforeAll(async () => {
    db = await createScratchDatabase();
    team = await makeTeam(db.owner, 'Referral Team');
    otherTeam = await makeTeam(db.owner, 'Referral Other Team');
    worker = await makeUser(db.owner, 'referral-worker@example.com');
    clinician = await makeUser(db.owner, 'referral-clinician@example.com');
    device = randomUUID();
    await db.owner`insert into sineobex.devices (id, team_id, user_id, platform, app_version, public_key)
                   values (${device}, ${team}, ${worker}, 'other', 'test', ${'A'.repeat(43)})`;
    patient = await insertPatient(team);
    otherPatient = await insertPatient(otherTeam);
    visit = await insertVisit(team, patient);
    otherVisit = await insertVisit(otherTeam, otherPatient);
  });
  afterAll(() => db.drop());

  it('takes a referral from the app role and gives it back', async () => {
    const id = await made({ encounter_id: visit, created_device_id: device, clock_verified: true });
    const found = await inTeam(
      (tx) => tx`
        select patient_id, referred_on::text as referred_on, details, encounter_id, created_device_id,
               clock_verified, author_user_id
        from sineobex.referrals where id = ${id}`,
    );
    expect(found).toEqual([
      {
        patient_id: patient,
        referred_on: '2026-03-04',
        details: 'Demo: foot clinic, Tuesday mornings',
        encounter_id: visit,
        created_device_id: device,
        clock_verified: true,
        author_user_id: worker,
      },
    ]);
  });

  it('takes and gives back a referral of any team to a platform-scope request', async () => {
    const row = referral();
    const seen = await asApp(db.appUrl, { userId: worker, platform: true }, async (tx) => {
      await tx`insert into sineobex.referrals ${values(tx, row)}`;
      return tx<
        { teamId: string }[]
      >`select team_id as "teamId" from sineobex.referrals where id = ${row.id as string}`;
    });
    expect(seen).toEqual([{ teamId: team }]);
  });

  it('holds a date, free text and the bookkeeping of a synced record, and nothing of V2', async () => {
    const columns = await db.owner<{ name: string; type: string }[]>`
      select column_name as name, data_type as type from information_schema.columns
      where table_schema = 'sineobex' and table_name = 'referrals' order by ordinal_position`;
    expect(columns.map((c) => `${c.name} ${c.type}`)).toEqual([
      'id uuid',
      'team_id uuid',
      'patient_id uuid',
      'referred_on date',
      'details text',
      'encounter_id uuid',
      'status text',
      'error_reason text',
      'error_by uuid',
      'error_at timestamp with time zone',
      'recorded_at timestamp with time zone',
      'clock_verified boolean',
      'author_user_id uuid',
      'created_device_id uuid',
      'field_versions jsonb',
      'field_meta jsonb',
      'version integer',
      'created_at timestamp with time zone',
      'updated_at timestamp with time zone',
    ]);
  });

  it('needs no visit, and fills in what a new referral leaves out', async () => {
    const id = await made();
    const [row] = await db.owner`
      select encounter_id, status, error_reason, error_by, error_at, clock_verified, created_device_id,
             field_versions, field_meta, version,
             extract(epoch from now() - created_at)::float8 as age, updated_at = created_at as untouched
      from sineobex.referrals where id = ${id}`;
    const { age, ...rest } = row as { age: number };
    expect(rest).toEqual({
      encounter_id: null,
      status: 'active',
      error_reason: null,
      error_by: null,
      error_at: null,
      clock_verified: false,
      created_device_id: null,
      field_versions: {},
      field_meta: {},
      version: 1,
      untouched: true,
    });
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(60);
  });

  it('refuses a referral with a part missing', async () => {
    const required = [
      ...['id', 'team_id', 'patient_id', 'referred_on', 'details', 'status', 'recorded_at', 'clock_verified'],
      ...['author_user_id', 'field_versions', 'field_meta', 'version', 'created_at', 'updated_at'],
    ];
    for (const column of required) {
      expect(await refusedAsOwner({ [column]: null }), column).toEqual({ code: NOT_NULL });
    }
    // The phone makes the ID and says what, for whom and when: nothing is made up for a part left out.
    for (const column of Object.keys(referral())) {
      const rest = Object.fromEntries(Object.entries(referral()).filter(([c]) => c !== column));
      expect(
        await refusal(db.owner`insert into sineobex.referrals ${values(db.owner, rest)}`),
        `no ${column}`,
      ).toEqual({ code: NOT_NULL });
    }
  });

  it('holds 1 to 2,000 characters of details', async () => {
    const refusedDetails = { code: CHECK, constraint: 'referrals_details_check' };
    for (const details of ['', '   ', 'é'.repeat(2001)]) {
      expect(await refused({ details }), `${details.length} characters`).toEqual(refusedDetails);
    }
    expect(await refused({ details: 'é'.repeat(2000) })).toBeNull();
    expect(await refused({ details: 'D' })).toBeNull();
  });

  it('is about a patient of its own team', async () => {
    const constraint = 'referrals_team_id_patient_id_fkey';
    expect(await refused({ patient_id: randomUUID() })).toEqual({ code: FOREIGN_KEY, constraint });
    expect(await refused({ patient_id: otherPatient })).toEqual({ code: FOREIGN_KEY, constraint });
  });

  it('names only a visit of its own team', async () => {
    const constraint = 'referrals_team_id_encounter_id_fkey';
    expect(await refused({ encounter_id: randomUUID() })).toEqual({ code: FOREIGN_KEY, constraint });
    expect(await refused({ encounter_id: otherVisit })).toEqual({ code: FOREIGN_KEY, constraint });
    // The other team's own referral, at its own visit, is fine.
    expect(
      await refused({ team_id: otherTeam, patient_id: otherPatient, encounter_id: otherVisit }, otherTeam),
    ).toBeNull();
  });

  it('names real people, a real phone and a real team', async () => {
    const nobody = randomUUID();
    for (const column of ['team_id', 'author_user_id', 'created_device_id']) {
      // As the owner, so a made-up team is answered by the key and not by the team policy.
      expect(await refusedAsOwner({ [column]: nobody }), column).toEqual({
        code: FOREIGN_KEY,
        constraint: `referrals_${column}_fkey`,
      });
    }
    expect(
      await refusedAsOwner({
        status: 'entered_in_error',
        error_reason: 'Demo: wrong person',
        error_by: nobody,
        error_at: new Date(),
      }),
    ).toEqual({ code: FOREIGN_KEY, constraint: 'referrals_error_by_fkey' });
  });

  describe('entered in error', () => {
    const retraction = () => ({
      status: 'entered_in_error',
      error_reason: 'Demo: meant for someone else',
      error_by: clinician,
      error_at: new Date(),
    });
    const TIED = { code: CHECK, constraint: 'referrals_error_with_status' };

    it('is the only other state, and the referral stays', async () => {
      for (const status of ['completed', 'pending', 'Active', '']) {
        expect(await refused({ status }), status).toEqual({
          code: CHECK,
          constraint: 'referrals_status_check',
        });
      }
      const id = await made();
      expect(await set(id, retraction())).toBeNull();
      const [row] = await db.owner`
        select status, details, error_reason, error_by from sineobex.referrals where id = ${id}`;
      expect(row).toEqual({
        status: 'entered_in_error',
        details: 'Demo: foot clinic, Tuesday mornings',
        error_reason: 'Demo: meant for someone else',
        error_by: clinician,
      });
    });

    it('says why, who and when, all three, and an active referral says none', async () => {
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
      // An update that marks it and gives no reason is refused as an insert is.
      const id = await made();
      expect(await set(id, { status: 'entered_in_error' })).toEqual(TIED);
      expect(await set(id, { error_reason: 'Demo: meant for someone else' })).toEqual(TIED);
    });

    it('gives a reason of 3 to 300 characters', async () => {
      const refusedReason = { code: CHECK, constraint: 'referrals_error_reason_check' };
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

  it('moves its time of last change when it changes', async () => {
    const id = await made();
    await inTeam((tx) => tx`update sineobex.referrals set version = version + 1 where id = ${id}`);
    const [row] = await db.owner<{ moved: boolean; version: number }[]>`
      select updated_at > created_at as moved, version from sineobex.referrals where id = ${id}`;
    expect(row).toEqual({ moved: true, version: 2 });
  });

  it('is never deleted by the app role', async () => {
    const id = await made();
    expect(await refusal(inTeam((tx) => tx`delete from sineobex.referrals where id = ${id}`))).toEqual({
      code: DENIED,
    });
    const [rights] = await db.owner<{ read: boolean; add: boolean; change: boolean; remove: boolean }[]>`
      select has_table_privilege('sineobex_app', 'sineobex.referrals', 'select') as read,
             has_table_privilege('sineobex_app', 'sineobex.referrals', 'insert') as add,
             has_table_privilege('sineobex_app', 'sineobex.referrals', 'update') as change,
             has_table_privilege('sineobex_app', 'sineobex.referrals', 'delete') as remove`;
    expect(rights).toEqual({ read: true, add: true, change: true, remove: false });
  });

  it('hides a team’s referrals from another team, and takes none written or changed across teams', async () => {
    const id = await made();
    const seen = (teamId: string) =>
      as(
        teamId,
        (tx) => tx<{ teamId: string }[]>`select distinct team_id as "teamId" from sineobex.referrals`,
      );
    expect(await seen(team)).toEqual([{ teamId: team }]);
    expect(await seen(otherTeam)).not.toContainEqual({ teamId: team });
    // Acting in the other team, nobody writes into this one, and nobody changes what is here.
    expect(await refused({}, otherTeam)).toEqual({ code: DENIED });
    const changed = await as(
      otherTeam,
      (tx) => tx`update sineobex.referrals set details = 'Demo: rewritten' where id = ${id} returning id`,
    );
    expect(changed).toEqual([]);
    // Nor does anyone move a referral of their own into another team.
    const theirs = randomUUID();
    await as(
      otherTeam,
      (tx) =>
        tx`insert into sineobex.referrals ${values(tx, referral({ id: theirs, team_id: otherTeam, patient_id: otherPatient }))}`,
    );
    expect(
      await refusal(
        as(
          otherTeam,
          (tx) =>
            tx`update sineobex.referrals set team_id = ${team}, patient_id = ${patient} where id = ${theirs}`,
        ),
      ),
    ).toEqual({ code: DENIED });
  });

  it('has the key other tables point at, and the index a chart reads newest first', async () => {
    const indexes = await db.owner<{ name: string; definition: string }[]>`
      select c.relname as name, regexp_replace(pg_get_indexdef(i.indexrelid), '^.* USING ', '') as definition
      from pg_index i join pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'sineobex.referrals'::regclass and not i.indisprimary order by c.relname`;
    expect(indexes).toEqual([
      { name: 'referrals_patient', definition: 'btree (team_id, patient_id, referred_on DESC)' },
      { name: 'referrals_team_id_key', definition: 'btree (team_id, id)' },
    ]);
    const [key] = await db.owner<{ unique: boolean }[]>`
      select indisunique as unique from pg_index where indexrelid = 'sineobex.referrals_team_id_key'::regclass`;
    expect(key).toEqual({ unique: true });
  });

  describe('the patient of a held change (patient_of_change)', () => {
    // As the app role, the way the review queue asks.
    const of = (record: string, value: unknown) =>
      inTeam(
        async (tx) =>
          (
            await tx<{ p: string | null }[]>`
              select sineobex.patient_of_change('referral', ${record}, ${tx.json(value as never)}) as p`
          )[0]!.p,
      );

    it('is the referral’s own patient once it is on the chart, whatever the value says', async () => {
      const elsewhere = await insertPatient(team);
      const id = await made();
      // Marking it entered in error sends a reason and no patient.
      expect(await of(id, { reason: 'Demo: meant for someone else' })).toBe(patient);
      expect(await of(id, { patientId: elsewhere })).toBe(patient);
    });

    it('is the patient its create names while the referral is held', async () => {
      expect(await of(randomUUID(), { patientId: patient, referredOn: '2026-03-04', details: 'Demo' })).toBe(
        patient,
      );
      expect(await of(randomUUID(), { reason: 'Demo: meant for someone else' })).toBeNull();
      expect(await of(randomUUID(), { patientId: 'not-an-id' })).toBeNull();
    });

    describe('while its create is held', () => {
      const hold = (record: string, op: string, value: Row, at: Date) => db.owner`
        insert into sineobex.quarantine_items (team_id, device_id, user_id, change_id, entity, record_id, op,
          value, value_hash, device_time, reason, received_at)
        values (${team}, ${device}, ${worker}, ${randomUUID()}, 'referral', ${record}, ${op},
          ${db.owner.json(value as never)}, ${'0'.repeat(64)}, now(), 'permission', ${at})`;

      it('a held entered in error is about the patient that create names', async () => {
        const id = randomUUID();
        const elsewhere = await insertPatient(team);
        await hold(
          id,
          'create',
          { patientId: elsewhere, referredOn: '2026-03-04', details: 'Demo' },
          new Date(Date.now() - 60_000),
        );
        // Created again while held, naming its patient: the later create answers.
        await hold(
          id,
          'create',
          { patientId: patient, referredOn: '2026-03-04', details: 'Demo' },
          new Date(Date.now() - 30_000),
        );
        await hold(id, 'set', { reason: 'Demo: meant for someone else' }, new Date());
        expect(await of(id, { reason: 'Demo: meant for someone else' })).toBe(patient);
        // The value's own patient still answers first, as it did.
        expect(await of(id, { patientId: elsewhere })).toBe(elsewhere);
        // Another team's request learns nothing of it.
        expect(
          await as(
            otherTeam,
            async (tx) =>
              (
                await tx<{ p: string | null }[]>`
                  select sineobex.patient_of_change('referral', ${id}, ${tx.json({ reason: 'x' } as never)}) as p`
              )[0]!.p,
          ),
        ).toBeNull();
      });

      it('another team’s referral on the chart names no patient to this team', async () => {
        const theirs = randomUUID();
        await db.owner`
          insert into sineobex.referrals ${values(db.owner, referral({ id: theirs, team_id: otherTeam, patient_id: otherPatient }))}`;
        expect(await of(theirs, { reason: 'x' })).toBeNull();
      });
    });
  });
});
