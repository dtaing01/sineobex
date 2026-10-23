import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIELD_PERMISSIONS,
  hasFieldAccess,
  isPermission,
  mayHoldTeamIndex,
  mayViewProblems,
  PERMISSION_KEYS,
  type Permission,
} from '../src/auth/permissions.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createTeam, expectAudit, memberWith } from './patient-fixtures.ts';

// Phase 3 adds no permission key (D37): every check is one of the 23 keys of migration 0002, alone
// or combined by the three rules below, which the phone mirrors (access.json pins both).

interface AccessCase {
  name: string;
  permissions: string[];
  hasFieldAccess: boolean;
  mayHoldTeamIndex: boolean;
  mayViewProblems: boolean;
}

const vectors = JSON.parse(
  readFileSync(new URL('../../../packages/contract/test-vectors/access.json', import.meta.url), 'utf8'),
) as { cases: AccessCase[] };

describe('access rules over the existing permissions', () => {
  it('still has exactly the 23 permissions of migration 0002', () => {
    expect(PERMISSION_KEYS).toHaveLength(23);
    expect(PERMISSION_KEYS).toEqual(vectors.cases.find((c) => c.name === 'Program Admin')!.permissions);
    expect(FIELD_PERMISSIONS.every((k) => isPermission(k))).toBe(true);
  });

  for (const c of vectors.cases) {
    it(`answers the vectors for ${c.name}`, () => {
      expect(c.permissions.every(isPermission)).toBe(true);
      const set = new Set(c.permissions as Permission[]);
      expect({
        hasFieldAccess: hasFieldAccess(set),
        mayHoldTeamIndex: mayHoldTeamIndex(set),
        mayViewProblems: mayViewProblems(set),
      }).toEqual({
        hasFieldAccess: c.hasFieldAccess,
        mayHoldTeamIndex: c.mayHoldTeamIndex,
        mayViewProblems: c.mayViewProblems,
      });
    });
  }
});

/** Every phase 3 route, a body it accepts, what it needs, and a role that lacks it. */
interface RouteCase {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Permissions that pass the route's own check. */
  allowed: Permission[];
  /** Permissions that don't; the refusal is logged. */
  refused: Permission[];
  code?: string;
  logged: Record<string, unknown>;
}

const id = () => randomUUID();
const reason = 'Confirmed with the patient today';

const ROUTES: RouteCase[] = [
  {
    method: 'POST',
    path: '/v1/patients/search',
    body: { name: 'Smity', surface: 'portal' },
    allowed: ['patients.view'],
    refused: ['checkins.create'],
    logged: { permission: 'patients.view' },
  },
  {
    method: 'POST',
    path: '/v1/patients/match',
    body: { preferredName: 'Smitty', surface: 'phone' },
    allowed: ['patients.edit'],
    refused: ['patients.view', 'billing.view_codes'],
    logged: { permission: 'patients.edit' },
  },
  {
    method: 'GET',
    path: `/v1/patients/${id()}`,
    allowed: ['patients.view'],
    refused: ['encounters.chart'],
    logged: { permission: 'patients.view' },
  },
  {
    method: 'POST',
    path: '/v1/patients/charts',
    body: { patientIds: [id()], reason: 'opened' },
    allowed: ['patients.view'],
    refused: ['patients.edit'],
    logged: { permission: 'patients.view' },
  },
  {
    method: 'POST',
    path: '/v1/patients/index',
    body: {},
    allowed: ['patients.view', 'checkins.create'],
    refused: ['patients.view', 'billing.view_codes', 'inventory.view', 'exports.billing', 'exports.grant'],
    code: 'index_not_permitted',
    logged: { rule: 'mayHoldTeamIndex' },
  },
  {
    method: 'GET',
    path: `/v1/patients/${id()}/history?field=usualArea`,
    allowed: ['patients.view'],
    refused: ['checkins.create'],
    logged: { permission: 'patients.view' },
  },
  {
    method: 'POST',
    path: `/v1/patients/${id()}/corrections`,
    body: {
      field: 'birth',
      value: { precision: 'year', year: 1946 },
      baseVersion: 1,
      reason,
      requestedByPatient: true,
      outcome: 'corrected',
    },
    allowed: ['patients.correct_identity'],
    refused: ['patients.view', 'patients.edit', 'patients.review_duplicates'],
    logged: { permission: 'patients.correct_identity' },
  },
  {
    method: 'GET',
    path: '/v1/team/field-reviews?status=open',
    allowed: ['patients.edit'],
    refused: ['patients.view'],
    logged: { anyOf: ['patients.edit', 'patients.correct_identity'] },
  },
  {
    method: 'POST',
    path: `/v1/team/field-reviews/${id()}/decision`,
    body: { keep: 'current', baseVersion: 1 },
    allowed: ['patients.correct_identity'],
    refused: ['patients.view', 'billing.view_codes'],
    logged: { anyOf: ['patients.edit', 'patients.correct_identity'] },
  },
  {
    method: 'GET',
    path: `/v1/patients/${id()}/id-link`,
    allowed: ['patients.edit'],
    refused: ['patients.view', 'billing.view_codes'],
    logged: { permission: 'patients.edit' },
  },
  {
    method: 'POST',
    path: `/v1/patients/${id()}/id-link`,
    body: { linkId: id(), replacesLinkId: null, reason: 'first_card' },
    allowed: ['patients.edit'],
    refused: ['patients.view'],
    logged: { permission: 'patients.edit' },
  },
  {
    method: 'GET',
    path: '/v1/team/problem-reversals',
    allowed: ['patients.reverse_resolved'],
    refused: ['patients.view', 'encounters.chart'],
    logged: { permission: 'patients.reverse_resolved' },
  },
  {
    method: 'POST',
    path: `/v1/problems/${id()}/reverse`,
    body: { reason },
    allowed: ['patients.reverse_resolved'],
    refused: ['patients.view', 'patients.edit', 'encounters.chart'],
    logged: { permission: 'patients.reverse_resolved' },
  },
  {
    method: 'POST',
    path: `/v1/team/problem-reversals/${id()}/decline`,
    body: { reason },
    allowed: ['patients.reverse_resolved'],
    refused: ['encounters.chart'],
    logged: { permission: 'patients.reverse_resolved' },
  },
  {
    method: 'POST',
    path: `/v1/problems/${id()}/merge`,
    body: { intoProblemId: id(), comment: reason },
    allowed: ['patients.reverse_resolved'],
    refused: ['encounters.chart'],
    logged: { permission: 'patients.reverse_resolved' },
  },
  {
    method: 'GET',
    path: '/v1/team/duplicates?status=open',
    allowed: ['patients.review_duplicates'],
    refused: ['patients.view', 'patients.edit'],
    logged: { permission: 'patients.review_duplicates' },
  },
  {
    method: 'GET',
    path: `/v1/team/duplicates/${id()}`,
    allowed: ['patients.review_duplicates'],
    refused: ['patients.edit'],
    logged: { permission: 'patients.review_duplicates' },
  },
  {
    method: 'POST',
    path: `/v1/team/duplicates/${id()}/decision`,
    body: { decision: 'keep_separate', comment: reason, versions: { a: 1, b: 1 } },
    allowed: ['patients.review_duplicates'],
    refused: ['patients.edit', 'patients.correct_identity'],
    logged: { permission: 'patients.review_duplicates' },
  },
  {
    method: 'POST',
    path: '/v1/team/duplicates',
    body: { patientA: id(), patientB: id(), comment: reason },
    allowed: ['patients.edit'],
    refused: ['patients.view', 'patients.review_duplicates'],
    logged: { permission: 'patients.edit' },
  },
  {
    method: 'GET',
    path: '/v1/team/merges',
    allowed: ['patients.correct_identity'],
    refused: ['patients.view', 'patients.edit'],
    logged: { anyOf: ['patients.review_duplicates', 'patients.correct_identity'] },
  },
  {
    method: 'POST',
    path: `/v1/team/merges/${id()}/undo`,
    body: { comment: reason },
    allowed: ['patients.correct_identity'],
    // Undoing a merge is an identity correction: reviewing duplicates alone doesn't allow it.
    refused: ['patients.view', 'patients.review_duplicates'],
    logged: { permission: 'patients.correct_identity' },
  },
];

describe('phase 3 routes', () => {
  let h: Harness;
  let teamId: string;

  beforeAll(async () => {
    h = await createHarness();
    teamId = await createTeam(h);
  });
  afterAll(async () => {
    await h.close();
  });

  const send = (r: RouteCase, token: string) =>
    h.request(r.path, { method: r.method, token, teamId, ...(r.body === undefined ? {} : { json: r.body }) });

  for (const r of ROUTES) {
    const route = r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}');
    it(`${r.method} ${route} refuses a role without what it needs, and logs it`, async () => {
      const member = await memberWith(h, teamId, r.refused);
      const mark = await auditMark(h);
      const res = await send(r, member.token);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe(r.code ?? 'forbidden');
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, teamId, count: 1 });
      expect(denied!.actorUserId).toBe(member.userId);
      expect(denied!.details).toMatchObject({ ...r.logged, route: expect.stringMatching(/^\/v1\//) });
    });

    it(`${r.method} ${route} lets a role with what it needs past the check`, async () => {
      const member = await memberWith(h, teamId, r.allowed);
      const mark = await auditMark(h);
      const res = await send(r, member.token);
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(422);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const denied = await h.scratch.owner`
        select 1 from sineobex.audit_events where action = 'access.denied' and id > ${mark}::bigint`;
      expect(denied).toHaveLength(0);
    });
  }

  it('gives the team index to every field role and to no desk role', async () => {
    for (const c of vectors.cases) {
      const member = await memberWith(h, teamId, c.permissions as Permission[]);
      const res = await h.request('/v1/patients/index', {
        method: 'POST',
        token: member.token,
        teamId,
        json: {},
      });
      expect(res.status === 403, c.name).toBe(!c.mayHoldTeamIndex);
    }
  });

  it('takes search terms and names only in a POST body', async () => {
    const member = await memberWith(h, teamId, ['patients.view']);
    // There is no GET search: the path reads as a patient ID, which it is not.
    const res = await h.request('/v1/patients/search?name=Smity', {
      method: 'GET',
      token: member.token,
      teamId,
    });
    expect([404, 422]).toContain(res.status);
    const noName = await h.request('/v1/patients/search', {
      method: 'POST',
      token: member.token,
      teamId,
      json: { birth: { year: 1946 }, surface: 'portal' },
    });
    // A year alone never browses the list.
    expect(noName.status).toBe(422);
  });

  it('tells the phone where ID cards point', async () => {
    const member = await memberWith(h, teamId, ['patients.edit']);
    const res = await h.request('/v1/me', { token: member.token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { idLinkBaseUrl: string }).idLinkBaseUrl).toBe('http://localhost:3100');
  });
});
