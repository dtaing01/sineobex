import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { addMember, asApp, makeTeam, makeUser } from './helpers.ts';

describe('roles and memberships', () => {
  let db: ScratchDatabase;
  let teamA: string;
  let teamB: string;
  let mercy: string;
  let brooke: string;

  beforeAll(async () => {
    db = await createScratchDatabase();
    teamA = await makeTeam(db.owner, 'Team A');
    teamB = await makeTeam(db.owner, 'Team B');
    mercy = await makeUser(db.owner, 'mercy@example.com');
    brooke = await makeUser(db.owner, 'brooke@example.com');
    await addMember(db.owner, teamA, mercy, 'program_admin');
    await addMember(db.owner, teamB, mercy, 'healthcare_staff');
    await addMember(db.owner, teamB, brooke, 'healthcare_staff');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('ships the four standard roles', async () => {
    const rows = await db.owner<
      { key: string }[]
    >`select key from sineobex.roles where is_standard order by key`;
    expect(rows.map((r) => r.key)).toEqual([
      'billing_data',
      'healthcare_staff',
      'logistics',
      'program_admin',
    ]);
  });

  it('rejects permissions that do not exist', async () => {
    await expect(db.owner`
      insert into sineobex.roles (team_id, key, name, permissions)
      values (${teamA}, 'custom_x', 'X', array['patients.view', 'patients.delete_everything'])`).rejects.toThrow(
      /roles_known_permissions/,
    );
  });

  it('never lets the application change a standard role', async () => {
    await expect(
      asApp(
        db.appUrl,
        { teamId: teamA, userId: mercy },
        (tx) => tx`
        update sineobex.roles set permissions = array['patients.view'] where key = 'logistics' and team_id is null`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('shows one person their memberships in every team, and nobody else’s outside the acting team', async () => {
    const own = await asApp(
      db.appUrl,
      { userId: mercy },
      (tx) => tx`select team_id from sineobex.team_memberships`,
    );
    expect(own.map((r) => r.team_id).sort()).toEqual([teamA, teamB].sort());
    const actingInA = await asApp(
      db.appUrl,
      { teamId: teamA, userId: mercy },
      (tx) => tx`
      select user_id from sineobex.team_memberships`,
    );
    // Team A has only Mercy; Brooke's Team B membership is not visible from Team A.
    expect(actingInA.map((r) => r.user_id)).toEqual(expect.arrayContaining([mercy]));
    expect(actingInA.some((r) => r.user_id === brooke)).toBe(false);
  });

  it('returns nothing at all without request context', async () => {
    const rows = await asApp(db.appUrl, {}, (tx) => tx`select id from sineobex.team_memberships`);
    expect(rows).toHaveLength(0);
    const teams = await asApp(db.appUrl, {}, (tx) => tx`select id from sineobex.teams`);
    expect(teams).toHaveLength(0);
  });

  it('keeps membership history append-only', async () => {
    const [m] = await db.owner<{ id: string }[]>`select id from sineobex.team_memberships limit 1`;
    await db.owner`insert into sineobex.membership_changes (team_id, membership_id, kind, reason, changed_by)
                   select team_id, id, 'role', 'test', user_id from sineobex.team_memberships where id = ${m!.id}`;
    await expect(db.owner`update sineobex.membership_changes set reason = 'edited'`).rejects.toThrow(
      /append-only/,
    );
  });
});
