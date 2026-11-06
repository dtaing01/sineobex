/**
 * Team membership changes (module 1 and the Oct 19 decisions): invite, change role, change
 * credential, remove. Shared by the team admin routes and the owner routes, which differ only in
 * who may touch Program Admins.
 */
import type { AuditFn } from '../auth/context.ts';
import type { IdentityAdmin } from '../auth/identity-admin.ts';
import {
  checkCredentialFields,
  isUpgrade,
  OWNER_ONLY_ROLE_KEYS,
  REQUIRED_FIELDS,
  type Credential,
} from '../auth/permissions.ts';
import type { Database, Tx } from '../db/database.ts';
import { conflict, forbidden, invalid, notFound } from '../lib/errors.ts';

export interface Actor {
  userId: string;
  isOwner: boolean;
}

export interface MemberView {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  status: 'active' | 'removed';
  role: { id: string; key: string; name: string; isStandard: boolean };
  credential: Credential;
  credentialFields: Record<string, string>;
  invitedAt: string;
  removedAt: string | null;
}

interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  status: 'active' | 'removed';
  roleId: string;
  roleKey: string;
  roleName: string;
  roleIsStandard: boolean;
  credential: Credential;
  credentialFields: Record<string, string>;
  invitedAt: Date;
  removedAt: Date | null;
  authIssuer: string;
  authSubject: string;
}

function view(r: MemberRow): MemberView {
  return {
    membershipId: r.membershipId,
    userId: r.userId,
    email: r.email,
    displayName: r.displayName,
    status: r.status,
    role: { id: r.roleId, key: r.roleKey, name: r.roleName, isStandard: r.roleIsStandard },
    credential: r.credential,
    credentialFields: r.credentialFields,
    invitedAt: r.invitedAt.toISOString(),
    removedAt: r.removedAt ? r.removedAt.toISOString() : null,
  };
}

const MEMBER_SELECT = (tx: Tx) => tx`
  select m.id as membership_id, u.id as user_id, u.email, u.display_name, m.status,
         r.id as role_id, r.key as role_key, r.name as role_name, r.is_standard as role_is_standard,
         m.credential, m.credential_fields, m.invited_at, m.removed_at,
         u.auth_issuer, u.auth_subject
  from sineobex.team_memberships m
  join sineobex.users u on u.id = m.user_id
  join sineobex.roles r on r.id = m.role_id`;

export async function listMembers(tx: Tx, teamId: string): Promise<MemberView[]> {
  const rows = await tx<MemberRow[]>`${MEMBER_SELECT(tx)} where m.team_id = ${teamId}
    order by m.status, lower(u.display_name)`;
  return rows.map(view);
}

async function loadMember(tx: Tx, teamId: string, membershipId: string): Promise<MemberRow> {
  const rows = await tx<MemberRow[]>`${MEMBER_SELECT(tx)}
    where m.team_id = ${teamId} and m.id = ${membershipId} for update of m`;
  if (!rows[0]) throw notFound('team member');
  return rows[0];
}

export async function getMember(tx: Tx, teamId: string, membershipId: string): Promise<MemberView> {
  const rows = await tx<
    MemberRow[]
  >`${MEMBER_SELECT(tx)} where m.team_id = ${teamId} and m.id = ${membershipId}`;
  if (!rows[0]) throw notFound('team member');
  return view(rows[0]);
}

async function loadRole(tx: Tx, teamId: string, roleId: string) {
  const rows = await tx<
    { id: string; key: string; name: string; teamId: string | null; archivedAt: Date | null }[]
  >`
    select id, key, name, team_id, archived_at from sineobex.roles
    where id = ${roleId} and (team_id is null or team_id = ${teamId})`;
  const role = rows[0];
  if (!role) throw notFound('role');
  if (role.archivedAt) throw invalid('role_archived', 'That role is archived.');
  return role;
}

function assertRoleAssignable(roleKey: string, actor: Actor): void {
  if (OWNER_ONLY_ROLE_KEYS.has(roleKey) && !actor.isOwner) {
    throw forbidden('Only platform owners can appoint or remove Program Admins.', 'owner_only');
  }
}

async function assertNotLastAdmin(tx: Tx, teamId: string, membershipId: string): Promise<void> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from sineobex.team_memberships m join sineobex.roles r on r.id = m.role_id
    where m.team_id = ${teamId} and m.status = 'active' and r.key = 'program_admin' and m.id <> ${membershipId}`;
  if ((row?.n ?? 0) === 0) {
    // PLAN-OPEN: "What happens when a team's only admin is suspended or removed". Until decided,
    // a team always keeps one; an owner appoints the replacement first.
    throw conflict('last_admin', 'A team must keep at least one Program Admin. Appoint another first.');
  }
}

function validateCredential(credential: Credential, fields: Record<string, string | undefined>) {
  const problems = checkCredentialFields(credential, fields);
  if (problems.length > 0) {
    throw invalid('credential_fields_invalid', 'Fill in the fields this credential needs.', { problems });
  }
  // Keep only the fields this credential uses, trimmed, so stale values from an old credential
  // never ride along.
  const kept: Record<string, string> = {};
  for (const f of REQUIRED_FIELDS[credential]) {
    const v = fields[f]?.trim();
    if (v) kept[f] = f === 'licenseState' ? v.toUpperCase() : v;
  }
  return kept;
}

export interface InviteInput {
  teamId: string;
  email: string;
  displayName: string;
  roleId: string;
  credential: Credential;
  credentialFields: Record<string, string | undefined>;
}

/**
 * Invites a person to a team. The identity is created at the provider first (outside the
 * transaction, since it can't be rolled back); a retry finds the same identity.
 */
export async function inviteMember(
  deps: { db: Database; identityAdmin: IdentityAdmin },
  runTx: <T>(fn: (tx: Tx, audit: AuditFn) => Promise<T>) => Promise<T>,
  actor: Actor,
  input: InviteInput,
): Promise<MemberView> {
  const email = input.email.trim().toLowerCase();
  const fields = validateCredential(input.credential, input.credentialFields);

  const preflight = await runTx(async (tx) => {
    const role = await loadRole(tx, input.teamId, input.roleId);
    assertRoleAssignable(role.key, actor);
    const existing = await tx<{ id: string; authIssuer: string; authSubject: string; status: string }[]>`
      select id, auth_issuer, auth_subject, status from sineobex.users where email = ${email}`;
    return { role, user: existing[0] ?? null };
  });

  const identity = preflight.user
    ? { issuer: preflight.user.authIssuer, subject: preflight.user.authSubject }
    : await deps.identityAdmin.inviteOrFind(email, input.displayName.trim());
  if (preflight.user?.status === 'disabled') await deps.identityAdmin.enable(identity);

  return runTx(async (tx, audit) => {
    const [user] = await tx<{ id: string }[]>`
      insert into sineobex.users (email, display_name, auth_issuer, auth_subject)
      values (${email}, ${input.displayName.trim()}, ${identity.issuer}, ${identity.subject})
      on conflict (email) do update set status = 'active'
      returning id`;
    const userId = user!.id;

    const existing = await tx<{ id: string; status: string }[]>`
      select id, status from sineobex.team_memberships where team_id = ${input.teamId} and user_id = ${userId}
      for update`;
    let membershipId: string;
    let kind: 'invited' | 'restored';
    if (existing[0]?.status === 'active') {
      throw conflict('already_member', 'That person is already on this team.');
    } else if (existing[0]) {
      membershipId = existing[0].id;
      kind = 'restored';
      await tx`
        update sineobex.team_memberships
        set status = 'active', role_id = ${input.roleId}, credential = ${input.credential},
            credential_fields = ${tx.json(fields)}, removed_at = null, removed_by = null, removal_reason = null,
            invited_by = ${actor.userId}, invited_at = now()
        where id = ${membershipId}`;
    } else {
      kind = 'invited';
      const [m] = await tx<{ id: string }[]>`
        insert into sineobex.team_memberships (team_id, user_id, role_id, credential, credential_fields, invited_by)
        values (${input.teamId}, ${userId}, ${input.roleId}, ${input.credential}, ${tx.json(fields)}, ${actor.userId})
        returning id`;
      membershipId = m!.id;
    }

    const newValue = { roleKey: preflight.role.key, credential: input.credential };
    await tx`
      insert into sineobex.membership_changes (team_id, membership_id, kind, new_value, changed_by)
      values (${input.teamId}, ${membershipId}, ${kind}, ${tx.json(newValue)}, ${actor.userId})`;
    await audit({
      action: kind === 'invited' ? 'membership.invited' : 'membership.restored',
      entity: 'membership',
      entityId: membershipId,
      details: { userId, ...newValue },
    });
    return getMember(tx, input.teamId, membershipId);
  });
}

export async function changeRole(
  tx: Tx,
  audit: AuditFn,
  actor: Actor,
  input: { teamId: string; membershipId: string; roleId: string; reason: string },
): Promise<MemberView> {
  const member = await loadMember(tx, input.teamId, input.membershipId);
  if (member.status !== 'active')
    throw conflict('member_removed', 'That person has been removed from the team.');
  const role = await loadRole(tx, input.teamId, input.roleId);
  if (role.id === member.roleId) throw conflict('no_change', 'They already have that role.');
  assertRoleAssignable(member.roleKey, actor);
  assertRoleAssignable(role.key, actor);
  if (member.roleKey === 'program_admin') await assertNotLastAdmin(tx, input.teamId, member.membershipId);

  await tx`update sineobex.team_memberships set role_id = ${role.id} where id = ${member.membershipId}`;
  const oldValue = { roleId: member.roleId, roleKey: member.roleKey };
  const newValue = { roleId: role.id, roleKey: role.key };
  await tx`
    insert into sineobex.membership_changes (team_id, membership_id, kind, old_value, new_value, reason, changed_by)
    values (${input.teamId}, ${member.membershipId}, 'role', ${tx.json(oldValue)}, ${tx.json(newValue)},
            ${input.reason}, ${actor.userId})`;
  await audit({
    action: 'membership.role_changed',
    entity: 'membership',
    entityId: member.membershipId,
    details: { userId: member.userId, from: member.roleKey, to: role.key, reason: input.reason },
  });
  return getMember(tx, input.teamId, member.membershipId);
}

/**
 * Oct 19: "Credentials change on the same account. Moving up takes effect only once the fields
 * the new credential needs are filled in; a reason is required and the change is logged. Moving
 * down removes permissions at once. Signed notes keep the credential they were signed under."
 * (Notes store a snapshot of the signer's credential, so nothing here touches them.)
 */
export async function changeCredential(
  tx: Tx,
  audit: AuditFn,
  actor: Actor,
  input: {
    teamId: string;
    membershipId: string;
    credential: Credential;
    fields: Record<string, string | undefined>;
    reason: string;
  },
): Promise<MemberView & { direction: 'up' | 'down' | 'same' }> {
  const member = await loadMember(tx, input.teamId, input.membershipId);
  if (member.status !== 'active')
    throw conflict('member_removed', 'That person has been removed from the team.');
  assertRoleAssignable(member.roleKey, actor);
  const up = isUpgrade(member.credential, input.credential);
  const direction = member.credential === input.credential ? 'same' : up ? 'up' : 'down';
  // Moving down never waits for fields; moving up or correcting fields needs every required one.
  const fields =
    direction === 'down'
      ? (() => {
          const kept: Record<string, string> = {};
          for (const f of REQUIRED_FIELDS[input.credential]) {
            const v = input.fields[f]?.trim();
            if (v) kept[f] = v;
          }
          return kept;
        })()
      : validateCredential(input.credential, input.fields);

  await tx`
    update sineobex.team_memberships set credential = ${input.credential}, credential_fields = ${tx.json(fields)}
    where id = ${member.membershipId}`;
  const oldValue = { credential: member.credential, fields: member.credentialFields };
  const newValue = { credential: input.credential, fields };
  await tx`
    insert into sineobex.membership_changes (team_id, membership_id, kind, old_value, new_value, reason, changed_by)
    values (${input.teamId}, ${member.membershipId}, 'credential', ${tx.json(oldValue)}, ${tx.json(newValue)},
            ${input.reason}, ${actor.userId})`;
  await audit({
    action: 'membership.credential_changed',
    entity: 'membership',
    entityId: member.membershipId,
    details: {
      userId: member.userId,
      from: member.credential,
      to: input.credential,
      direction,
      reason: input.reason,
    },
  });
  return { ...(await getMember(tx, input.teamId, member.membershipId)), direction };
}

export interface RemovalResult {
  member: MemberView;
  /** Set when the person has no other active team, so their sign-in should be disabled. */
  disableIdentity: { issuer: string; subject: string } | null;
}

export async function removeMember(
  tx: Tx,
  audit: AuditFn,
  actor: Actor,
  input: { teamId: string; membershipId: string; reason: string },
): Promise<RemovalResult> {
  const member = await loadMember(tx, input.teamId, input.membershipId);
  if (member.status !== 'active') throw conflict('member_removed', 'That person has already been removed.');
  assertRoleAssignable(member.roleKey, actor);
  if (member.roleKey === 'program_admin') await assertNotLastAdmin(tx, input.teamId, member.membershipId);

  await tx`
    update sineobex.team_memberships
    set status = 'removed', removed_at = now(), removed_by = ${actor.userId}, removal_reason = ${input.reason}
    where id = ${member.membershipId}`;
  await tx`
    insert into sineobex.membership_changes (team_id, membership_id, kind, old_value, reason, changed_by)
    values (${input.teamId}, ${member.membershipId}, 'removed', ${tx.json({ roleKey: member.roleKey })},
            ${input.reason}, ${actor.userId})`;
  await audit({
    action: 'membership.removed',
    entity: 'membership',
    entityId: member.membershipId,
    details: { userId: member.userId, reason: input.reason },
  });

  const [others] = await tx<{ n: number; owner: boolean }[]>`
    select (select count(*)::int from sineobex.team_memberships
            where user_id = ${member.userId} and status = 'active' and id <> ${member.membershipId}) as n,
           exists (select 1 from sineobex.platform_owners where user_id = ${member.userId}) as owner`;
  let disableIdentity: RemovalResult['disableIdentity'] = null;
  if ((others?.n ?? 0) === 0 && !others?.owner) {
    await tx`update sineobex.users set status = 'disabled' where id = ${member.userId}`;
    disableIdentity = { issuer: member.authIssuer, subject: member.authSubject };
  }
  return { member: await getMember(tx, input.teamId, member.membershipId), disableIdentity };
}

export async function memberHistory(tx: Tx, teamId: string, membershipId: string) {
  await getMember(tx, teamId, membershipId);
  const rows = await tx<
    {
      id: string;
      kind: string;
      oldValue: unknown;
      newValue: unknown;
      reason: string | null;
      changedAt: Date;
      changedById: string;
      changedByName: string;
    }[]
  >`
    select c.id, c.kind, c.old_value, c.new_value, c.reason, c.changed_at,
           u.id as changed_by_id, u.display_name as changed_by_name
    from sineobex.membership_changes c join sineobex.users u on u.id = c.changed_by
    where c.team_id = ${teamId} and c.membership_id = ${membershipId}
    order by c.changed_at desc, c.id`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    oldValue: r.oldValue,
    newValue: r.newValue,
    reason: r.reason,
    changedAt: r.changedAt.toISOString(),
    changedBy: { userId: r.changedById, displayName: r.changedByName },
  }));
}
