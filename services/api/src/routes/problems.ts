import type { z } from '@hono/zod-openapi';
import { createRoute } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import {
  declineReversal,
  listReversals,
  mergeProblems,
  reverseResolved,
} from '../patients/problems-admin.ts';
import {
  DeclineReversal,
  MergeProblems,
  PageQuery,
  ProblemParam,
  ProblemView,
  ReversalRequestPage,
  ReverseResolved,
  ReverseResolvedResult,
} from '../patients/schemas.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors } from './schemas.ts';

/**
 * The problem list's online admin actions (phase 3 design 3.3, 9.4): only patients.reverse_resolved
 * moves a problem out of Resolved, declines a reversal or merges two entries. Adding a problem,
 * changing its status and adding a note travel by sync.
 */

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const reversalsRoute = createRoute({
  method: 'get',
  path: '/v1/team/problem-reversals',
  operationId: 'listProblemReversals',
  tags: ['problems'],
  summary: 'Problems staff marked Resolved by mistake, waiting for an admin',
  security: [{ bearer: [] }],
  request: { query: PageQuery },
  responses: {
    200: { description: 'A page of requests', ...json(ReversalRequestPage) },
    ...errors(401, 403, 422),
  },
});

const reverseRoute = createRoute({
  method: 'post',
  path: '/v1/problems/{problemId}/reverse',
  operationId: 'reverseResolvedProblem',
  tags: ['problems'],
  summary: 'Set a Resolved problem back to Ongoing, with a reason; then offers entries to merge into it',
  security: [{ bearer: [] }],
  request: { params: ProblemParam, body: { required: true, ...json(ReverseResolved) } },
  responses: {
    200: { description: 'Reversed', ...json(ReverseResolvedResult) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const declineRoute = createRoute({
  method: 'post',
  path: '/v1/team/problem-reversals/{problemId}/decline',
  operationId: 'declineProblemReversal',
  tags: ['problems'],
  summary: 'Decline a request with a reason; the entry stays a separate problem',
  security: [{ bearer: [] }],
  request: { params: ProblemParam, body: { required: true, ...json(DeclineReversal) } },
  responses: { 200: { description: 'Declined', ...json(ProblemView) }, ...errors(401, 403, 404, 409, 422) },
});

const mergeRoute = createRoute({
  method: 'post',
  path: '/v1/problems/{problemId}/merge',
  operationId: 'mergeProblems',
  tags: ['problems'],
  summary: 'Merge this entry into another; both histories and notes stay',
  security: [{ bearer: [] }],
  request: { params: ProblemParam, body: { required: true, ...json(MergeProblems) } },
  responses: {
    200: { description: 'The entry kept', ...json(ProblemView) },
    ...errors(401, 403, 404, 409, 422),
  },
});

export function registerProblemRoutes(app: App, deps: Deps) {
  app.openapi(reversalsRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.reverse_resolved'] });
    return c.json(await listReversals(scope, c.req.valid('query')), 200);
  });

  app.openapi(reverseRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.reverse_resolved'], recentAuth: true });
    return c.json(await reverseResolved(scope, c.req.valid('param').problemId, c.req.valid('json')), 200);
  });

  app.openapi(declineRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.reverse_resolved'] });
    return c.json(await declineReversal(scope, c.req.valid('param').problemId, c.req.valid('json')), 200);
  });

  app.openapi(mergeRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.reverse_resolved'], recentAuth: true });
    return c.json(await mergeProblems(scope, c.req.valid('param').problemId, c.req.valid('json')), 200);
  });
}
