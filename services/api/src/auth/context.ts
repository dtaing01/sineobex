import type { Context } from 'hono';
import type { Tx } from '../db/database.ts';
import { ApiError, forbidden, unauthorized } from '../lib/errors.ts';
import type { AppEnv, Deps } from '../types.ts';
import { REQUIRED_ACKNOWLEDGEMENTS } from './acknowledgements.ts';
import { CREDENTIALS, isPermission, type Credential, type Permission } from './permissions.ts';
import { TokenError, type VerifiedToken } from './verifier.ts';

/** A signed-in person, resolved from a verified token. */
export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  isOwner: boolean;
  token: VerifiedToken;
}

/** The team a request acts in, and what the person may do there. */
export interface TeamContext {
  teamId: string;
  teamName: string;
  teamSettings: Record<string, unknown>;
  membershipId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: ReadonlySet<Permission>;
  credential: Credential;
  credentialFields: Record<string, string>;
}

export interface AuditEvent {
  action: string;
  entity?: string;
  entityId?: string;
  patientId?: string | null;
  details?: Record<string, unknown>;
  deviceTime?: Date | null;
  location?: Record<string, unknown> | null;
}

export type AuditFn = (event: AuditEvent) => Promise<void>;

/** Admin actions need a sign-in this recent (module 9: "sign-in again for exports and admin actions"). */
export const RECENT_AUTH_MINUTES = 15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function isUuid(v: string | undefined | null): v is string {
  return typeof v === 'string' && UUID.test(v);
}

function clientIp(c: Context<AppEnv>): string | null {
  const forwarded =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip')?.trim();
  if (!forwarded) return null;
  return IPV4.test(forwarded) || (IPV6.test(forwarded) && forwarded.includes(':')) ? forwarded : null;
}

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  deviceId: string | null;
}

export function requestMeta(c: Context<AppEnv>): RequestMeta {
  const device = c.req.header('x-device-id');
  return {
    requestId: c.get('requestId'),
    ip: clientIp(c),
    deviceId: isUuid(device) ? device.toLowerCase() : null,
  };
}

function bearer(c: Context<AppEnv>): string {
  const header = c.req.header('authorization');
  const match = header ? /^Bearer\s+([A-Za-z0-9\-_.]+)$/.exec(header) : null;
  if (!match) throw unauthorized();
  return match[1]!;
}

async function writeAudit(
  tx: Tx,
  teamId: string | null,
  actor: { userId: string | null; roleKey: string | null; credential: string | null },
  meta: RequestMeta,
  e: AuditEvent,
): Promise<void> {
  await tx`
    select sineobex.append_audit(
      ${teamId}, ${actor.userId}, ${actor.roleKey}, ${actor.credential}, ${e.action},
      ${e.entity ?? null}, ${e.entityId ?? null}, ${e.patientId ?? null}, ${meta.deviceId},
      ${meta.ip}::inet, ${meta.requestId}, ${e.deviceTime ?? null}, ${e.location ? tx.json(e.location as never) : null},
      ${tx.json((e.details ?? {}) as never)}
    )`;
}

/** Verifies the bearer token and resolves the person. Cached per request. */
export async function authenticate(c: Context<AppEnv>, deps: Deps): Promise<Principal> {
  const cached = c.get('principal');
  if (cached) return cached;
  let token: VerifiedToken;
  try {
    token = await deps.verifier.verify(bearer(c));
  } catch (err) {
    if (err instanceof TokenError || err instanceof ApiError) throw unauthorized();
    throw err;
  }
  const rows = await deps.db.tx(
    {},
    (tx) => tx<{ id: string; email: string; displayName: string; status: string; isOwner: boolean }[]>`
    select u.id, u.email, u.display_name, u.status,
           exists (select 1 from sineobex.platform_owners o where o.user_id = u.id) as is_owner
    from sineobex.users u
    where u.auth_issuer = ${token.issuer} and u.auth_subject = ${token.subject}`,
  );
  const user = rows[0];
  // Sign-ups are closed: only people an owner or Program Admin invited have a user row.
  if (!user) throw forbidden('Your account has not been invited to a team.', 'not_invited');
  if (user.status !== 'active') throw forbidden('Your account is disabled.', 'account_disabled');
  const principal: Principal = {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    isOwner: user.isOwner,
    token,
  };
  c.set('principal', principal);
  return principal;
}

export function mfaSatisfied(deps: Deps, p: Principal): boolean {
  return deps.config.MFA_MODE !== 'aal' || p.token.aal === 'aal2';
}

function requireMfa(deps: Deps, p: Principal): void {
  if (!mfaSatisfied(deps, p)) {
    throw forbidden('Finish signing in with your authenticator app or passkey.', 'mfa_required');
  }
}

function requireRecentAuth(deps: Deps, p: Principal): void {
  const at = p.token.authTime;
  if (!at || deps.now().getTime() - at.getTime() > RECENT_AUTH_MINUTES * 60_000) {
    throw forbidden('Sign in again to confirm it is you.', 'reauth_required');
  }
}

export async function pendingAcknowledgements(deps: Deps, p: Principal) {
  const rows = await deps.db.tx(
    { userId: p.userId },
    (tx) => tx<{ kind: string; version: string }[]>`
    select kind, version from sineobex.acknowledgements where user_id = ${p.userId}`,
  );
  const have = new Set(rows.map((r) => `${r.kind}@${r.version}`));
  return REQUIRED_ACKNOWLEDGEMENTS.filter((a) => !have.has(`${a.kind}@${a.version}`));
}

/** Request scope for a signed-in person outside any team (their profile, acknowledgements). */
export class UserScope {
  constructor(
    readonly deps: Deps,
    readonly principal: Principal,
    readonly meta: RequestMeta,
  ) {}

  tx<T>(fn: (tx: Tx, audit: AuditFn) => Promise<T>): Promise<T> {
    return this.deps.db.tx({ userId: this.principal.userId }, (tx) =>
      fn(tx, (e) =>
        writeAudit(
          tx,
          null,
          { userId: this.principal.userId, roleKey: null, credential: null },
          this.meta,
          e,
        ),
      ),
    );
  }
}

export async function userScope(c: Context<AppEnv>, deps: Deps): Promise<UserScope> {
  return new UserScope(deps, await authenticate(c, deps), requestMeta(c));
}

export interface TeamScopeOptions {
  /** Every listed permission is required. */
  permissions?: Permission[];
  /** Admin and export actions: the person must have signed in within RECENT_AUTH_MINUTES. */
  recentAuth?: boolean;
}

/** Request scope inside one team. Every data route goes through here. */
export class TeamScope {
  constructor(
    readonly deps: Deps,
    readonly principal: Principal,
    readonly team: TeamContext,
    readonly meta: RequestMeta,
  ) {}

  can(permission: Permission): boolean {
    return this.team.permissions.has(permission);
  }

  /** Refuses and records the refusal (module 1: a typed URL must be "refused by the server and logged"). */
  async require(permission: Permission, route: string): Promise<void> {
    if (this.can(permission)) return;
    await this.tx((_, audit) => audit({ action: 'access.denied', details: { permission, route } }));
    throw forbidden();
  }

  tx<T>(fn: (tx: Tx, audit: AuditFn) => Promise<T>): Promise<T> {
    const actor = {
      userId: this.principal.userId,
      roleKey: this.team.roleKey,
      credential: this.team.credential,
    };
    return this.deps.db.tx({ teamId: this.team.teamId, userId: this.principal.userId }, (tx) =>
      fn(tx, (e) => writeAudit(tx, this.team.teamId, actor, this.meta, e)),
    );
  }
}

export async function teamScope(
  c: Context<AppEnv>,
  deps: Deps,
  options: TeamScopeOptions = {},
): Promise<TeamScope> {
  const principal = await authenticate(c, deps);
  requireMfa(deps, principal);
  const teamId = c.req.header('x-team-id');
  if (!isUuid(teamId)) throw new ApiError(400, 'team_required', 'Choose a team first.');

  const pending = await pendingAcknowledgements(deps, principal);
  if (pending.length > 0) {
    throw forbidden(
      'Accept the Terms of Use and the confidentiality acknowledgement first.',
      'acknowledgement_required',
    );
  }

  const rows = await deps.db.tx(
    { teamId, userId: principal.userId },
    (tx) => tx<
      {
        membershipId: string;
        status: string;
        credential: string;
        credentialFields: Record<string, string>;
        roleId: string;
        roleKey: string;
        roleName: string;
        permissions: string[];
        teamName: string;
        teamStatus: string;
        teamSettings: Record<string, unknown>;
      }[]
    >`
    select m.id as membership_id, m.status, m.credential, m.credential_fields,
           r.id as role_id, r.key as role_key, r.name as role_name, r.permissions,
           t.name as team_name, t.status as team_status, t.settings as team_settings
    from sineobex.team_memberships m
    join sineobex.roles r on r.id = m.role_id
    join sineobex.teams t on t.id = m.team_id
    where m.team_id = ${teamId} and m.user_id = ${principal.userId}`,
  );
  const row = rows[0];
  if (!row || row.status !== 'active') throw forbidden('You are not a member of this team.', 'not_a_member');
  if (row.teamStatus !== 'active') throw forbidden('This team is suspended.', 'team_suspended');

  const team: TeamContext = {
    teamId: teamId.toLowerCase(),
    teamName: row.teamName,
    teamSettings: row.teamSettings,
    membershipId: row.membershipId,
    roleId: row.roleId,
    roleKey: row.roleKey,
    roleName: row.roleName,
    permissions: new Set(row.permissions.filter(isPermission)),
    credential: (CREDENTIALS as readonly string[]).includes(row.credential)
      ? (row.credential as Credential)
      : 'none',
    credentialFields: row.credentialFields,
  };
  const scope = new TeamScope(deps, principal, team, requestMeta(c));
  for (const p of options.permissions ?? []) await scope.require(p, c.req.routePath);
  if (options.recentAuth) requireRecentAuth(deps, principal);
  return scope;
}

/** Request scope for platform owners: crosses teams, writes to the platform or a team's chain. */
export class OwnerScope {
  constructor(
    readonly deps: Deps,
    readonly principal: Principal,
    readonly meta: RequestMeta,
  ) {}

  tx<T>(
    fn: (tx: Tx, audit: (teamId: string | null, e: AuditEvent) => Promise<void>) => Promise<T>,
  ): Promise<T> {
    const actor = { userId: this.principal.userId, roleKey: 'platform_owner', credential: null };
    return this.deps.db.tx({ userId: this.principal.userId, platform: true }, (tx) =>
      fn(tx, (teamId, e) => writeAudit(tx, teamId, actor, this.meta, e)),
    );
  }
}

export async function ownerScope(c: Context<AppEnv>, deps: Deps): Promise<OwnerScope> {
  const principal = await authenticate(c, deps);
  requireMfa(deps, principal);
  if (!principal.isOwner) {
    await deps.db.tx({ userId: principal.userId, platform: true }, (tx) =>
      writeAudit(tx, null, { userId: principal.userId, roleKey: null, credential: null }, requestMeta(c), {
        action: 'access.denied',
        details: { permission: 'platform.owner', route: c.req.routePath },
      }),
    );
    throw forbidden('Only platform owners can do this.', 'owner_only');
  }
  requireRecentAuth(deps, principal);
  return new OwnerScope(deps, principal, requestMeta(c));
}
