import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  canonicalJson,
  PRESETS,
  sha256Hex,
  type NoteTypeEdit,
  type Preset,
  type ResolvedNoteType,
} from '@sineobex/forms';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import {
  auditAfter,
  bodies,
  createdPreset,
  expectNothingWritten,
  footprint,
  idOf,
  nextVersion,
  presetsApi,
  presetsTeam,
  REASON,
  releasePlatform,
  revisionOf,
  runInstaller,
  STALE_MINUTES,
  tokenOf,
  type PresetsApi,
  type PresetsTeam,
} from './presets-fixtures.ts';
import { call } from './sync-fixtures.ts';

// Phase 3 adds no permission key (D37): every check is one of the 23 keys of migration 0002, alone
// or combined by the three rules below, which the phone mirrors (access.json pins both).

// This file's platform is its own copy, so the platform updates a stale sign-in is tried on can be
// released into it (presets-fixtures.ts, releasePlatform).
vi.mock('../../../packages/presets/data/platform.json', async (importOriginal) => {
  const real = (await importOriginal()) as { default: unknown[] };
  return { default: [...real.default] };
});
// Its note types are its own copy too, so a platform version of one can be released into it.
vi.mock('../../../packages/forms/generated/presets.json', async (importOriginal) => {
  const real = (await importOriginal()) as { default: unknown[] };
  return { default: [...real.default] };
});

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
  method: 'GET' | 'POST' | 'PUT';
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

/**
 * For each route any member of the team may read, whatever the role: every role gets past, one with
 * no permission included, and no refusal is logged; a member of another team is refused, and the
 * refusal is logged in the platform chain.
 */
function checksMembership(
  routes: readonly { path: string; route: string }[],
  context: () => { h: Harness; teamId: string; otherTeamId: string },
) {
  for (const { path, route } of routes) {
    it(`GET ${route} lets every role past, one with no permission included, and refuses none`, async () => {
      const { h, teamId } = context();
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
      const { h, teamId, otherTeamId } = context();
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
    // The assign picker's list (unit L6): a read, so no recent sign-in.
    method: 'GET',
    path: `/v1/notes/${id()}/assignees`,
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
    (c) => c.path.endsWith('/assign') || c.path.endsWith('/ems-handoff'),
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

  checksMembership(
    FORMS_ROUTES.map((path) => ({ path, route: path.replace('demo_note/1', '{key}/{version}') })),
    () => ({ h, teamId, otherTeamId }),
  );
});

/**
 * Phase 5's admin preset routes (phase 5 design 7): team.manage_presets alone opens each, and no
 * other key stands in for it, alone or with every other. The key is the same for every kind, so
 * the rows name several. Their team is made in the database, so no installer ran and it holds no
 * preset: an ID below is no preset's, so a role past the check gets 404, and a tier's whole order
 * is the empty list.
 */
const MANAGE_PRESETS: Permission = 'team.manage_presets';
const ALL_BUT_PRESETS = PERMISSION_KEYS.filter((k) => k !== MANAGE_PRESETS);
const category = { name: 'Demo: Permissions category', behaviour: 'supply', sort: 50 };

const PRESET_ROUTES: RouteCase[] = [
  {
    method: 'GET',
    path: '/v1/admin/presets/flag',
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: '/v1/admin/presets/order_category',
    body: { body: category, reason: REASON },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'PUT',
    path: `/v1/admin/presets/order_category/${id()}`,
    body: { baseVersion: 1, body: { ...category, sort: 60 }, reason: REASON },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: `/v1/admin/presets/item/${id()}/archive`,
    body: { baseVersion: 1, reason: REASON },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: `/v1/admin/presets/bundle/${id()}/restore`,
    body: { reason: REASON },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: `/v1/admin/presets/flag/${id()}/take-update`,
    body: { baseVersion: 1, platformVersion: 1, reason: REASON, asNew: false },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'GET',
    path: `/v1/admin/presets/bag/${id()}/history`,
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: '/v1/admin/preset-order/flag',
    body: { tier: 'secondary', flags: [], reason: REASON },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
];

/** The phone's copy of its team's presets: any member, whatever the role (PL-13). */
const PULL = '/v1/presets';

describe('phase 5 preset routes', () => {
  let h: Harness;
  let teamId: string;
  let pullTeamId: string;
  let otherTeamId: string;

  beforeAll(async () => {
    h = await createHarness();
    teamId = await createTeam(h, 'Presets Team (demo)');
    pullTeamId = await createTeam(h, 'Presets Pull Team (demo)');
    otherTeamId = await createTeam(h, 'Presets Other Team (demo)');
  });
  afterAll(async () => {
    await h.close();
  });

  checksEach(PRESET_ROUTES, () => ({ h, teamId }));

  // The pull runs the platform installer first (design 5.2), so it reads a team of its own and the
  // admin rows' team stays empty.
  checksMembership([{ path: PULL, route: PULL }], () => ({ h, teamId: pullTeamId, otherTeamId }));

  // The reads ask no recent sign-in (design 7): a phone pulls on a sign-in hours old, and Team
  // setup's pages are read without signing in again.
  const reads = [
    { path: PULL, permissions: [] as Permission[], team: () => pullTeamId },
    ...PRESET_ROUTES.filter((r) => r.method === 'GET').map((r) => ({
      path: r.path,
      permissions: r.allowed,
      team: () => teamId,
    })),
  ];
  for (const read of reads) {
    const route = read.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}');
    it(`GET ${route} asks no recent sign-in`, async () => {
      const member = await memberWith(h, read.team(), read.permissions);
      const [user] = await h.scratch.owner<{ email: string }[]>`
        select email from sineobex.users where id = ${member.userId}`;
      const stale = await h.tokenFor(user!.email, {
        authTime: new Date(h.clock.now.getTime() - 60 * 60_000),
      });
      const mark = await auditMark(h);
      const res = await h.request(read.path, { token: stale, teamId: read.team() });
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(422);
      const denied = await h.scratch.owner`
        select 1 from sineobex.audit_events where action = 'access.denied' and id > ${mark}::bigint`;
      expect(denied).toHaveLength(0);
    });
  }
});

/**
 * Every preset write asks for a sign-in within RECENT_AUTH_MINUTES (design 7; PRD main 600), as
 * every admin write does, and its refusal, 403 reauth_required, is logged nowhere (D98). Each
 * request below is one a sign-in made just now carries out, on presets made for it in a team made
 * as the owner console makes one, so a stale sign-in is refused for its age alone, and nothing is
 * written: no head, version, event or audit row, and the same revision.
 */
describe('phase 5 preset writes, with a stale sign-in', () => {
  let h: Harness;
  let team: PresetsTeam;
  let api: PresetsApi;
  let make: ReturnType<typeof bodies>;
  let unrelease: (() => void) | undefined;

  beforeAll(async () => {
    h = await createHarness();
    team = await presetsTeam(h, 'Permissions');
    api = presetsApi(h, team.teamId, team.admin);
    make = bodies(team);
    // Two platform copies the team edited, then a newer platform version of each, which the
    // installer can only offer (5.2): one to take in place, one as a new preset.
    const otc = idOf(team, 'order_category.otc');
    const frost = idOf(team, 'flag.frost_risk');
    const flags = (await api.list('flag')).body as unknown as { id: string; body: Record<string, unknown> }[];
    expect(
      (await api.edit('order_category', otc, 1, { name: 'OTC', behaviour: 'medication', sort: 11 })).status,
    ).toBe(200);
    const frostBody = flags.find((f) => f.id === frost)!.body;
    expect(
      (await api.edit('flag', frost, 1, { ...frostBody, criteria: 'Demo: the team’s own criteria' })).status,
    ).toBe(200);
    unrelease = releasePlatform([
      nextVersion('order_category.otc', (b) => ({ ...b, sort: 15 })),
      nextVersion('flag.frost_risk', (b) => ({ ...b, criteria: 'Demo: the platform’s new criteria' })),
    ]);
    expect((await runInstaller(h, team.teamId)).offer).toEqual({ order_category: 1, flag: 1 });
  });
  afterAll(async () => {
    unrelease?.();
    await h?.close();
  });

  /** A write a sign-in made just now carries out: where it is sent, what, and the status it gets. */
  interface Write {
    method: 'POST' | 'PUT';
    path: string;
    body: unknown;
    done: number;
  }

  const WRITES: [string, () => Promise<Write>][] = [
    [
      'POST /v1/admin/presets/{kind}',
      async () => ({
        method: 'POST',
        path: '/v1/admin/presets/order_category',
        body: { body: make.order_category(), reason: REASON },
        done: 201,
      }),
    ],
    [
      'PUT /v1/admin/presets/{kind}/{id}',
      async () => {
        const body = make.order_category();
        const { id } = await createdPreset(api, 'order_category', body);
        return {
          method: 'PUT',
          path: `/v1/admin/presets/order_category/${id}`,
          body: { baseVersion: 1, body: { ...body, sort: 61 }, reason: REASON },
          done: 200,
        };
      },
    ],
    [
      'POST /v1/admin/presets/{kind}/{id}/archive',
      async () => {
        const { id } = await createdPreset(api, 'order_category', make.order_category());
        return {
          method: 'POST',
          path: `/v1/admin/presets/order_category/${id}/archive`,
          body: { baseVersion: 1, reason: REASON },
          done: 200,
        };
      },
    ],
    [
      'POST /v1/admin/presets/{kind}/{id}/restore',
      async () => {
        const { id } = await createdPreset(api, 'order_category', make.order_category());
        expect((await api.archive('order_category', id, 1)).status).toBe(200);
        return {
          method: 'POST',
          path: `/v1/admin/presets/order_category/${id}/restore`,
          body: { reason: REASON },
          done: 200,
        };
      },
    ],
    [
      'POST /v1/admin/presets/{kind}/{id}/take-update',
      async () => ({
        method: 'POST',
        path: `/v1/admin/presets/order_category/${idOf(team, 'order_category.otc')}/take-update`,
        body: { baseVersion: 2, platformVersion: 2, reason: REASON, asNew: false },
        done: 200,
      }),
    ],
    [
      'POST /v1/admin/presets/{kind}/{id}/take-update (as new)',
      async () => ({
        method: 'POST',
        path: `/v1/admin/presets/flag/${idOf(team, 'flag.frost_risk')}/take-update`,
        body: { baseVersion: 2, platformVersion: 2, reason: REASON, asNew: true },
        done: 200,
      }),
    ],
    [
      'POST /v1/admin/preset-order/flag',
      async () => {
        const rows = (await api.list('flag')).body as unknown as {
          id: string;
          state: string;
          version: number;
          body: { tier: string; rank: number };
        }[];
        // Each flag with the version the list shows it at, as an order is sent.
        const tier = rows
          .filter((r) => r.state === 'active' && r.body.tier === 'primary')
          .sort((a, b) => a.body.rank - b.body.rank)
          .map((r) => ({ id: r.id, baseVersion: r.version }));
        return {
          method: 'POST',
          path: '/v1/admin/preset-order/flag',
          body: { tier: 'primary', flags: tier.reverse(), reason: REASON },
          done: 200,
        };
      },
    ],
  ];

  for (const [name, prepare] of WRITES) {
    it(`${name} refuses a stale sign-in: reauth_required, logged nowhere, nothing written`, async () => {
      const write = await prepare();
      const send = (token: string) =>
        h.request(write.path, { method: write.method, token, teamId: team.teamId, json: write.body });
      const before = await footprint(h, team.teamId);
      const mark = await auditMark(h);
      const res = await send(await tokenOf(h, team.admin, STALE_MINUTES));
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('reauth_required');
      // In no chain: neither the team's nor the platform's.
      expect(await auditAfter(h, mark)).toEqual([]);
      await expectNothingWritten(h, team.teamId, before);
      // A sign-in made just now carries the same request out, so its age alone refused it.
      const done = await send(await tokenOf(h, team.admin));
      const answer = await done.text();
      expect(done.status, answer).toBe(write.done);
      expect(await revisionOf(h, team.teamId)).toBe(before.revision + 1);
    });
  }
});

/**
 * Phase 5's admin note type routes (design 7, unit P4): team.manage_presets alone opens each, as it
 * opens the preset routes, and no other key stands in for it, alone or with every other. Their team
 * is made in the database, so no installer ran and it holds no note type: a key below is a platform
 * note type's the team lacks, so a role past the check gets 404, and the list is empty.
 */
const NOTE_TYPE_ROUTES: RouteCase[] = [
  {
    method: 'GET',
    path: '/v1/admin/note-types',
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: '/v1/admin/note-types',
    body: { title: 'Demo: Permissions note type', kinds: ['non_medical'], group: 'outreach', reason: REASON },
    label: 'a blank one',
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: '/v1/admin/note-types',
    body: { title: 'Demo: Permissions copy', copyOf: 'outreach', reason: REASON },
    label: 'a copy',
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'PUT',
    path: '/v1/admin/note-types/wound_care',
    body: { baseVersion: 1, ops: [{ op: 'rename_type', title: 'Demo: Permissions wounds' }], reason: REASON },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: '/v1/admin/note-types/outreach/archive',
    body: { baseVersion: 1, reason: REASON },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: '/v1/admin/note-types/social_needs/restore',
    body: { reason: REASON },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'GET',
    path: '/v1/admin/note-types/harm_reduction/history',
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
  {
    method: 'POST',
    path: '/v1/admin/note-types/psychological/take-update',
    body: { baseVersion: 1, platformVersion: 2, reason: REASON, asNew: false },
    allowed: [MANAGE_PRESETS],
    refused: ALL_BUT_PRESETS,
    logged: { permission: MANAGE_PRESETS },
  },
];

describe('phase 5 note type routes', () => {
  let h: Harness;
  let teamId: string;

  beforeAll(async () => {
    h = await createHarness();
    teamId = await createTeam(h, 'Note Types Team (demo)');
  });
  afterAll(async () => {
    await h.close();
  });

  checksEach(NOTE_TYPE_ROUTES, () => ({ h, teamId }));

  // The reads ask no recent sign-in (design 7), as the preset reads ask none: Team setup's pages
  // are read without signing in again.
  for (const read of NOTE_TYPE_ROUTES.filter((r) => r.method === 'GET'))
    it(`GET ${read.path} asks no recent sign-in`, async () => {
      const member = await memberWith(h, teamId, [MANAGE_PRESETS]);
      const [user] = await h.scratch.owner<{ email: string }[]>`
        select email from sineobex.users where id = ${member.userId}`;
      const stale = await h.tokenFor(user!.email, {
        authTime: new Date(h.clock.now.getTime() - 60 * 60_000),
      });
      const mark = await auditMark(h);
      const res = await h.request(read.path, { token: stale, teamId });
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(422);
      const denied = await h.scratch.owner`
        select 1 from sineobex.audit_events where action = 'access.denied' and id > ${mark}::bigint`;
      expect(denied).toHaveLength(0);
    });
});

/**
 * Every note type write asks for a sign-in within RECENT_AUTH_MINUTES (design 7; PRD main 600), as
 * every preset write does, and its refusal, 403 reauth_required, is logged nowhere (D98). Each
 * request below is one a sign-in made just now carries out, in a team made as the owner console
 * makes one, so a stale sign-in is refused for its age alone, and nothing is written: no head,
 * version, event or audit row, and the same revision.
 */
describe('phase 5 note type writes, with a stale sign-in', () => {
  let h: Harness;
  let team: PresetsTeam;
  const unreleases: (() => void)[] = [];
  let made = 0;

  /** A note type route in the team, called with a sign-in made `minutesAgo` minutes ago. */
  const send = async (method: 'POST' | 'PUT', path: string, json: unknown, minutesAgo = 0) =>
    call(h, path, { method, token: await tokenOf(h, team.admin, minutesAgo), teamId: team.teamId, json });

  /** A blank note type of the team's own at version 1, made with a sign-in made just now. */
  async function blank(): Promise<string> {
    made += 1;
    const r = await send('POST', '/v1/admin/note-types', {
      title: `Demo: Stale sign-in ${made}`,
      kinds: ['non_medical'],
      group: 'outreach',
      reason: REASON,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.key as string;
  }

  /** The list's row of a key: its version, and the platform version on offer. */
  async function rowOf(key: string) {
    const r = await call(h, '/v1/admin/note-types', {
      token: await tokenOf(h, team.admin),
      teamId: team.teamId,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (
      r.body as unknown as { key: string; version: number; update: { platformVersion: number } | null }[]
    ).find((row) => row.key === key)!;
  }

  /**
   * A platform note type the team edits, then the platform's next version of it, which the
   * installer can only offer (design 5.2): what a take sends, as the list shows it.
   */
  async function offered(key: string) {
    const before = await rowOf(key);
    const edit: NoteTypeEdit = { op: 'rename_type', title: `Demo: ${key}, the team’s own` };
    const edited = await send('PUT', `/v1/admin/note-types/${key}`, {
      baseVersion: before.version,
      ops: [edit],
      reason: REASON,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const newest = [...PRESETS].filter((p) => p.key === key).sort((a, b) => b.version - a.version)[0]!;
    const definition: ResolvedNoteType = {
      ...structuredClone(newest.definition),
      version: newest.version + 1,
      title: `${newest.definition.title}, again`,
    };
    const next: Preset = {
      key,
      version: definition.version,
      hash: await sha256Hex(canonicalJson(definition)),
      definition,
    };
    (PRESETS as Preset[]).push(next);
    unreleases.push(() => void (PRESETS as Preset[]).splice((PRESETS as Preset[]).indexOf(next), 1));
    // A phone's list runs the installer, which offers the platform version over the team's own.
    const listed = await call(h, '/v1/forms/note-types', {
      token: await tokenOf(h, team.admin),
      teamId: team.teamId,
    });
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const row = await rowOf(key);
    expect(row.update?.platformVersion).toBe(next.version);
    return { baseVersion: row.version, platformVersion: next.version };
  }

  /** Everything a note type write could leave behind in the team: what a refusal must leave as it was. */
  async function noteTypeFootprint() {
    const heads = await h.scratch.owner`
      select key, title, state, current_version, platform_latest, customized, revision, updated_at
      from sineobex.note_types where team_id = ${team.teamId} order by key collate "C"`;
    const [counts] = await h.scratch.owner<{ versions: number; events: number; audit: number }[]>`
      select (select count(*)::int from sineobex.note_type_versions where team_id = ${team.teamId}) as versions,
             (select count(*)::int from sineobex.team_preset_events where team_id = ${team.teamId}) as events,
             (select count(*)::int from sineobex.audit_events where team_id = ${team.teamId}) as audit`;
    return { heads, ...counts!, revision: await revisionOf(h, team.teamId) };
  }

  beforeAll(async () => {
    h = await createHarness();
    team = await presetsTeam(h, 'Note Type Permissions');
  });
  afterAll(async () => {
    for (const unrelease of unreleases) unrelease();
    await h?.close();
  });

  /** A write a sign-in made just now carries out: where it is sent, what, and the status it gets. */
  interface Write {
    method: 'POST' | 'PUT';
    path: string;
    body: unknown;
    done: number;
  }

  const WRITES: [string, () => Promise<Write>][] = [
    [
      'POST /v1/admin/note-types (a blank one)',
      async () => ({
        method: 'POST',
        path: '/v1/admin/note-types',
        body: {
          title: 'Demo: Made on a fresh sign-in',
          kinds: ['medical'],
          group: 'clinical',
          reason: REASON,
        },
        done: 201,
      }),
    ],
    [
      'POST /v1/admin/note-types (a copy)',
      async () => ({
        method: 'POST',
        path: '/v1/admin/note-types',
        body: { title: 'Demo: Copied on a fresh sign-in', copyOf: 'outreach', reason: REASON },
        done: 201,
      }),
    ],
    [
      'PUT /v1/admin/note-types/{key}',
      async () => ({
        method: 'PUT',
        path: `/v1/admin/note-types/${await blank()}`,
        body: {
          baseVersion: 1,
          ops: [{ op: 'rename_label', path: 'notes.notes', label: 'Demo: What was said' }],
          reason: REASON,
        },
        done: 200,
      }),
    ],
    [
      'POST /v1/admin/note-types/{key}/archive',
      async () => ({
        method: 'POST',
        path: `/v1/admin/note-types/${await blank()}/archive`,
        body: { baseVersion: 1, reason: REASON },
        done: 200,
      }),
    ],
    [
      'POST /v1/admin/note-types/{key}/restore',
      async () => {
        const key = await blank();
        const archived = await send('POST', `/v1/admin/note-types/${key}/archive`, {
          baseVersion: 1,
          reason: REASON,
        });
        expect(archived.status, JSON.stringify(archived.body)).toBe(200);
        return {
          method: 'POST',
          path: `/v1/admin/note-types/${key}/restore`,
          body: { reason: REASON },
          done: 200,
        };
      },
    ],
    [
      'POST /v1/admin/note-types/{key}/take-update',
      async () => ({
        method: 'POST',
        path: '/v1/admin/note-types/psychological/take-update',
        body: { ...(await offered('psychological')), asNew: false, reason: REASON },
        done: 200,
      }),
    ],
    [
      'POST /v1/admin/note-types/{key}/take-update (as new)',
      async () => ({
        method: 'POST',
        path: '/v1/admin/note-types/sexual_reproductive/take-update',
        body: { ...(await offered('sexual_reproductive')), asNew: true, reason: REASON },
        done: 200,
      }),
    ],
  ];

  for (const [name, prepare] of WRITES) {
    it(`${name} refuses a stale sign-in: reauth_required, logged nowhere, nothing written`, async () => {
      const write = await prepare();
      const before = await noteTypeFootprint();
      const mark = await auditMark(h);
      const res = await h.request(write.path, {
        method: write.method,
        token: await tokenOf(h, team.admin, STALE_MINUTES),
        teamId: team.teamId,
        json: write.body,
      });
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('reauth_required');
      // In no chain: neither the team's nor the platform's.
      expect(await auditAfter(h, mark)).toEqual([]);
      expect(await noteTypeFootprint()).toEqual(before);
      // A sign-in made just now carries the same request out, so its age alone refused it.
      const done = await send(write.method, write.path, write.body);
      expect(done.status, JSON.stringify(done.body)).toBe(write.done);
      expect(await revisionOf(h, team.teamId)).toBe(before.revision + 1);
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
