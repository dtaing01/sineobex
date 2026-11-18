import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIELD_PERMISSIONS,
  hasFieldAccess,
  type Credential,
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

/** A route, a body it accepts, what it needs, and a role that lacks it. */
interface RouteCase {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Tells two cases of one route apart in the test name. */
  label?: string;
  /** Permissions that pass the route's own check. */
  allowed: Permission[];
  /** Permissions that don't; the refusal is logged. */
  refused: Permission[];
  /** The members' credentials, where the route asks for one too (phase 4); 'none' when left out. */
  credential?: { allowed?: Credential; refused?: Credential };
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
    allowed: ['patients.view', 'patients.edit'],
    refused: ['patients.view', 'billing.view_codes'],
    logged: { permission: 'patients.edit' },
  },
  {
    // The candidates are names and births: a role refused search is refused them too (review S5).
    label: 'without patients.view',
    method: 'POST',
    path: '/v1/patients/match',
    body: { preferredName: 'Smitty', surface: 'phone' },
    allowed: ['patients.view', 'patients.edit'],
    refused: ['patients.edit', 'checkins.create'],
    logged: { permission: 'patients.view' },
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
    allowed: ['patients.view', 'patients.correct_identity'],
    refused: ['patients.view', 'patients.edit', 'patients.review_duplicates'],
    logged: { permission: 'patients.correct_identity' },
  },
  {
    label: 'without patients.view',
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
    allowed: ['patients.view', 'patients.correct_identity'],
    refused: ['patients.correct_identity'],
    logged: { permission: 'patients.view' },
  },
  {
    method: 'GET',
    path: '/v1/team/field-reviews?status=open',
    allowed: ['patients.view', 'patients.edit'],
    refused: ['patients.view'],
    logged: { anyOf: ['patients.edit', 'patients.correct_identity'] },
  },
  {
    // The list carries the chart's values and the patient (review S5).
    label: 'without patients.view',
    method: 'GET',
    path: '/v1/team/field-reviews?status=open',
    allowed: ['patients.view', 'patients.edit'],
    refused: ['patients.edit', 'patients.correct_identity'],
    logged: { permission: 'patients.view' },
  },
  {
    method: 'POST',
    path: `/v1/team/field-reviews/${id()}/decision`,
    body: { keep: 'current', baseVersion: 1 },
    allowed: ['patients.view', 'patients.correct_identity'],
    refused: ['patients.view', 'billing.view_codes'],
    logged: { anyOf: ['patients.edit', 'patients.correct_identity'] },
  },
  {
    // The answer is the decided review, with the chart's values.
    label: 'without patients.view',
    method: 'POST',
    path: `/v1/team/field-reviews/${id()}/decision`,
    body: { keep: 'current', baseVersion: 1 },
    allowed: ['patients.view', 'patients.edit'],
    refused: ['patients.edit'],
    logged: { permission: 'patients.view' },
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

/**
 * For each route: a role without what it needs is refused with 403 and the refusal is logged as
 * access.denied; a role with it gets past the check, refused nothing and logging no refusal.
 */
function checksEach(routes: readonly RouteCase[], context: () => { h: Harness; teamId: string }) {
  const send = (r: RouteCase, token: string) => {
    const { h, teamId } = context();
    return h.request(r.path, {
      method: r.method,
      token,
      teamId,
      ...(r.body === undefined ? {} : { json: r.body }),
    });
  };

  for (const r of routes) {
    const route = r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}') + (r.label ? ` (${r.label})` : '');
    it(`${r.method} ${route} refuses a role without what it needs, and logs it`, async () => {
      const { h, teamId } = context();
      const member = await memberWith(h, teamId, r.refused, { credential: r.credential?.refused ?? 'none' });
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
      const { h, teamId } = context();
      const member = await memberWith(h, teamId, r.allowed, { credential: r.credential?.allowed ?? 'none' });
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
}

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

  checksEach(ROUTES, () => ({ h, teamId }));

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

/**
 * Phase 4's online routes (lifecycle 5, 6.1): each checks an existing key first, and the queues a
 * credential that can do their act too. A role with what a route needs gets past the check: the
 * IDs below are no record's, so it answers 404 or an empty list.
 */
const act = { notes: [{ noteId: id(), contentHash: 'a'.repeat(64) }], statementVersion: 'demo-2026-11' };

const ENCOUNTER_ROUTES: RouteCase[] = [
  {
    method: 'GET',
    path: `/v1/encounters/${id()}`,
    allowed: ['patients.view'],
    refused: ['encounters.chart'],
    logged: { permission: 'patients.view' },
  },
  {
    method: 'GET',
    path: `/v1/patients/${id()}/timeline`,
    allowed: ['patients.view'],
    refused: ['encounters.chart', 'billing.view_codes'],
    logged: { permission: 'patients.view' },
  },
  {
    method: 'POST',
    path: `/v1/encounters/${id()}/cosign`,
    body: act,
    allowed: ['encounters.chart'],
    refused: ['patients.view', 'patients.view_sensitive', 'patients.view_sensitive_exams'],
    credential: { allowed: 'attending', refused: 'attending' },
    logged: { permission: 'encounters.chart' },
  },
  {
    method: 'POST',
    path: `/v1/encounters/${id()}/attest`,
    body: act,
    allowed: ['encounters.chart'],
    refused: ['patients.view', 'patients.view_sensitive', 'patients.view_sensitive_exams'],
    credential: { allowed: 'attending', refused: 'attending' },
    logged: { permission: 'encounters.chart' },
  },
  {
    method: 'GET',
    path: '/v1/team/cosign-queue',
    allowed: ['encounters.chart'],
    refused: ['patients.view'],
    credential: { allowed: 'attending', refused: 'attending' },
    logged: { permission: 'encounters.chart' },
  },
  {
    // The queue's credential: one that cannot co-sign is refused with the reason's name.
    label: 'a credential that cannot sign',
    method: 'GET',
    path: '/v1/team/cosign-queue',
    allowed: ['encounters.chart'],
    refused: ['encounters.chart', 'patients.view'],
    credential: { allowed: 'resident', refused: 'student' },
    code: 'cannot_sign',
    logged: { reason: 'cannot_sign' },
  },
  {
    method: 'GET',
    path: '/v1/team/attestation-queue',
    allowed: ['encounters.chart'],
    refused: ['patients.view'],
    credential: { allowed: 'attending', refused: 'attending' },
    logged: { permission: 'encounters.chart' },
  },
  {
    // A resident signs, but only an attending attests (lifecycle 3.5).
    label: 'a credential that cannot attest',
    method: 'GET',
    path: '/v1/team/attestation-queue',
    allowed: ['encounters.chart'],
    refused: ['encounters.chart', 'patients.view'],
    credential: { allowed: 'attending', refused: 'resident' },
    code: 'cannot_attest',
    logged: { reason: 'cannot_attest' },
  },
  {
    method: 'POST',
    path: `/v1/notes/${id()}/assign`,
    body: { toUserId: id(), reason },
    allowed: ['team.manage_users'],
    refused: ['encounters.chart', 'patients.view', 'quarantine.review'],
    logged: { permission: 'team.manage_users' },
  },
  {
    method: 'GET',
    path: '/v1/me/notes-to-finish',
    allowed: ['encounters.chart'],
    refused: ['patients.view', 'team.manage_users'],
    logged: { permission: 'encounters.chart' },
  },
  {
    method: 'GET',
    path: '/v1/team/incomplete-notes',
    allowed: ['team.manage_users'],
    refused: ['encounters.chart', 'patients.view'],
    logged: { permission: 'team.manage_users' },
  },
  {
    method: 'GET',
    path: `/v1/encounters/${id()}/ems-handoff`,
    allowed: ['patients.view'],
    refused: ['encounters.chart', 'exports.billing'],
    logged: { permission: 'patients.view' },
  },
];

describe('phase 4 encounter routes', () => {
  let h: Harness;
  let teamId: string;
  let otherTeamId: string;

  beforeAll(async () => {
    h = await createHarness();
    teamId = await createTeam(h, 'Encounters Team (demo)');
    otherTeamId = await createTeam(h, 'Encounters Other Team (demo)');
  });
  afterAll(async () => {
    await h.close();
  });

  checksEach(ENCOUNTER_ROUTES, () => ({ h, teamId }));

  const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  // Assigning a note and exporting a file are admin and export actions: a sign-in this recent
  // (RECENT_AUTH_MINUTES), as every such route asks (PRD main 602).
  for (const r of ENCOUNTER_ROUTES.filter(
    (c) => c.path.includes('/assign') || c.path.endsWith('/ems-handoff'),
  )) {
    const route = r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}');
    it(`${r.method} ${route} needs a recent sign-in`, async () => {
      const member = await memberWith(h, teamId, r.allowed);
      const [user] = await h.scratch.owner<{ email: string }[]>`
        select email from sineobex.users where id = ${member.userId}`;
      const stale = await h.tokenFor(user!.email, {
        authTime: new Date(h.clock.now.getTime() - 60 * 60_000),
      });
      const res = await h.request(r.path, {
        method: r.method,
        token: stale,
        teamId,
        ...(r.body === undefined ? {} : { json: r.body }),
      });
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await code(res)).toBe('reauth_required');
    });
  }

  it('GET /v1/me/counts lets every role past, one with no permission included, and refuses none', async () => {
    const roles = [...vectors.cases, { name: 'no permission', permissions: [] }];
    for (const c of roles) {
      const member = await memberWith(h, teamId, c.permissions as Permission[]);
      const mark = await auditMark(h);
      const res = await h.request('/v1/me/counts', { token: member.token, teamId });
      expect(res.status, c.name).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const denied = await h.scratch.owner`
        select 1 from sineobex.audit_events where action = 'access.denied' and id > ${mark}::bigint`;
      expect(denied, c.name).toHaveLength(0);
    }
  });

  it('GET /v1/me/counts refuses a member of another team, and logs it', async () => {
    const outsider = await memberWith(h, otherTeamId, [...PERMISSION_KEYS]);
    const mark = await auditMark(h);
    const res = await h.request('/v1/me/counts', { token: outsider.token, teamId });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('not_a_member');
    const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
    expect(denied!.details).toEqual({ rule: 'not_a_member', route: '/v1/me/counts', teamId });
  });
});

/**
 * The note type routes (phase 4 design, forms 3.3): any member of the team, whatever the role, and
 * nobody else. Definitions hold no patient data, so no permission key guards them.
 */
describe('phase 4 forms routes', () => {
  let h: Harness;
  let teamId: string;
  let otherTeamId: string;

  const FORMS_ROUTES = ['/v1/forms/note-types', '/v1/forms/note-types/demo_note/1'];

  beforeAll(async () => {
    h = await createHarness();
    teamId = await createTeam(h, 'Forms Team (demo)');
    otherTeamId = await createTeam(h, 'Forms Other Team (demo)');
  });
  afterAll(async () => {
    await h.close();
  });

  for (const path of FORMS_ROUTES) {
    const route = path.replace('demo_note/1', '{key}/{version}');

    it(`GET ${route} lets every role past, one with no permission included, and refuses none`, async () => {
      const roles = [...vectors.cases, { name: 'no permission', permissions: [] }];
      for (const c of roles) {
        const member = await memberWith(h, teamId, c.permissions as Permission[]);
        const mark = await auditMark(h);
        const res = await h.request(path, { token: member.token, teamId });
        expect(res.status, c.name).not.toBe(403);
        expect(res.status, c.name).not.toBe(422);
        const denied = await h.scratch.owner`
          select 1 from sineobex.audit_events where action = 'access.denied' and id > ${mark}::bigint`;
        expect(denied, c.name).toHaveLength(0);
      }
    });

    it(`GET ${route} refuses a member of another team, and logs it`, async () => {
      const outsider = await memberWith(h, otherTeamId, [...PERMISSION_KEYS]);
      const mark = await auditMark(h);
      const res = await h.request(path, { token: outsider.token, teamId });
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_a_member');
      const denied = await h.scratch.owner<{ teamId: string | null; details: Record<string, unknown> }[]>`
        select team_id as "teamId", details from sineobex.audit_events
        where action = 'access.denied' and actor_user_id = ${outsider.userId} and id > ${mark}::bigint`;
      expect(denied).toEqual([
        { teamId: null, details: { rule: 'not_a_member', route: expect.any(String), teamId } },
      ]);
    });
  }
});

/**
 * The team scope's own refusals: a person asking for a team they are not an active member of, or
 * for a suspended team. Every refusal is written to the audit log (access policy), so each writes
 * one access.denied event, in the platform chain as the owner console's refusal does: the person
 * acts in no team they belong to, and a team's chain must not hold what an outsider tried.
 */
describe('team scope refusals', () => {
  let h: Harness;
  let teamId: string;
  let otherTeamId: string;

  interface DeniedRow {
    teamId: string | null;
    platformChain: boolean;
    actorUserId: string | null;
    actorRole: string | null;
    actorCredential: string | null;
    entity: string | null;
    entityId: string | null;
    patientId: string | null;
    deviceId: string | null;
    ip: string | null;
    requestId: string | null;
    details: Record<string, unknown>;
  }

  const denials = (after: string) => h.scratch.owner<DeniedRow[]>`
    select team_id as "teamId", chain_key = sineobex.platform_chain() as "platformChain",
           actor_user_id as "actorUserId", actor_role as "actorRole",
           actor_credential as "actorCredential", entity, entity_id as "entityId",
           patient_id as "patientId", device_id as "deviceId", host(ip) as ip,
           request_id as "requestId", details
    from sineobex.audit_events
    where action = 'access.denied' and id > ${after}::bigint
    order by id`;

  const ip = '203.0.113.7';
  const ask = (path: string, token: string, team: string, deviceId?: string) =>
    h.request(path, {
      token,
      teamId: team,
      ...(deviceId ? { deviceId } : {}),
      headers: { 'x-forwarded-for': ip },
    });

  async function device(userId: string, team: string): Promise<string> {
    const deviceId = randomUUID();
    await h.scratch.owner`
      insert into sineobex.devices (id, team_id, user_id, platform, app_version, public_key)
      values (${deviceId}, ${team}, ${userId}, 'android', '1.0.0', ${'A'.repeat(43)})`;
    return deviceId;
  }

  beforeAll(async () => {
    h = await createHarness();
    teamId = await createTeam(h, 'Scope Team (demo)');
    otherTeamId = await createTeam(h, 'Scope Other Team (demo)');
  });
  afterAll(async () => {
    await h.close();
  });

  it('logs a member of another team asking for this one, in the platform chain', async () => {
    const outsider = await memberWith(h, otherTeamId, [...PERMISSION_KEYS]);
    // Their own phone, registered in the team they belong to.
    const phone = await device(outsider.userId, otherTeamId);
    const mark = await auditMark(h);
    const res = await ask('/v1/forms/note-types', outsider.token, teamId, phone);
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_a_member');
    expect(await denials(mark)).toEqual([
      {
        teamId: null,
        platformChain: true,
        actorUserId: outsider.userId,
        actorRole: null,
        actorCredential: null,
        entity: null,
        entityId: null,
        patientId: null,
        deviceId: phone,
        ip,
        requestId: res.headers.get('x-request-id'),
        details: { rule: 'not_a_member', route: '/v1/forms/note-types', teamId },
      },
    ]);
  });

  it('logs a removed member as not a member, and names no patient from the path', async () => {
    const removed = await memberWith(h, teamId, ['patients.view']);
    await h.scratch.owner`
      update sineobex.team_memberships set status = 'removed', removed_at = now()
      where id = ${removed.membershipId}`;
    // A teammate's phone in the header is not pinned on this person.
    const teammate = await memberWith(h, teamId, ['patients.view']);
    const theirPhone = await device(teammate.userId, teamId);
    const patientId = randomUUID();
    const mark = await auditMark(h);
    const res = await ask(`/v1/patients/${patientId}`, removed.token, teamId, theirPhone);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_a_member');
    const rows = await denials(mark);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teamId: null,
      platformChain: true,
      actorUserId: removed.userId,
      actorRole: null,
      patientId: null,
      deviceId: null,
      details: { rule: 'not_a_member', route: '/v1/patients/:patientId', teamId },
    });
    expect(JSON.stringify(rows[0]!.details)).not.toContain(patientId);
  });

  it('logs a member of a suspended team', async () => {
    const suspendedTeam = await createTeam(h, 'Scope Suspended Team (demo)');
    const member = await memberWith(h, suspendedTeam, ['patients.view']);
    await h.scratch.owner`update sineobex.teams set status = 'suspended' where id = ${suspendedTeam}`;
    const mark = await auditMark(h);
    const res = await ask('/v1/forms/note-types', member.token, suspendedTeam);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('team_suspended');
    expect(await denials(mark)).toEqual([
      expect.objectContaining({
        teamId: null,
        platformChain: true,
        actorUserId: member.userId,
        actorRole: null,
        actorCredential: null,
        patientId: null,
        deviceId: null,
        ip,
        details: { rule: 'team_suspended', route: '/v1/forms/note-types', teamId: suspendedTeam },
      }),
    ]);
  });

  it('logs nothing for a member of the team', async () => {
    const member = await memberWith(h, teamId, []);
    const mark = await auditMark(h);
    const res = await ask('/v1/forms/note-types', member.token, teamId);
    expect(res.status).toBe(200);
    expect(await denials(mark)).toEqual([]);
  });

  it('still refuses when the refusal cannot be logged', async () => {
    const outsider = await memberWith(h, otherTeamId, [...PERMISSION_KEYS]);
    const mark = await auditMark(h);
    await h.scratch.owner.unsafe('revoke execute on function sineobex.append_audit from sineobex_app');
    let res: Response;
    try {
      res = await ask('/v1/forms/note-types', outsider.token, teamId);
    } finally {
      await h.scratch.owner.unsafe('grant execute on function sineobex.append_audit to sineobex_app');
    }
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string }; noteTypes?: unknown };
    expect(body.error.code).toBe('internal');
    expect(body.noteTypes).toBeUndefined();
    expect(await denials(mark)).toEqual([]);
  });
});
