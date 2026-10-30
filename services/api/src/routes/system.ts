import { createRoute, z } from '@hono/zod-openapi';
import type { App } from '../app.ts';
import { DEMO_ENVS } from '../config.ts';
import type { Deps } from '../types.ts';

const Health = z
  .object({
    status: z.literal('ok'),
    environment: z.enum(['local', 'test', 'preview', 'pilot', 'production']),
    /** True when this deployment may hold only made-up patients. The apps show the Demo data only banner. */
    demo: z.boolean(),
    release: z.string(),
  })
  .openapi('Health');

const ServerTime = z
  .object({
    serverTime: z.string().datetime(),
    epochMs: z.number().int(),
  })
  .openapi('ServerTime');

const healthRoute = createRoute({
  method: 'get',
  path: '/v1/health',
  operationId: 'getHealth',
  tags: ['system'],
  summary: 'Liveness, database reachability and whether this is a demo deployment',
  responses: {
    200: { content: { 'application/json': { schema: Health } }, description: 'Healthy' },
  },
});

const timeRoute = createRoute({
  method: 'get',
  path: '/v1/time',
  operationId: 'getServerTime',
  tags: ['system'],
  summary: 'Server time, used by the phone to measure its clock offset (module 9)',
  responses: {
    200: { content: { 'application/json': { schema: ServerTime } }, description: 'Current server time' },
  },
});

export function registerSystemRoutes(app: App, deps: Deps): void {
  app.openapi(healthRoute, async (c) => {
    await deps.db.ping();
    const env = deps.config.APP_ENV;
    return c.json(
      {
        status: 'ok' as const,
        environment: env,
        demo: DEMO_ENVS.includes(env),
        release: deps.config.RELEASE,
      },
      200,
    );
  });

  app.openapi(timeRoute, (c) => {
    const now = deps.now();
    return c.json({ serverTime: now.toISOString(), epochMs: now.getTime() }, 200);
  });
}
