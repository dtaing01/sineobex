import { createRoute, z } from '@hono/zod-openapi';
import { ownerScope } from '../auth/context.ts';
import { CHW_PRESET } from '../auth/permissions.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { inviteMember, removeMember } from '../services/memberships.ts';
import type { App } from '../app.ts';
import type { Tx } from '../db/database.ts';
import type { Deps } from '../types.ts';
import { Member } from './members.ts';
import { Credential, CredentialFields, errors, Reason, Uuid } from './schemas.ts';

const OwnerTeam = z
  .object({
    id: Uuid,
    name: z.string(),
    status: z.enum(['active', 'suspended']),
    createdAt: z.string().datetime(),
    activeMembers: z.number().int(),
    programAdmins: z.array(z.object({ membershipId: Uuid, displayName: z.string(), email: z.string() })),
  })
  .openapi('OwnerTeam');

const CreateTeam = z.object({ name: z.string().trim().min(1).max(120) }).openapi('CreateTeam');
const AppointAdmin = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    displayName: z.string().trim().min(1).max(120),
    credential: Credential.default('none'),
    credentialFields: CredentialFields.default({}),
  })
  .openapi('AppointAdmin');
const TeamStatusChange = z
  .object({ status: z.enum(['active', 'suspended']), reason: Reason })
  .openapi('TeamStatusChange');

const teamParam = z.object({ teamId: Uuid });
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const listTeamsRoute = createRoute({
  method: 'get',
  path: '/v1/owner/teams',
  operationId: 'ownerListTeams',
  tags: ['owner'],
  summary: 'Every team, with its Program Admins (platform owners only)',
  security: [{ bearer: [] }],
  responses: { 200: { description: 'Teams', ...json(z.array(OwnerTeam)) }, ...errors(401, 403) },
});

const createTeamRoute = createRoute({
  method: 'post',
  path: '/v1/owner/teams',
  operationId: 'ownerCreateTeam',
  tags: ['owner'],
  summary: 'Create a team. A community health worker preset role is added to it.',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(CreateTeam) } },
  responses: { 201: { description: 'Created', ...json(OwnerTeam) }, ...errors(401, 403, 422) },
});

const appointRoute = createRoute({
  method: 'post',
  path: '/v1/owner/teams/{teamId}/program-admins',
  operationId: 'ownerAppointProgramAdmin',
  tags: ['owner'],
  summary: "Appoint a team's Program Admin",
  security: [{ bearer: [] }],
  request: { params: teamParam, body: { required: true, ...json(AppointAdmin) } },
  responses: { 201: { description: 'Appointed', ...json(Member) }, ...errors(401, 403, 404, 409, 422) },
});

const removeAdminRoute = createRoute({
  method: 'post',
  path: '/v1/owner/teams/{teamId}/members/{membershipId}/remove',
  operationId: 'ownerRemoveMember',
  tags: ['owner'],
  summary: 'Remove anyone from a team, including a Program Admin',
  security: [{ bearer: [] }],
  request: {
    params: teamParam.extend({ membershipId: Uuid }),
    body: { required: true, ...json(z.object({ reason: Reason })) },
  },
  responses: { 200: { description: 'Removed', ...json(Member) }, ...errors(401, 403, 404, 409, 422) },
});

const statusRoute = createRoute({
  method: 'post',
  path: '/v1/owner/teams/{teamId}/status',
  operationId: 'ownerSetTeamStatus',
  tags: ['owner'],
  summary: 'Suspend or reinstate a team. A suspended team cannot reach any data.',
  security: [{ bearer: [] }],
  request: { params: teamParam, body: { required: true, ...json(TeamStatusChange) } },
  responses: { 200: { description: 'Updated', ...json(OwnerTeam) }, ...errors(401, 403, 404, 409, 422) },
});

type TeamRow = {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: Date;
  activeMembers: number;
};

export function registerOwnerRoutes(app: App, deps: Deps): void {
  async function teamsView(tx: Tx, teamId?: string) {
    const teams = await tx<TeamRow[]>`
      select t.id, t.name, t.status, t.created_at,
             (select count(*)::int from sineobex.team_memberships m where m.team_id = t.id and m.status = 'active') as active_members
      from sineobex.teams t
      ${teamId ? tx`where t.id = ${teamId}` : tx``}
      order by t.name`;
    const admins = await tx<{ teamId: string; membershipId: string; displayName: string; email: string }[]>`
      select m.team_id, m.id as membership_id, u.display_name, u.email
      from sineobex.team_memberships m join sineobex.users u on u.id = m.user_id join sineobex.roles r on r.id = m.role_id
      where r.key = 'program_admin' and m.status = 'active'`;
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      activeMembers: t.activeMembers,
      programAdmins: admins.filter((a) => a.teamId === t.id).map(({ teamId: _, ...a }) => a),
    }));
  }

  app.openapi(listTeamsRoute, async (c) => {
    const scope = await ownerScope(c, deps);
    return c.json(await scope.tx((tx) => teamsView(tx)), 200);
  });

  app.openapi(createTeamRoute, async (c) => {
    const scope = await ownerScope(c, deps);
    const { name } = c.req.valid('json');
    const team = await scope.tx(async (tx, audit) => {
      const [row] = await tx<{ id: string }[]>`
        insert into sineobex.teams (name, created_by) values (${name}, ${scope.principal.userId}) returning id`;
      const teamId = row!.id;
      await tx`
        insert into sineobex.roles (team_id, key, name, description, permissions, created_by)
        values (${teamId}, ${CHW_PRESET.key}, ${CHW_PRESET.name}, ${CHW_PRESET.description},
                ${CHW_PRESET.permissions}, ${scope.principal.userId})`;
      await audit(teamId, { action: 'team.created', entity: 'team', entityId: teamId, details: { name } });
      await audit(null, { action: 'team.created', entity: 'team', entityId: teamId, details: { name } });
      return (await teamsView(tx, teamId))[0]!;
    });
    return c.json(team, 201);
  });

  app.openapi(appointRoute, async (c) => {
    const scope = await ownerScope(c, deps);
    const { teamId } = c.req.valid('param');
    const body = c.req.valid('json');
    const roleId = await scope.tx(async (tx) => {
      const t = await tx`select id from sineobex.teams where id = ${teamId}`;
      if (t.length === 0) throw notFound('team');
      const [r] = await tx<
        { id: string }[]
      >`select id from sineobex.roles where key = 'program_admin' and team_id is null`;
      return r!.id;
    });
    const member = await inviteMember(
      deps,
      (fn) => scope.tx((tx, audit) => fn(tx, (e) => audit(teamId, e))),
      { userId: scope.principal.userId, isOwner: true },
      {
        teamId,
        email: body.email,
        displayName: body.displayName,
        roleId,
        credential: body.credential,
        credentialFields: body.credentialFields,
      },
    );
    return c.json(member, 201);
  });

  app.openapi(removeAdminRoute, async (c) => {
    const scope = await ownerScope(c, deps);
    const { teamId, membershipId } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const result = await scope.tx((tx, audit) =>
      removeMember(
        tx,
        (e) => audit(teamId, e),
        { userId: scope.principal.userId, isOwner: true },
        { teamId, membershipId, reason },
      ),
    );
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

  app.openapi(statusRoute, async (c) => {
    const scope = await ownerScope(c, deps);
    const { teamId } = c.req.valid('param');
    const body = c.req.valid('json');
    const team = await scope.tx(async (tx, audit) => {
      const rows = await tx<
        { status: string }[]
      >`select status from sineobex.teams where id = ${teamId} for update`;
      if (!rows[0]) throw notFound('team');
      if (rows[0].status === body.status) throw conflict('no_change', `The team is already ${body.status}.`);
      await tx`update sineobex.teams set status = ${body.status} where id = ${teamId}`;
      await audit(teamId, {
        action: body.status === 'suspended' ? 'team.suspended' : 'team.reinstated',
        entity: 'team',
        entityId: teamId,
        details: { reason: body.reason },
      });
      return (await teamsView(tx, teamId))[0]!;
    });
    return c.json(team, 200);
  });
}
