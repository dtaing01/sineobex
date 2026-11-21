import { createRoute, z } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import { forbidden } from '../lib/errors.ts';
import {
  changeCredential,
  changeRole,
  getMember,
  inviteMember,
  listMembers,
  memberHistory,
  removeMember,
} from '../services/memberships.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { Credential, CredentialFields, errors, Reason, RoleSummary, Uuid } from './schemas.ts';

export const Member = z
  .object({
    membershipId: Uuid,
    userId: Uuid,
    email: z.string(),
    displayName: z.string(),
    status: z.enum(['active', 'removed']),
    role: RoleSummary,
    credential: Credential,
    credentialFields: CredentialFields,
    invitedAt: z.string().datetime(),
    removedAt: z.string().datetime().nullable(),
  })
  .openapi('Member');

const InviteMember = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    displayName: z.string().trim().min(1).max(120),
    roleId: Uuid,
    credential: Credential.default('none'),
    credentialFields: CredentialFields.default({}),
  })
  .openapi('InviteMember');

const ChangeRole = z.object({ roleId: Uuid, reason: Reason }).openapi('ChangeRole');
const ChangeCredential = z
  .object({ credential: Credential, credentialFields: CredentialFields.default({}), reason: Reason })
  .openapi('ChangeCredential');
const RemoveMember = z.object({ reason: Reason }).openapi('RemoveMember');

const MembershipChange = z
  .object({
    id: Uuid,
    kind: z.enum(['invited', 'role', 'credential', 'removed', 'restored']),
    oldValue: z.unknown(),
    newValue: z.unknown(),
    reason: z.string().nullable(),
    changedAt: z.string().datetime(),
    changedBy: z.object({ userId: Uuid, displayName: z.string() }),
  })
  .openapi('MembershipChange');

const membershipParam = z.object({ membershipId: Uuid });
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const listRoute = createRoute({
  method: 'get',
  path: '/v1/team/members',
  operationId: 'listMembers',
  tags: ['team'],
  summary: 'Everyone on the team, active and removed',
  security: [{ bearer: [] }],
  responses: { 200: { description: 'Members', ...json(z.array(Member)) }, ...errors(401, 403) },
});

const inviteRoute = createRoute({
  method: 'post',
  path: '/v1/team/members',
  operationId: 'inviteMember',
  tags: ['team'],
  summary: 'Invite a person with a role and credential (Program Admins can only be appointed by owners)',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(InviteMember) } },
  responses: { 201: { description: 'Invited', ...json(Member) }, ...errors(401, 403, 404, 409, 422) },
});

const getRoute = createRoute({
  method: 'get',
  path: '/v1/team/members/{membershipId}',
  operationId: 'getMember',
  tags: ['team'],
  security: [{ bearer: [] }],
  request: { params: membershipParam },
  responses: { 200: { description: 'Member', ...json(Member) }, ...errors(401, 403, 404) },
});

const roleRoute = createRoute({
  method: 'put',
  path: '/v1/team/members/{membershipId}/role',
  operationId: 'changeMemberRole',
  tags: ['team'],
  summary: 'Change a role, with a reason that is logged',
  security: [{ bearer: [] }],
  request: { params: membershipParam, body: { required: true, ...json(ChangeRole) } },
  responses: { 200: { description: 'Changed', ...json(Member) }, ...errors(401, 403, 404, 409, 422) },
});

const credentialRoute = createRoute({
  method: 'put',
  path: '/v1/team/members/{membershipId}/credential',
  operationId: 'changeMemberCredential',
  tags: ['team'],
  summary: "Change a credential. Moving up takes effect only with the new credential's fields filled in.",
  security: [{ bearer: [] }],
  request: { params: membershipParam, body: { required: true, ...json(ChangeCredential) } },
  responses: {
    200: { description: 'Changed', ...json(Member.extend({ direction: z.enum(['up', 'down', 'same']) })) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const removeRoute = createRoute({
  method: 'post',
  path: '/v1/team/members/{membershipId}/remove',
  operationId: 'removeMember',
  tags: ['team'],
  summary:
    "Remove a person. Their sessions stop working at once; their phone's data is handled at next contact.",
  security: [{ bearer: [] }],
  request: { params: membershipParam, body: { required: true, ...json(RemoveMember) } },
  responses: { 200: { description: 'Removed', ...json(Member) }, ...errors(401, 403, 404, 409, 422) },
});

const historyRoute = createRoute({
  method: 'get',
  path: '/v1/team/members/{membershipId}/history',
  operationId: 'getMemberHistory',
  tags: ['team'],
  summary: 'Every role, credential and status change for one membership, with reasons',
  security: [{ bearer: [] }],
  request: { params: membershipParam },
  responses: {
    200: { description: 'History', ...json(z.array(MembershipChange)) },
    ...errors(401, 403, 404),
  },
});

export function registerMemberRoutes(app: App, deps: Deps): void {
  app.openapi(listRoute, async (c) => {
    const scope = await teamScope(c, deps);
    // Logistics needs the roster to assign routes; admins need it to manage people.
    if (!scope.can('team.manage_users') && !scope.can('routes.manage')) {
      await scope.require('team.manage_users', c.req.routePath);
    }
    const members = await scope.tx((tx) => listMembers(tx, scope.team.teamId));
    return c.json(members, 200);
  });

  app.openapi(inviteRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'], recentAuth: true });
    const body = c.req.valid('json');
    const member = await inviteMember(
      deps,
      (fn) => scope.tx(fn),
      { userId: scope.principal.userId, isOwner: scope.principal.isOwner },
      {
        teamId: scope.team.teamId,
        email: body.email,
        displayName: body.displayName,
        roleId: body.roleId,
        credential: body.credential,
        credentialFields: body.credentialFields,
      },
    );
    return c.json(member, 201);
  });

  app.openapi(getRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'] });
    const { membershipId } = c.req.valid('param');
    return c.json(await scope.tx((tx) => getMember(tx, scope.team.teamId, membershipId)), 200);
  });

  app.openapi(roleRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'], recentAuth: true });
    const { membershipId } = c.req.valid('param');
    const body = c.req.valid('json');
    const actor = { userId: scope.principal.userId, isOwner: scope.principal.isOwner };
    const member = await scope.tx((tx, audit) =>
      changeRole(tx, audit, actor, {
        teamId: scope.team.teamId,
        membershipId,
        roleId: body.roleId,
        reason: body.reason,
      }),
    );
    return c.json(member, 200);
  });

  app.openapi(credentialRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'], recentAuth: true });
    const { membershipId } = c.req.valid('param');
    const body = c.req.valid('json');
    const actor = { userId: scope.principal.userId, isOwner: scope.principal.isOwner };
    const result = await scope.tx((tx, audit) =>
      changeCredential(tx, audit, actor, {
        teamId: scope.team.teamId,
        membershipId,
        credential: body.credential,
        fields: body.credentialFields,
        reason: body.reason,
      }),
    );
    return c.json(result, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'], recentAuth: true });
    const { membershipId } = c.req.valid('param');
    if (membershipId === scope.team.membershipId && !scope.principal.isOwner) {
      throw forbidden('Ask another Program Admin or an owner to remove you.', 'self_removal');
    }
    const body = c.req.valid('json');
    const actor = { userId: scope.principal.userId, isOwner: scope.principal.isOwner };
    const result = await scope.tx((tx, audit) =>
      removeMember(tx, audit, actor, { teamId: scope.team.teamId, membershipId, reason: body.reason }),
    );
    // After commit: block sign-in at the provider. The API already refuses the person's tokens,
    // because every request re-checks the membership, so a provider outage can't keep them in.
    if (result.disableIdentity) {
      try {
        await deps.identityAdmin.disable(result.disableIdentity);
      } catch {
        deps.log.warn('identity_disable_failed', {
          requestId: c.get('requestId'),
          userId: result.member.userId,
        });
      }
    }
    return c.json(result.member, 200);
  });

  app.openapi(historyRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'] });
    const { membershipId } = c.req.valid('param');
    return c.json((await scope.tx((tx) => memberHistory(tx, scope.team.teamId, membershipId))) as never, 200);
  });
}
