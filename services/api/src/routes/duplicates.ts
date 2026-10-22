import type { z } from '@hono/zod-openapi';
import { createRoute } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import { decideDuplicate, flagDuplicate, getDuplicatePair, listDuplicates } from '../patients/duplicates.ts';
import { listMerges, undoMerge } from '../patients/merges.ts';
import {
  DecideDuplicate,
  DuplicateDecisionResult,
  DuplicatePage,
  DuplicatePairDetail,
  DuplicatePairSummary,
  DuplicateQuery,
  FlagDuplicate,
  MergePage,
  MergeParam,
  PageQuery,
  PairParam,
  UndoMerge,
  UndoMergeResult,
} from '../patients/schemas.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors } from './schemas.ts';

/**
 * The duplicate merge queue and merges (phase 3 design 3.4, section 8). A person decides every
 * pair, with a comment and a recent sign-in; nothing is merged automatically and nothing on a phone
 * can merge. Undoing a merge is an identity correction (patients.correct_identity, D37).
 */

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const listRoute = createRoute({
  method: 'get',
  path: '/v1/team/duplicates',
  operationId: 'listDuplicates',
  tags: ['duplicates'],
  summary: 'Pairs of charts that may be the same person, oldest flagged first',
  security: [{ bearer: [] }],
  request: { query: DuplicateQuery },
  responses: { 200: { description: 'A page of pairs', ...json(DuplicatePage) }, ...errors(401, 403, 422) },
});

const pairRoute = createRoute({
  method: 'get',
  path: '/v1/team/duplicates/{pairId}',
  operationId: 'getDuplicatePair',
  tags: ['duplicates'],
  summary: 'Both charts of a pair side by side, with what matched and earlier decisions',
  security: [{ bearer: [] }],
  request: { params: PairParam },
  responses: {
    200: { description: 'The pair', ...json(DuplicatePairDetail) },
    ...errors(401, 403, 404, 422),
  },
});

const decideRoute = createRoute({
  method: 'post',
  path: '/v1/team/duplicates/{pairId}/decision',
  operationId: 'decideDuplicate',
  tags: ['duplicates'],
  summary: 'Merge, keep separate or not sure, with a comment',
  description:
    'Carries the versions the reviewer saw: 409 pair_changed {versions} when either chart changed or was ' +
    'merged since; 409 already_decided for a decided pair, unless not sure.',
  security: [{ bearer: [] }],
  request: { params: PairParam, body: { required: true, ...json(DecideDuplicate) } },
  responses: {
    200: { description: 'Decided', ...json(DuplicateDecisionResult) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const flagRoute = createRoute({
  method: 'post',
  path: '/v1/team/duplicates',
  operationId: 'flagDuplicate',
  tags: ['duplicates'],
  summary: 'Report two charts that are the same person, for a reviewer to decide',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(FlagDuplicate) } },
  responses: {
    200: { description: 'The pair', ...json(DuplicatePairSummary) },
    ...errors(401, 403, 404, 422),
  },
});

const mergesRoute = createRoute({
  method: 'get',
  path: '/v1/team/merges',
  operationId: 'listMerges',
  tags: ['duplicates'],
  summary: 'Recent merges, newest first',
  security: [{ bearer: [] }],
  request: { query: PageQuery },
  responses: { 200: { description: 'A page of merges', ...json(MergePage) }, ...errors(401, 403, 422) },
});

const undoRoute = createRoute({
  method: 'post',
  path: '/v1/team/merges/{mergeId}/undo',
  operationId: 'undoMerge',
  tags: ['duplicates'],
  summary: 'Undo a merge, with a comment. Each chart gets its own ID cards back.',
  security: [{ bearer: [] }],
  request: { params: MergeParam, body: { required: true, ...json(UndoMerge) } },
  responses: { 200: { description: 'Undone', ...json(UndoMergeResult) }, ...errors(401, 403, 404, 409, 422) },
});

export function registerDuplicateRoutes(app: App, deps: Deps) {
  app.openapi(listRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.review_duplicates'] });
    return c.json(await listDuplicates(scope, c.req.valid('query')), 200);
  });

  app.openapi(pairRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.review_duplicates'] });
    return c.json(await getDuplicatePair(scope, c.req.valid('param').pairId), 200);
  });

  app.openapi(decideRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.review_duplicates'], recentAuth: true });
    return c.json(await decideDuplicate(scope, c.req.valid('param').pairId, c.req.valid('json')), 200);
  });

  app.openapi(flagRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.edit'] });
    return c.json(await flagDuplicate(scope, c.req.valid('json')), 200);
  });

  app.openapi(mergesRoute, async (c) => {
    const scope = await teamScope(c, deps);
    await scope.requireAny(['patients.review_duplicates', 'patients.correct_identity'], c.req.routePath);
    return c.json(await listMerges(scope, c.req.valid('query')), 200);
  });

  app.openapi(undoRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.correct_identity'], recentAuth: true });
    return c.json(await undoMerge(scope, c.req.valid('param').mergeId, c.req.valid('json')), 200);
  });
}
