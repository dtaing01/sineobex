import { TeamScope } from '../src/auth/context.ts';
import { CREDENTIALS, isPermission, type Credential, type Permission } from '../src/auth/permissions.ts';
import { createDatabase, createSql, type Database } from '../src/db/database.ts';
import { silentLogger } from '../src/lib/log.ts';
import type { Deps } from '../src/types.ts';
import { TEST_ISSUER, type Harness } from './harness.ts';

/**
 * Row-level security is the second line, not the first (D5, D146): a handler names its team in its
 * own SQL. A bypass runs handlers on the scratch database's owner connection, a superuser no policy
 * applies to, so a query that leaves its team to the policies alone reads and writes every team's
 * rows, and a test that holds two teams' data sees it. Shared by every test of a handler's own team
 * filter (phase 6 design 13.2: I0-sweep's, then the coordinator's).
 */
export interface Bypass {
  /** The handlers' database: no policy limits what a transaction on it reads or writes. */
  db: Database;
  /**
   * A request's scope for the active member [email] of [teamId], built as teamScope builds one: their
   * role's keys, credential and membership as the database holds them, signed in just now. A test
   * that needs a narrower role names its [permissions] instead.
   */
  scope(teamId: string, email: string, options?: { permissions?: Iterable<Permission> }): Promise<TeamScope>;
  end(): Promise<void>;
}

interface MemberRow {
  userId: string;
  displayName: string;
  membershipId: string;
  credential: string;
  credentialFields: Record<string, string>;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  teamName: string;
  teamSettings: Record<string, unknown>;
}

export function bypassRowSecurity(h: Harness): Bypass {
  const sql = createSql(h.scratch.ownerUrl, { max: 2 });
  const deps: Deps = {
    config: h.config,
    db: createDatabase(sql),
    verifier: { verify: () => Promise.reject(new Error('no token is verified here')) },
    identityAdmin: h.identityAdmin,
    log: silentLogger,
    now: () => h.clock.now,
  };
  return {
    db: deps.db,
    async scope(teamId, email, options = {}) {
      const [m] = await sql<MemberRow[]>`
        select u.id as user_id, u.display_name, m.id as membership_id, m.credential, m.credential_fields,
               r.id as role_id, r.key as role_key, r.name as role_name, r.permissions,
               t.name as team_name, t.settings as team_settings
        from sineobex.team_memberships m
        join sineobex.users u on u.id = m.user_id
        join sineobex.roles r on r.id = m.role_id
        join sineobex.teams t on t.id = m.team_id
        where m.team_id = ${teamId} and u.email = ${email} and m.status = 'active'`;
      if (!m) throw new Error('the bypass scope names someone who is not an active member of the team');
      const now = h.clock.now;
      return new TeamScope(
        deps,
        {
          userId: m.userId,
          email,
          displayName: m.displayName,
          isOwner: false,
          token: {
            issuer: TEST_ISSUER,
            subject: `bypass|${email}`,
            email,
            emailVerified: true,
            aal: 'aal2',
            sessionId: null,
            authTime: now,
            expiresAt: new Date(now.getTime() + 3_600_000),
          },
        },
        {
          teamId,
          teamName: m.teamName,
          teamSettings: m.teamSettings,
          membershipId: m.membershipId,
          roleId: m.roleId,
          roleKey: m.roleKey,
          roleName: m.roleName,
          permissions: new Set(options.permissions ?? m.permissions.filter(isPermission)),
          credential: (CREDENTIALS as readonly string[]).includes(m.credential)
            ? (m.credential as Credential)
            : 'none',
          credentialFields: m.credentialFields,
        },
        { requestId: 'bypass-test', ip: null, deviceId: null },
      );
    },
    end: () => sql.end({ timeout: 5 }),
  };
}
