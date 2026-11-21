import { createRoute, z } from '@hono/zod-openapi';
import { teamScope, type TeamScope } from '../auth/context.ts';
import { push } from '../sync/push.ts';
import { readNeed } from '../sync/read-rules.ts';
import { fetchRecords, listNotices, markNoticeRead } from '../sync/review.ts';
import {
  FetchRecords,
  FetchRecordsResult,
  Notice,
  SyncPush,
  SyncPushResult,
  type AnyRecordEntityName,
} from '../sync/schemas.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors, Ok, Uuid } from './schemas.ts';

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const pushRoute = createRoute({
  method: 'post',
  path: '/v1/sync/push',
  operationId: 'syncPush',
  tags: ['sync'],
  summary:
    'Send change entries; get a receipt for each (accepted with hash, rejected with reason, or conflict)',
  description:
    'Each change commits in its own transaction with its audit entry. A change ID the server already has gets ' +
    'its stored receipt again, so retries never apply twice. Changes without a result were not processed.',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(SyncPush) } },
  responses: { 200: { description: 'Receipts', ...json(SyncPushResult) }, ...errors(401, 403, 409, 422) },
});

const recordsRoute = createRoute({
  method: 'post',
  path: '/v1/sync/records',
  operationId: 'fetchRecords',
  tags: ['sync'],
  summary: 'The server’s copy of records, with each field’s version, for records a phone holds open',
  description:
    'Each kind of record needs its read permission: encounters, notes and what hangs off a note (sign-offs, ' +
    'addenda, corrections) encounters.chart; patient records and referrals patients.view; problems and their ' +
    'notes patients.view with encounters.chart or billing.view_codes. What the reader may not see is reported ' +
    'missing, like a record the team doesn’t have: a sensitive problem the role can’t see, a note they may not ' +
    'read with its sign-offs, addenda and corrections, and a correction to an answer hidden from them. A note ' +
    'they may read lists only the answers they may see, each with its version; a hidden one leaves no key.',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(FetchRecords) } },
  responses: { 200: { description: 'Records', ...json(FetchRecordsResult) }, ...errors(401, 403, 422) },
});

const noticesRoute = createRoute({
  method: 'get',
  path: '/v1/team/notices',
  operationId: 'listNotices',
  tags: ['sync'],
  summary: 'Things the signed-in person should look at, without patient details',
  security: [{ bearer: [] }],
  responses: { 200: { description: 'Notices', ...json(z.array(Notice)) }, ...errors(401, 403) },
});

const readNoticeRoute = createRoute({
  method: 'post',
  path: '/v1/team/notices/{noticeId}/read',
  operationId: 'markNoticeRead',
  tags: ['sync'],
  security: [{ bearer: [] }],
  request: { params: z.object({ noticeId: Uuid }) },
  responses: { 200: { description: 'Marked read', ...json(Ok) }, ...errors(401, 403, 404) },
});

/**
 * Who may read each kind of record through sync (phase 3 design 3.6, 4.1): refused and logged
 * like any route's permission, for the whole request. The sync read feeds editing, so a visit's
 * records need encounters.chart; a sign-off, an addendum and a correction are read by whoever may
 * read their note (phase 4 lifecycle 6.1, 6.4 rule 7), which fetchRecords then checks note by note.
 * A referral is a patient's record, read with patients.view. The rule is read-rules.ts readNeed, the
 * one copy the review queue and every value sent back to a phone are held to as well (VA-1).
 */
async function requireRead(scope: TeamScope, entity: AnyRecordEntityName) {
  const route = '/v1/sync/records';
  const need = readNeed(entity);
  return 'rule' in need ? scope.requireRule(need.rule, route) : scope.require(need.permission, route);
}

export function registerSyncRoutes(app: App, deps: Deps) {
  app.openapi(pushRoute, async (c) => {
    const scope = await teamScope(c, deps);
    return c.json(await push(scope, c.req.valid('json')), 200);
  });

  app.openapi(recordsRoute, async (c) => {
    const scope = await teamScope(c, deps);
    const refs = c.req.valid('json').records;
    for (const entity of new Set(refs.map((r) => r.entity))) await requireRead(scope, entity);
    return c.json(await fetchRecords(scope, refs), 200);
  });

  app.openapi(noticesRoute, async (c) => {
    const scope = await teamScope(c, deps);
    return c.json(await listNotices(scope), 200);
  });

  app.openapi(readNoticeRoute, async (c) => {
    const scope = await teamScope(c, deps);
    return c.json(await markNoticeRead(scope, c.req.valid('param').noticeId), 200);
  });
}
