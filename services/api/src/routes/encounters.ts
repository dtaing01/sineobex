import type { z } from '@hono/zod-openapi';
import { createRoute } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import { readVisit } from '../encounters/read.ts';
import { EncounterParam, VisitRead } from '../patients/schemas.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors } from './schemas.ts';

/**
 * Encounters online (phase 4 lifecycle 5): what works only with a connection. Each route checks its
 * existing key first (6.1), runs in one transaction and writes its audit events in it; a refusal is
 * logged as access.denied. Paths carry UUIDs only (10.2).
 */

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const visitRoute = createRoute({
  method: 'get',
  path: '/v1/encounters/{encounterId}',
  operationId: 'getEncounter',
  tags: ['encounters'],
  summary: 'A visit as the reader may see it: its notes laid out for reading, and what hangs off them',
  description:
    'Built on the sync read’s rules (lifecycle 5.1, 6.4): what the reader may not see is absent, never blanked. ' +
    'Every record returned is logged.',
  security: [{ bearer: [] }],
  request: { params: EncounterParam },
  responses: { 200: { description: 'The visit', ...json(VisitRead) }, ...errors(401, 403, 404, 422) },
});

export function registerEncounterRoutes(app: App, deps: Deps) {
  app.openapi(visitRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.view'] });
    return c.json(await readVisit(scope, c.req.valid('param').encounterId), 200);
  });
}
