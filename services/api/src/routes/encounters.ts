import type { z } from '@hono/zod-openapi';
import { createRoute } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import { attestVisit } from '../encounters/attest.ts';
import { cosignVisit, NoteActInput, NoteActResult } from '../encounters/cosign.ts';
import { readVisit } from '../encounters/read.ts';
import { earlierVisits } from '../encounters/timeline.ts';
import { EncounterParam, PatientParam, TimelinePage, TimelineQuery, VisitRead } from '../patients/schemas.ts';
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

const timelineRoute = createRoute({
  method: 'get',
  path: '/v1/patients/{patientId}/timeline',
  operationId: 'getPatientTimeline',
  tags: ['encounters'],
  summary: 'The patient’s earlier visits, 50 at a time, after the last one shown',
  description:
    'The chart carries the first 50 (lifecycle 5.2). A merged ID answers its group. Each visit lists the notes the ' +
    'reader may see, by type and state only.',
  security: [{ bearer: [] }],
  request: { params: PatientParam, query: TimelineQuery },
  responses: { 200: { description: 'Earlier visits', ...json(TimelinePage) }, ...errors(401, 403, 404, 422) },
});

const cosignRoute = createRoute({
  method: 'post',
  path: '/v1/encounters/{encounterId}/cosign',
  operationId: 'cosignEncounter',
  tags: ['encounters'],
  summary: 'Co-sign the visit’s notes that wait for a co-signer, all or nothing',
  description:
    'Lifecycle 5.3. The list holds every Medical note of the visit that waits for a co-signer and that the caller ' +
    'may act on, each with the contentHash of the visit read. A refusal names its notes in error.details.noteIds: ' +
    '403 is_author, cannot_sign or cannot_see_all (logged); 409 not_waiting or content_changed, and the screen ' +
    'loads the visit again.',
  security: [{ bearer: [] }],
  request: { params: EncounterParam, body: { required: true, ...json(NoteActInput) } },
  responses: {
    200: { description: 'Each note’s state now', ...json(NoteActResult) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const attestRoute = createRoute({
  method: 'post',
  path: '/v1/encounters/{encounterId}/attest',
  operationId: 'attestEncounter',
  tags: ['encounters'],
  summary: 'Attest the visit’s signed notes that wait for attestation, all or nothing',
  description:
    'Lifecycle 5.4. The same body as a co-sign: every note of the visit that waits for attestation and that the ' +
    'caller may act on, each with the contentHash of the visit read. Each attestation names the note’s current ' +
    'signature. A refusal names its notes in error.details.noteIds: 403 is_author, is_signer, cannot_attest or ' +
    'cannot_see_all (logged); 409 not_waiting or content_changed.',
  security: [{ bearer: [] }],
  request: { params: EncounterParam, body: { required: true, ...json(NoteActInput) } },
  responses: {
    200: { description: 'Each note’s state now', ...json(NoteActResult) },
    ...errors(401, 403, 404, 409, 422),
  },
});

export function registerEncounterRoutes(app: App, deps: Deps) {
  app.openapi(visitRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.view'] });
    return c.json(await readVisit(scope, c.req.valid('param').encounterId), 200);
  });

  app.openapi(timelineRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.view'] });
    const { patientId } = c.req.valid('param');
    return c.json(await earlierVisits(scope, patientId, c.req.valid('query').before), 200);
  });

  app.openapi(cosignRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['encounters.chart'] });
    const { encounterId } = c.req.valid('param');
    return c.json(await cosignVisit(scope, encounterId, c.req.valid('json'), c.req.routePath), 200);
  });

  app.openapi(attestRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['encounters.chart'] });
    const { encounterId } = c.req.valid('param');
    return c.json(await attestVisit(scope, encounterId, c.req.valid('json'), c.req.routePath), 200);
  });
}
