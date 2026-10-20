import { createRoute, z } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import { isPermission } from '../auth/permissions.ts';
import { conflict, notFound } from '../lib/errors.ts';
import type { App } from '../app.ts';
import type { Tx } from '../db/database.ts';
import type { Deps } from '../types.ts';
import { errors, PermissionKey, Uuid } from './schemas.ts';

export const Role = z
  .object({
    id: Uuid,
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    permissions: z.array(PermissionKey),
    isStandard: z.boolean(),
    archived: z.boolean(),
    memberCount: z.number().int(),
  })
  .openapi('Role');

// Custom roles combine existing permissions only (Oct 12): the enum rejects anything else.
const RoleInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).optional(),
    permissions: z.array(PermissionKey).min(1).max(40),
  })
  .openapi('RoleInput');

const roleParam = z.object({ roleId: Uuid });
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

async function listRoles(tx: Tx, teamId: string) {
  const rows = await tx<
    {
      id: string;
      key: string;
      name: string;
      description: string | null;
      permissions: string[];
      isStandard: boolean;
      archivedAt: Date | null;
      memberCount: number;
    }[]
  >`
    select r.id, r.key, r.name, r.description, r.permissions, r.is_standard, r.archived_at,
           (select count(*)::int from sineobex.team_memberships m
            where m.role_id = r.id and m.team_id = ${teamId} and m.status = 'active') as member_count
    from sineobex.roles r
    where r.team_id is null or r.team_id = ${teamId}
    order by r.is_standard desc, r.name`;
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    permissions: r.permissions.filter(isPermission),
    isStandard: r.isStandard,
    archived: r.archivedAt !== null,
    memberCount: r.memberCount,
  }));
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  return `custom_${base || 'role'}_${crypto.randomUUID().slice(0, 6)}`;
}

const listRoute = createRoute({
  method: 'get',
  path: '/v1/team/roles',
  operationId: 'listRoles',
  tags: ['team'],
  summary: "Standard roles and this team's custom roles",
  security: [{ bearer: [] }],
  responses: { 200: { description: 'Roles', ...json(z.array(Role)) }, ...errors(401, 403) },
});

const createRoleRoute = createRoute({
  method: 'post',
  path: '/v1/team/roles',
  operationId: 'createRole',
  tags: ['team'],
  summary: 'Create a custom role from existing permissions',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(RoleInput) } },
  responses: { 201: { description: 'Created', ...json(Role) }, ...errors(401, 403, 422) },
});

const updateRoleRoute = createRoute({
  method: 'put',
  path: '/v1/team/roles/{roleId}',
  operationId: 'updateRole',
  tags: ['team'],
  summary: 'Change a custom role. Standard roles cannot be changed.',
  security: [{ bearer: [] }],
  request: { params: roleParam, body: { required: true, ...json(RoleInput) } },
  responses: { 200: { description: 'Updated', ...json(Role) }, ...errors(401, 403, 404, 409, 422) },
});

const archiveRoleRoute = createRoute({
  method: 'post',
  path: '/v1/team/roles/{roleId}/archive',
  operationId: 'archiveRole',
  tags: ['team'],
  summary: 'Archive a custom role nobody holds',
  security: [{ bearer: [] }],
  request: { params: roleParam },
  responses: { 200: { description: 'Archived', ...json(Role) }, ...errors(401, 403, 404, 409) },
});

async function loadCustomRole(tx: Tx, teamId: string, roleId: string) {
  const rows = await tx<
    { id: string; teamId: string | null; archivedAt: Date | null; permissions: string[] }[]
  >`
    select id, team_id, archived_at, permissions from sineobex.roles where id = ${roleId} and (team_id = ${teamId} or team_id is null)
    for update`;
  const role = rows[0];
  if (!role) throw notFound('role');
  if (role.teamId === null)
    throw conflict('standard_role', 'Standard roles cannot be changed. Create a custom role instead.');
  return role;
}

export function registerRoleRoutes(app: App, deps: Deps): void {
  app.openapi(listRoute, async (c) => {
    const scope = await teamScope(c, deps);
    if (!scope.can('team.manage_users') && !scope.can('routes.manage')) {
      await scope.require('team.manage_users', c.req.routePath);
    }
    return c.json(await scope.tx((tx) => listRoles(tx, scope.team.teamId)), 200);
  });

  app.openapi(createRoleRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'], recentAuth: true });
    const body = c.req.valid('json');
    const role = await scope.tx(async (tx, audit) => {
      const [row] = await tx<{ id: string }[]>`
        insert into sineobex.roles (team_id, key, name, description, permissions, created_by)
        values (${scope.team.teamId}, ${slug(body.name)}, ${body.name}, ${body.description ?? null},
                ${[...new Set(body.permissions)]}, ${scope.principal.userId})
        returning id`;
      await audit({
        action: 'role.created',
        entity: 'role',
        entityId: row!.id,
        details: { name: body.name, permissions: body.permissions },
      });
      return (await listRoles(tx, scope.team.teamId)).find((r) => r.id === row!.id)!;
    });
    return c.json(role, 201);
  });

  app.openapi(updateRoleRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'], recentAuth: true });
    const { roleId } = c.req.valid('param');
    const body = c.req.valid('json');
    const role = await scope.tx(async (tx, audit) => {
      const existing = await loadCustomRole(tx, scope.team.teamId, roleId);
      await tx`
        update sineobex.roles set name = ${body.name}, description = ${body.description ?? null},
               permissions = ${[...new Set(body.permissions)]}
        where id = ${roleId}`;
      await audit({
        action: 'role.updated',
        entity: 'role',
        entityId: roleId,
        details: { name: body.name, from: existing.permissions, to: body.permissions },
      });
      return (await listRoles(tx, scope.team.teamId)).find((r) => r.id === roleId)!;
    });
    return c.json(role, 200);
  });

  app.openapi(archiveRoleRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'], recentAuth: true });
    const { roleId } = c.req.valid('param');
    const role = await scope.tx(async (tx, audit) => {
      const existing = await loadCustomRole(tx, scope.team.teamId, roleId);
      if (existing.archivedAt) throw conflict('already_archived', 'That role is already archived.');
      const [held] = await tx<{ n: number }[]>`
        select count(*)::int as n from sineobex.team_memberships where role_id = ${roleId} and status = 'active'`;
      if ((held?.n ?? 0) > 0)
        throw conflict('role_in_use', 'Move everyone off this role before archiving it.');
      await tx`update sineobex.roles set archived_at = now() where id = ${roleId}`;
      await audit({ action: 'role.archived', entity: 'role', entityId: roleId });
      return (await listRoles(tx, scope.team.teamId)).find((r) => r.id === roleId)!;
    });
    return c.json(role, 200);
  });
}
