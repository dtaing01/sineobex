import { createRoute, z } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import { AssignInput, assignNote, NoteAssigned } from '../encounters/assign.ts';
import { attestVisit } from '../encounters/attest.ts';
import {
  incompleteNotes,
  IncompleteNotes,
  IncompleteQuery,
  notesToFinish,
  NotesToFinish,
} from '../encounters/incomplete.ts';
import { cosignVisit, NoteActInput, NoteActResult } from '../encounters/cosign.ts';
import { homeCounts, HomeCounts } from '../encounters/counts.ts';
import { exportHandoff, HANDOFF_FILE_NAME } from '../encounters/handoff.ts';
import { readQueue, SignatureQueue, type QueueName } from '../encounters/queues.ts';
import { readVisit } from '../encounters/read.ts';
import { earlierVisits } from '../encounters/timeline.ts';
import { EncounterParam, PatientParam, TimelinePage, TimelineQuery, VisitRead } from '../patients/schemas.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors, Uuid } from './schemas.ts';

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
    'loads the visit again. A refusal about the caller is logged even when a 409 is answered.',
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
    'cannot_see_all (logged); 409 not_waiting or content_changed. A refusal about the caller is logged even when ' +
    'a 409 is answered.',
  security: [{ bearer: [] }],
  request: { params: EncounterParam, body: { required: true, ...json(NoteActInput) } },
  responses: {
    200: { description: 'Each note’s state now', ...json(NoteActResult) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const queueRoute = (which: QueueName, path: string, operationId: string, act: string, credential: string) =>
  createRoute({
    method: 'get',
    path,
    operationId,
    tags: ['encounters'],
    summary: `The team’s visits with notes that wait for ${act}, oldest first`,
    description:
      `Lifecycle 5.4. Needs encounters.chart and a credential that ${credential}; else 403 ` +
      `${which === 'cosign' ? 'cannot_sign' : 'cannot_attest'}, logged. One row per visit with its waiting notes, ` +
      'each with canAct false when the caller may not act on it (an answer they may not see, or their own note). ' +
      'A note the caller may not read is absent. Logged with the patients shown.',
    security: [{ bearer: [] }],
    responses: { 200: { description: 'The queue', ...json(SignatureQueue) }, ...errors(401, 403) },
  });

const cosignQueueRoute = queueRoute(
  'cosign',
  '/v1/team/cosign-queue',
  'getCosignQueue',
  'a co-signature',
  'signs',
);
const attestationQueueRoute = queueRoute(
  'attestation',
  '/v1/team/attestation-queue',
  'getAttestationQueue',
  'attestation',
  'attests',
);

const NoteParam = z.object({ noteId: Uuid });

const assignRoute = createRoute({
  method: 'post',
  path: '/v1/notes/{noteId}/assign',
  operationId: 'assignNote',
  tags: ['encounters'],
  summary: 'Put another clinician in the place of a note’s author who has left the team',
  description:
    'Lifecycle 3.8, 5.5. Needs team.manage_users and a recent sign-in. 409 author_active while whoever acts as the ' +
    'author is an active member; 422 assignee_not_member, assignee_cannot_chart, credential_too_low (below the ' +
    'rank the note was signed under, or for an unsigned note its author’s last credential) or cannot_see_all ' +
    '(the note holds an answer the assignee’s role cannot see). The reason is stored, not logged.',
  security: [{ bearer: [] }],
  request: { params: NoteParam, body: { required: true, ...json(AssignInput) } },
  responses: {
    200: { description: 'The assignment', ...json(NoteAssigned) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const notesToFinishRoute = createRoute({
  method: 'get',
  path: '/v1/me/notes-to-finish',
  operationId: 'getNotesToFinish',
  tags: ['encounters'],
  summary: 'The drafts the caller acts as the author of, with whether each is overdue',
  description:
    'Lifecycle 3.9, 5.6. Needs encounters.chart. The server’s drafts only; the phone merges the ones it holds. ' +
    'Overdue is worked out when read: more than 24 hours since the visit started, or since the server received it ' +
    'when its start was not verified. An empty draft is not listed. Logged with the patients shown.',
  security: [{ bearer: [] }],
  responses: { 200: { description: 'The drafts', ...json(NotesToFinish) }, ...errors(401, 403) },
});

const incompleteNotesRoute = createRoute({
  method: 'get',
  path: '/v1/team/incomplete-notes',
  operationId: 'getIncompleteNotes',
  tags: ['encounters'],
  summary:
    'Every draft of the team, with its author, whether they are still a member, and whether it is overdue',
  description:
    'Lifecycle 3.9, 5.6. Needs team.manage_users. `author` (a user ID) keeps the drafts that person acts as the ' +
    'author of. A note the caller may not read and an empty draft are not listed. Logged with the patients shown.',
  security: [{ bearer: [] }],
  request: { query: IncompleteQuery },
  responses: { 200: { description: 'The drafts', ...json(IncompleteNotes) }, ...errors(401, 403, 422) },
});

const countsRoute = createRoute({
  method: 'get',
  path: '/v1/me/counts',
  operationId: 'getHomeCounts',
  tags: ['encounters'],
  summary: 'The numbers Home shows: notes to finish, the queues, the team’s incomplete notes',
  description:
    'Lifecycle 5.6, 9.9. Any member may ask. Each number is the length of the list it stands for, and a number ' +
    'for a list the caller may not open is absent. Names no patient, so it logs none.',
  security: [{ bearer: [] }],
  responses: { 200: { description: 'The counts', ...json(HomeCounts) }, ...errors(401, 403) },
});

const handoffRoute = createRoute({
  method: 'get',
  path: '/v1/encounters/{encounterId}/ems-handoff',
  operationId: 'getEmsHandoff',
  tags: ['encounters'],
  summary: 'The visit’s EMS handoff as a PDF, stamped with who exported it and when',
  description:
    'Lifecycle 5.7. Needs patients.view and a recent sign-in (else 403 reauth_required), and the reader must be ' +
    'able to read the visit’s Red flags note (else 403 cannot_see_red_flags, logged). Built from the forms ' +
    'part’s handoffLines over what the reader may see, with no treatment record, sensitive exam or sensitive ' +
    'diagnosis for any reader. 404 no_handoff when EMS was not activated. Never cached; the file name holds no ' +
    'patient details. Logged as ems_handoff.exported.',
  security: [{ bearer: [] }],
  request: { params: EncounterParam },
  responses: {
    200: {
      description: 'The handoff, as a PDF to save or print',
      content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } },
    },
    ...errors(401, 403, 404, 422),
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

  app.openapi(cosignQueueRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['encounters.chart'] });
    return c.json(await readQueue(scope, 'cosign', c.req.routePath), 200);
  });

  app.openapi(attestationQueueRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['encounters.chart'] });
    return c.json(await readQueue(scope, 'attestation', c.req.routePath), 200);
  });

  app.openapi(assignRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'], recentAuth: true });
    return c.json(await assignNote(scope, c.req.valid('param').noteId, c.req.valid('json')), 200);
  });

  app.openapi(notesToFinishRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['encounters.chart'] });
    return c.json(await notesToFinish(scope), 200);
  });

  app.openapi(incompleteNotesRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.manage_users'] });
    return c.json(await incompleteNotes(scope, c.req.valid('query').author), 200);
  });

  app.openapi(countsRoute, async (c) => {
    const scope = await teamScope(c, deps);
    return c.json(await homeCounts(scope), 200);
  });

  app.openapi(handoffRoute, async (c) => {
    // A file leaves our control: a fresh sign-in, as for every export (PRD main 602).
    const scope = await teamScope(c, deps, { permissions: ['patients.view'], recentAuth: true });
    const pdf = await exportHandoff(scope, c.req.valid('param').encounterId, c.req.routePath);
    return c.body(pdf, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${HANDOFF_FILE_NAME}"`,
      'Cache-Control': 'no-store',
    });
  });
}
