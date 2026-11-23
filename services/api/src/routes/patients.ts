import type { z } from '@hono/zod-openapi';
import { createRoute } from '@hono/zod-openapi';
import { compress } from 'hono/compress';
import { teamScope } from '../auth/context.ts';
import { fetchCharts, getChart } from '../patients/charts.ts';
import { correctIdentity } from '../patients/corrections.ts';
import { decideFieldReview, listFieldReviews } from '../patients/field-reviews.ts';
import { markFlagChangeInError, setPatientFlag } from '../patients/flags.ts';
import { fieldHistory } from '../patients/history.ts';
import { getIdLinks, issueIdLink } from '../patients/id-links.ts';
import { matchPatients } from '../patients/match.ts';
import {
  ChartBundle,
  DecideFieldReview,
  FetchCharts,
  FieldHistoryPage,
  FieldReviewPage,
  FieldReviewQuery,
  FieldReviewView,
  FlagChangeParam,
  HistoryQuery,
  IdentityCorrection,
  IdLinkState,
  IssueIdLink,
  MarkFlagChange,
  MarkFlagChangeResult,
  PatientChart,
  PatientMatchRequest,
  PatientMatchResult,
  PatientParam,
  PatientSearch,
  PatientSearchResult,
  ReviewParam,
  SetPatientFlag,
  SetPatientFlagResult,
  TeamIndexPage,
  TeamIndexRequest,
} from '../patients/schemas.ts';
import { searchPatients } from '../patients/search.ts';
import { teamIndexPage } from '../patients/team-index.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors } from './schemas.ts';

/**
 * Patients: search, the intake match, charts, the phone's team index, history, identity
 * corrections, field reviews, ID links (phase 3 design 3.1, 3.2, 3.5) and flags (phase 5 design 7).
 * Every permission is an existing catalog key (D37); a refusal is logged as access.denied. Names,
 * birth dates, search text and a flag's reason travel only in POST bodies.
 */

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const searchRoute = createRoute({
  method: 'post',
  path: '/v1/patients/search',
  operationId: 'searchPatients',
  tags: ['patients'],
  summary: 'Find patients by name, street name, description or birth date. Logged with the patients shown.',
  description:
    'A name, or a full birth date; a year needs a name with it. Not paged: past 50 the screen asks for more ' +
    'letters or a birth year. The search text is never logged.',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(PatientSearch) } },
  responses: { 200: { description: 'Results', ...json(PatientSearchResult) }, ...errors(401, 403, 422) },
});

const matchRoute = createRoute({
  method: 'post',
  path: '/v1/patients/match',
  operationId: 'matchPatients',
  tags: ['patients'],
  summary: 'Patients who may be the person being registered, before the chart is created',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(PatientMatchRequest) } },
  responses: { 200: { description: 'Candidates', ...json(PatientMatchResult) }, ...errors(401, 403, 422) },
});

const chartRoute = createRoute({
  method: 'get',
  path: '/v1/patients/{patientId}',
  operationId: 'getPatient',
  tags: ['patients'],
  summary: 'A patient’s chart, as the role may see it. A merged ID answers the kept chart.',
  security: [{ bearer: [] }],
  request: { params: PatientParam },
  responses: { 200: { description: 'The chart', ...json(PatientChart) }, ...errors(401, 403, 404, 422) },
});

const chartsRoute = createRoute({
  method: 'post',
  path: '/v1/patients/charts',
  operationId: 'fetchCharts',
  tags: ['patients'],
  summary: 'Charts for the phone’s 24-hour cache, with every redirect that touches them. Gzipped.',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(FetchCharts) } },
  responses: { 200: { description: 'Charts', ...json(ChartBundle) }, ...errors(401, 403, 422) },
});

const indexRoute = createRoute({
  method: 'post',
  path: '/v1/patients/index',
  operationId: 'downloadTeamIndex',
  tags: ['patients'],
  summary: 'The team search index for a phone, a page at a time. Field roles only. Gzipped.',
  description:
    'Needs patients.view and one of patients.edit, encounters.chart, checkins.create; otherwise 403 ' +
    'index_not_permitted, and the phone deletes any index it holds. `have` equal to the current version ' +
    'answers `unchanged`. No legal name, no token, and of clinical content only the current flags, a sensitive ' +
    'one only for a reader who sees sensitive problems (projection idx1+sens).',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(TeamIndexRequest) } },
  responses: {
    200: { description: 'A page, or unchanged', ...json(TeamIndexPage) },
    ...errors(401, 403, 422),
  },
});

const historyRoute = createRoute({
  method: 'get',
  path: '/v1/patients/{patientId}/history',
  operationId: 'getPatientHistory',
  tags: ['patients'],
  summary: 'Every recorded value of the chart’s fields, old and new, with who and how',
  security: [{ bearer: [] }],
  request: { params: PatientParam, query: HistoryQuery },
  responses: {
    200: { description: 'A page of history', ...json(FieldHistoryPage) },
    ...errors(401, 403, 404, 422),
  },
});

const correctionRoute = createRoute({
  method: 'post',
  path: '/v1/patients/{patientId}/corrections',
  operationId: 'correctIdentity',
  tags: ['patients'],
  summary: 'Correct a legal name or birth date with a reason, or record a declined amendment request',
  security: [{ bearer: [] }],
  request: { params: PatientParam, body: { required: true, ...json(IdentityCorrection) } },
  responses: {
    200: { description: 'The chart after the correction', ...json(PatientChart) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const reviewsRoute = createRoute({
  method: 'get',
  path: '/v1/team/field-reviews',
  operationId: 'listFieldReviews',
  tags: ['patients'],
  summary: 'Fields where two values were recorded, that the signed-in person may decide',
  security: [{ bearer: [] }],
  request: { query: FieldReviewQuery },
  responses: {
    200: { description: 'A page of reviews', ...json(FieldReviewPage) },
    ...errors(401, 403, 422),
  },
});

const decideReviewRoute = createRoute({
  method: 'post',
  path: '/v1/team/field-reviews/{reviewId}/decision',
  operationId: 'decideFieldReview',
  tags: ['patients'],
  summary: 'Keep the chart’s value or an alternate. Legal name and birth date need an admin and a comment.',
  security: [{ bearer: [] }],
  request: { params: ReviewParam, body: { required: true, ...json(DecideFieldReview) } },
  responses: {
    200: { description: 'Decided', ...json(FieldReviewView) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const idLinkRoute = createRoute({
  method: 'get',
  path: '/v1/patients/{patientId}/id-link',
  operationId: 'getIdLinks',
  tags: ['patients'],
  summary: 'The patient’s Street Medicine ID cards: active links with their URLs, and history',
  security: [{ bearer: [] }],
  request: { params: PatientParam },
  responses: { 200: { description: 'Cards', ...json(IdLinkState) }, ...errors(401, 403, 404, 422) },
});

const issueIdLinkRoute = createRoute({
  method: 'post',
  path: '/v1/patients/{patientId}/id-link',
  operationId: 'issueIdLink',
  tags: ['patients'],
  summary: 'Make a new card. Every active card of the patient stops working.',
  security: [{ bearer: [] }],
  request: { params: PatientParam, body: { required: true, ...json(IssueIdLink) } },
  responses: {
    200: { description: 'Cards after the issue', ...json(IdLinkState) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const setFlagRoute = createRoute({
  method: 'post',
  path: '/v1/patients/{patientId}/flags',
  operationId: 'setPatientFlag',
  tags: ['patients'],
  summary:
    'Set or clear a flag on the patient, with a reason. A retry of the same form gets the first answer.',
  description:
    'Needs patients.view and patients.edit. The refusals: 404 for a patient the team does not hold; 422 ' +
    'unknown_flag, then reason_invalid; 403 for a flag the role may not see, logged; 409 archived for a set of a ' +
    'flag no longer on the team’s list (a clear is taken), and id_taken for an ID another change holds.',
  security: [{ bearer: [] }],
  request: { params: PatientParam, body: { required: true, ...json(SetPatientFlag) } },
  responses: {
    201: { description: 'Made, now or by an earlier send of the same form', ...json(SetPatientFlagResult) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const markFlagChangeRoute = createRoute({
  method: 'post',
  path: '/v1/patients/{patientId}/flag-changes/{changeId}/entered-in-error',
  operationId: 'markFlagChangeInError',
  tags: ['patients'],
  summary: 'Mark a flag change of the chart entered in error, once, with a reason',
  description:
    'Needs patients.edit, and the change’s author or a Program Admin (team.manage_users), else 403, logged, as a ' +
    'change of a flag the role may not see is; 404 for a change the patient’s chart does not hold; 409 ' +
    'already_marked.',
  security: [{ bearer: [] }],
  request: { params: FlagChangeParam, body: { required: true, ...json(MarkFlagChange) } },
  responses: {
    200: { description: 'Marked', ...json(MarkFlagChangeResult) },
    ...errors(401, 403, 404, 409, 422),
  },
});

export function registerPatientRoutes(app: App, deps: Deps) {
  // Only these two are gzipped: what they return is chart text team members wrote, and nothing a
  // caller sends is reflected in them.
  app.use('/v1/patients/index', compress());
  app.use('/v1/patients/charts', compress());

  app.openapi(searchRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.view'] });
    return c.json(await searchPatients(scope, c.req.valid('json')), 200);
  });

  app.openapi(matchRoute, async (c) => {
    // The candidates are names and births: a role refused search is refused them here too.
    const scope = await teamScope(c, deps, { permissions: ['patients.view', 'patients.edit'] });
    return c.json(await matchPatients(scope, c.req.valid('json')), 200);
  });

  app.openapi(chartRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.view'] });
    return c.json(await getChart(scope, c.req.valid('param').patientId), 200);
  });

  app.openapi(chartsRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.view'] });
    return c.json(await fetchCharts(scope, c.req.valid('json')), 200);
  });

  app.openapi(indexRoute, async (c) => {
    const scope = await teamScope(c, deps);
    await scope.requireRule('mayHoldTeamIndex', c.req.routePath, {
      message: 'Your role doesn’t keep the patient list on a phone.',
      code: 'index_not_permitted',
    });
    return c.json(await teamIndexPage(scope, c.req.valid('json')), 200);
  });

  app.openapi(historyRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.view'] });
    return c.json(await fieldHistory(scope, c.req.valid('param').patientId, c.req.valid('query')), 200);
  });

  app.openapi(correctionRoute, async (c) => {
    // The answer is the chart, so a role that can't read charts can't correct one either.
    const scope = await teamScope(c, deps, {
      permissions: ['patients.view', 'patients.correct_identity'],
      recentAuth: true,
    });
    return c.json(await correctIdentity(scope, c.req.valid('param').patientId, c.req.valid('json')), 200);
  });

  // Both answer with the chart's values, so both need patients.view as well as a key that decides.
  app.openapi(reviewsRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.view'] });
    await scope.requireAny(['patients.edit', 'patients.correct_identity'], c.req.routePath);
    return c.json(await listFieldReviews(scope, c.req.valid('query')), 200);
  });

  app.openapi(decideReviewRoute, async (c) => {
    // The review's own `needs`, and a recent sign-in for identity fields, are checked once it is loaded.
    const scope = await teamScope(c, deps, { permissions: ['patients.view'] });
    await scope.requireAny(['patients.edit', 'patients.correct_identity'], c.req.routePath);
    return c.json(await decideFieldReview(scope, c.req.valid('param').reviewId, c.req.valid('json')), 200);
  });

  app.openapi(idLinkRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.edit'] });
    return c.json(await getIdLinks(scope, c.req.valid('param').patientId), 200);
  });

  app.openapi(issueIdLinkRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.edit'] });
    return c.json(await issueIdLink(scope, c.req.valid('param').patientId, c.req.valid('json')), 200);
  });

  // PLAN-OPEN (BM-69): who may flag a patient? Whoever holds patients.edit, as a phone's change needs
  // (patient-flag-change.ts); the set answers with nothing of the chart, the mark with its version.
  app.openapi(setFlagRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.view', 'patients.edit'] });
    const { patientId } = c.req.valid('param');
    return c.json(await setPatientFlag(scope, patientId, c.req.valid('json'), c.req.routePath), 201);
  });

  app.openapi(markFlagChangeRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['patients.edit'] });
    const { patientId, changeId } = c.req.valid('param');
    return c.json(
      await markFlagChangeInError(scope, patientId, changeId, c.req.valid('json'), c.req.routePath),
      200,
    );
  });
}
