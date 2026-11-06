import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser } from './helpers.ts';

// 0014: a problem merge keeps its comment in patient_corrections under its own kind (phase 3
// design 9.4). Made-up people only.

describe('0014 problem merge corrections', () => {
  let db: ScratchDatabase;
  let team: string;
  let author: string;
  let patient: string;
  let problem: string;

  beforeAll(async () => {
    db = await createScratchDatabase();
    team = await makeTeam(db.owner, 'Problem Merge Team');
    author = await makeUser(db.owner, 'merge-admin@example.com');
    patient = randomUUID();
    await db.owner`insert into sineobex.patients (id, team_id, canonical_id, preferred_name, registered_at, author_user_id)
                   values (${patient}, ${team}, ${patient}, 'Demo person', now(), ${author})`;
    problem = randomUUID();
    await db.owner`insert into sineobex.problems (id, team_id, patient_id, title, sensitive, status,
                     status_changed_at, status_changed_by, status_checked_at, author_user_id)
                   values (${problem}, ${team}, ${patient}, 'Burn, left forearm', false, 'new', now(), ${author}, now(),
                     ${author})`;
  });
  afterAll(() => db.drop());

  it('accepts a problem_merge row from the app role, append-only like every correction', async () => {
    await asApp(
      db.appUrl,
      { teamId: team, userId: author },
      (tx) =>
        tx`insert into sineobex.patient_corrections (team_id, patient_id, kind, entity, record_id, field, new_value,
           reason, decided_by)
         values (${team}, ${patient}, 'problem_merge', 'problem', ${problem}, 'mergedInto',
           ${tx.json({ intoProblemId: randomUUID() })}, 'Same burn, one entry', ${author})`,
    );
    const rows = await db.owner<{ kind: string }[]>`
      select kind from sineobex.patient_corrections where record_id = ${problem}`;
    expect(rows).toEqual([{ kind: 'problem_merge' }]);
    await expect(db.owner`update sineobex.patient_corrections set reason = 'edited'`).rejects.toThrow(
      /append-only/,
    );
  });

  it('still refuses a kind nobody defined', async () => {
    await expect(
      db.owner`insert into sineobex.patient_corrections (team_id, patient_id, kind, entity, record_id, reason, decided_by)
               values (${team}, ${patient}, 'problem_split', 'problem', ${problem}, 'Not a kind', ${author})`,
    ).rejects.toThrow(/check constraint/);
  });
});
