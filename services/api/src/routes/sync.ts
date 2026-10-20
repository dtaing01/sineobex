import { createRoute, z } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import { push } from '../sync/push.ts';
import { fetchRecords, listNotices, markNoticeRead } from '../sync/review.ts';
import { FetchRecords, FetchRecordsResult, Notice, SyncPush, SyncPushResult } from '../sync/schemas.ts';
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
  summary: 'The server’s copy of records, with each field’s version, for drafts a phone holds open',
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

export function registerSyncRoutes(app: App, deps: Deps) {
  app.openapi(pushRoute, async (c) => {
    const scope = await teamScope(c, deps);
    return c.json(await push(scope, c.req.valid('json')), 200);
  });

  app.openapi(recordsRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['encounters.chart'] });
    return c.json(await fetchRecords(scope, c.req.valid('json').records), 200);
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
