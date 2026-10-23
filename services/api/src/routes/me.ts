import { createRoute, z } from '@hono/zod-openapi';
import { REQUIRED_ACKNOWLEDGEMENTS } from '../auth/acknowledgements.ts';
import { mfaSatisfied, pendingAcknowledgements, userScope } from '../auth/context.ts';
import { isPermission, PERMISSIONS } from '../auth/permissions.ts';
import { invalid } from '../lib/errors.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { Credential, errors, Ok, PermissionKey, Uuid } from './schemas.ts';

const Acknowledgement = z
  .object({ kind: z.enum(['terms_of_use', 'confidentiality']), version: z.string() })
  .openapi('Acknowledgement');

const MyTeam = z
  .object({
    teamId: Uuid,
    teamName: z.string(),
    teamStatus: z.enum(['active', 'suspended']),
    roleKey: z.string(),
    roleName: z.string(),
    credential: Credential,
    permissions: z.array(PermissionKey),
  })
  .openapi('MyTeam');

const Me = z
  .object({
    user: z.object({ id: Uuid, email: z.string(), displayName: z.string() }),
    isOwner: z.boolean(),
    mfa: z.object({ required: z.boolean(), satisfied: z.boolean() }),
    pendingAcknowledgements: z.array(Acknowledgement),
    teams: z.array(MyTeam),
    idLinkBaseUrl: z.string().openapi({
      description:
        'Where Street Medicine ID cards point: the link is `{idLinkBaseUrl}/c#<token>`. Cached on the phone, ' +
        'so a card made offline carries the same URL the portal shows.',
    }),
  })
  .openapi('Me');

const PermissionInfo = z.object({ key: PermissionKey, description: z.string() }).openapi('PermissionInfo');

const meRoute = createRoute({
  method: 'get',
  path: '/v1/me',
  operationId: 'getMe',
  tags: ['me'],
  summary: 'The signed-in person, their teams, and what they still need to do before using one',
  security: [{ bearer: [] }],
  responses: {
    200: { description: 'You', content: { 'application/json': { schema: Me } } },
    ...errors(401, 403),
  },
});

const ackRoute = createRoute({
  method: 'post',
  path: '/v1/me/acknowledgements',
  operationId: 'acceptAcknowledgement',
  tags: ['me'],
  summary: 'Accept the Terms of Use or the confidentiality acknowledgement',
  security: [{ bearer: [] }],
  request: { body: { content: { 'application/json': { schema: Acknowledgement } }, required: true } },
  responses: {
    200: { description: 'Recorded', content: { 'application/json': { schema: Ok } } },
    ...errors(401, 403, 422),
  },
});

const permissionsRoute = createRoute({
  method: 'get',
  path: '/v1/permissions',
  operationId: 'listPermissions',
  tags: ['me'],
  summary: 'Every permission a role can hold, with a plain description',
  security: [{ bearer: [] }],
  responses: {
    200: { description: 'Catalog', content: { 'application/json': { schema: z.array(PermissionInfo) } } },
    ...errors(401),
  },
});

export function registerMeRoutes(app: App, deps: Deps): void {
  app.openapi(meRoute, async (c) => {
    const scope = await userScope(c, deps);
    const p = scope.principal;
    const result = await scope.tx(async (tx, audit) => {
      // First time this provider session reaches the API: record the sign-in.
      if (p.token.sessionId) {
        const inserted = await tx`
          insert into sineobex.sessions_seen (session_id, user_id) values (${p.token.sessionId}, ${p.userId})
          on conflict do nothing returning session_id`;
        if (inserted.length > 0) {
          await audit({ action: 'session.started', details: { aal: p.token.aal ?? 'unknown' } });
        }
      }
      return tx<
        {
          teamId: string;
          teamName: string;
          teamStatus: 'active' | 'suspended';
          roleKey: string;
          roleName: string;
          credential: z.infer<typeof Credential>;
          permissions: string[];
        }[]
      >`
        select t.id as team_id, t.name as team_name, t.status as team_status,
               r.key as role_key, r.name as role_name, m.credential, r.permissions
        from sineobex.team_memberships m
        join sineobex.teams t on t.id = m.team_id
        join sineobex.roles r on r.id = m.role_id
        where m.user_id = ${p.userId} and m.status = 'active'
        order by t.name`;
    });
    return c.json(
      {
        user: { id: p.userId, email: p.email, displayName: p.displayName },
        isOwner: p.isOwner,
        mfa: { required: deps.config.MFA_MODE === 'aal', satisfied: mfaSatisfied(deps, p) },
        pendingAcknowledgements: (await pendingAcknowledgements(deps, p)).map((a) => ({ ...a })),
        teams: result.map((t) => ({ ...t, permissions: t.permissions.filter(isPermission) })),
        idLinkBaseUrl: deps.config.ID_LINK_BASE_URL,
      },
      200,
    );
  });

  app.openapi(ackRoute, async (c) => {
    const body = c.req.valid('json');
    const known = REQUIRED_ACKNOWLEDGEMENTS.find((a) => a.kind === body.kind && a.version === body.version);
    if (!known) throw invalid('unknown_version', 'That is not the current version. Reload and try again.');
    const scope = await userScope(c, deps);
    await scope.tx(async (tx, audit) => {
      await tx`
        insert into sineobex.acknowledgements (user_id, kind, version) values (${scope.principal.userId}, ${body.kind}, ${body.version})
        on conflict do nothing`;
      await audit({ action: 'user.acknowledged', details: { kind: body.kind, version: body.version } });
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(permissionsRoute, async (c) => {
    await userScope(c, deps);
    return c.json(
      Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })),
      200,
    );
  });
}
