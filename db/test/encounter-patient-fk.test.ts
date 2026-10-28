import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate, setEnvironment } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser } from './helpers.ts';

// Migration 0013 (phase 3 design 1.6, 13.4): encounters name a real patient of their team. The
// API answers first (patient_missing); this is the line behind it. Made-up people only.

describe('0013: the encounter names a patient of its team', () => {
  let db: ScratchDatabase;
  let dir: string;
  let team: string;
  let other: string;
  let user: string;
  let ghostEncounter: string;
  let ghost: string;

  const patient = async (teamId: string) => {
    const id = randomUUID();
    await db.owner`
      insert into sineobex.patients (id, team_id, canonical_id, preferred_name, registered_at, author_user_id)
      values (${id}, ${teamId}, ${id}, 'Demo person', now(), ${user})`;
    return id;
  };
  const encounter = (teamId: string, patientId: string | null) =>
    db.owner`
      insert into sineobex.encounters (id, team_id, patient_id, kind, author_user_id, started_at)
      values (${randomUUID()}, ${teamId}, ${patientId}, 'medical', ${user}, now())`;

  beforeAll(async () => {
    db = await createScratchDatabase({ migrate: false });
    dir = await mkdtemp(join(tmpdir(), 'mig-0013-'));
    for (const f of await readdir(MIGRATIONS_DIR)) {
      if (f < '0013') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    await migrate(db.owner, { dir });
    await setEnvironment(db.owner, 'test');
    team = await makeTeam(db.owner, 'Street Team');
    other = await makeTeam(db.owner, 'Other Team');
    user = await makeUser(db.owner, 'fk@example.com');
    // A phase 2 row naming a patient that never existed, from before the constraint.
    ghostEncounter = randomUUID();
    ghost = randomUUID();
    await db.owner`
      insert into sineobex.encounters (id, team_id, patient_id, kind, author_user_id, started_at)
      values (${ghostEncounter}, ${team}, ${ghost}, 'medical', ${user}, now())`;
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('applies over phase 2 rows naming unknown patients and leaves them as they are', async () => {
    const result = await migrate(db.owner);
    expect(result.applied[0]).toBe('0013');
    const [row] = await db.owner<{ patientId: string }[]>`
      select patient_id as "patientId" from sineobex.encounters where id = ${ghostEncounter}`;
    expect(row!.patientId).toBe(ghost);
    const [fk] = await db.owner<{ validated: boolean }[]>`
      select convalidated as validated from pg_constraint where conname = 'encounters_patient_fk'`;
    expect(fk!.validated).toBe(false);
    // A change that leaves the patient alone is fine; the old row is never re-checked for it.
    await db.owner`update sineobex.encounters set status = 'completed' where id = ${ghostEncounter}`;
  });

  it('refuses a new or changed encounter naming an unknown patient', async () => {
    await expect(encounter(team, randomUUID())).rejects.toMatchObject({
      code: '23503',
      constraint_name: 'encounters_patient_fk',
    });
    await expect(
      db.owner`update sineobex.encounters set patient_id = ${randomUUID()} where id = ${ghostEncounter}`,
    ).rejects.toMatchObject({ code: '23503', constraint_name: 'encounters_patient_fk' });
  });

  it('refuses another team’s patient, even to the application role, whatever row-level security shows', async () => {
    const theirs = await patient(other);
    await expect(encounter(team, theirs)).rejects.toMatchObject({ code: '23503' });
    await expect(
      asApp(
        db.appUrl,
        { teamId: team, userId: user },
        (tx) =>
          tx`insert into sineobex.encounters (id, team_id, patient_id, kind, author_user_id, started_at)
           values (${randomUUID()}, ${team}, ${theirs}, 'medical', ${user}, now())`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('takes a patient of the team, any status, or nobody', async () => {
    const mine = await patient(team);
    await encounter(team, mine);
    await encounter(team, null);
    const survivor = await patient(team);
    await db.owner`update sineobex.patients set status = 'merged', merged_into = ${survivor}, canonical_id = ${survivor}
                   where id = ${mine}`;
    await encounter(team, mine);
    await db.owner`update sineobex.encounters set patient_id = ${survivor} where id = ${ghostEncounter}`;
    const [n] = await db.owner<{ n: number }[]>`
      select count(*)::int as n from sineobex.encounters where team_id = ${team} and patient_id = ${mine}`;
    expect(n!.n).toBe(2);
  });

  it('indexes a patient’s encounters by team', async () => {
    const [ix] = await db.owner<{ def: string }[]>`
      select indexdef as def from pg_indexes where indexname = 'encounters_team_patient'`;
    expect(ix!.def).toContain('(team_id, patient_id, started_at)');
  });
});
