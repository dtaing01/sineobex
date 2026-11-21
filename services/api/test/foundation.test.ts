import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '../src/auth/permissions.ts';
import { createHarness, type Harness } from './harness.ts';

// A valid NPI (check digit correct) and one with a typo.
const NPI = '1234567893';
const BAD_NPI = '1234567890';

type Json = Record<string, unknown> & { error?: { code: string; details?: Record<string, unknown> } };

describe('phase 1 foundation', () => {
  let h: Harness;
  let ownerToken: string;
  let teamId: string;
  let otherTeamId: string;
  let mercyToken: string;
  let roles: Record<string, string>;

  async function call(path: string, init: Parameters<Harness['request']>[1] = {}) {
    const res = await h.request(path, init);
    return { status: res.status, body: (await res.json()) as Json };
  }

  async function auditActions(token: string, team: string, actionPrefix?: string) {
    const r = await call('/v1/team/audit/search', {
      method: 'POST',
      token,
      teamId: team,
      json: { actionPrefix, limit: 200 },
    });
    expect(r.status).toBe(200);
    return r.body.entries as { action: string; details: Record<string, unknown> }[];
  }

  beforeAll(async () => {
    h = await createHarness();
    await h.seedOwner('sarah@example.com', 'Sarah');
    ownerToken = await h.tokenFor('sarah@example.com');

    const created = await call('/v1/owner/teams', {
      method: 'POST',
      token: ownerToken,
      json: { name: 'Detroit Street Team' },
    });
    expect(created.status).toBe(201);
    teamId = created.body.id as string;
    const other = await call('/v1/owner/teams', {
      method: 'POST',
      token: ownerToken,
      json: { name: 'Other Team' },
    });
    otherTeamId = other.body.id as string;

    const appointed = await call(`/v1/owner/teams/${teamId}/program-admins`, {
      method: 'POST',
      token: ownerToken,
      json: {
        email: 'mercy@example.com',
        displayName: 'Mercy',
        credential: 'attending',
        credentialFields: { npi: NPI, licenseNumber: 'MD-4401', licenseState: 'mi' },
      },
    });
    expect(appointed.status).toBe(201);
    expect(appointed.body.credentialFields).toEqual({
      npi: NPI,
      licenseNumber: 'MD-4401',
      licenseState: 'MI',
    });
    const mercy = await h.scratch.owner<
      { id: string }[]
    >`select id from sineobex.users where email = 'mercy@example.com'`;
    await h.acknowledge(mercy[0]!.id);
    mercyToken = await h.tokenFor('mercy@example.com');

    const roleList = await call('/v1/team/roles', { token: mercyToken, teamId });
    roles = Object.fromEntries(
      (roleList.body as unknown as { key: string; id: string }[]).map((r) => [r.key, r.id]),
    );
  });
  afterAll(async () => {
    await h.close();
  });

  it('creates the community health worker preset with every new team', () => {
    expect(Object.keys(roles)).toEqual(
      expect.arrayContaining([
        'program_admin',
        'logistics',
        'healthcare_staff',
        'billing_data',
        'community_health_worker',
      ]),
    );
  });

  it('done when: an admin invites a user, upgrades a student to resident with fields and a reason, and both are audited', async () => {
    const invited = await call('/v1/team/members', {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: {
        email: 'Brooke@Example.com',
        displayName: 'Brooke',
        roleId: roles.healthcare_staff,
        credential: 'student',
        credentialFields: { school: 'Wayne State School of Medicine', supervisingPhysician: 'Dr. Mercy' },
      },
    });
    expect(invited.status).toBe(201);
    expect(invited.body).toMatchObject({
      email: 'brooke@example.com',
      credential: 'student',
      status: 'active',
    });
    const membershipId = invited.body.membershipId as string;

    // Moving up without the resident's fields changes nothing.
    const missing = await call(`/v1/team/members/${membershipId}/credential`, {
      method: 'PUT',
      token: mercyToken,
      teamId,
      json: { credential: 'resident', credentialFields: { npi: BAD_NPI }, reason: 'Started residency' },
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error?.code).toBe('credential_fields_invalid');
    expect(missing.body.error?.details?.problems).toEqual(
      expect.arrayContaining([
        { field: 'npi', problem: 'invalid' },
        { field: 'program', problem: 'missing' },
        { field: 'supervisingAttending', problem: 'missing' },
      ]),
    );
    const still = await call(`/v1/team/members/${membershipId}`, { token: mercyToken, teamId });
    expect(still.body.credential).toBe('student');

    const upgraded = await call(`/v1/team/members/${membershipId}/credential`, {
      method: 'PUT',
      token: mercyToken,
      teamId,
      json: {
        credential: 'resident',
        credentialFields: {
          npi: NPI,
          program: 'DMC Internal Medicine',
          supervisingAttending: 'Dr. Mercy',
          school: 'stale',
        },
        reason: 'Started residency in July',
      },
    });
    expect(upgraded.status).toBe(200);
    expect(upgraded.body).toMatchObject({ credential: 'resident', direction: 'up' });
    // Fields from the old credential don't ride along.
    expect(upgraded.body.credentialFields).toEqual({
      npi: NPI,
      program: 'DMC Internal Medicine',
      supervisingAttending: 'Dr. Mercy',
    });

    const events = await auditActions(mercyToken, teamId, 'membership.');
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['membership.invited', 'membership.credential_changed']));
    const change = events.find((e) => e.action === 'membership.credential_changed')!;
    expect(change.details).toMatchObject({
      from: 'student',
      to: 'resident',
      direction: 'up',
      reason: 'Started residency in July',
    });

    const history = await call(`/v1/team/members/${membershipId}/history`, { token: mercyToken, teamId });
    expect(
      (history.body as unknown as { kind: string; reason: string | null }[]).map((c) => [c.kind, c.reason]),
    ).toEqual([
      ['credential', 'Started residency in July'],
      ['invited', null],
    ]);
  });

  it('a re-invite records the credential and fields the membership had before it', async () => {
    // Signatures keep the credential they were signed under (lifecycle 3.5): a sign-off held while
    // the person was away is read against this history, so a restore must say what it replaced.
    const invite = (credential: string, credentialFields: Record<string, string>) =>
      call('/v1/team/members', {
        method: 'POST',
        token: mercyToken,
        teamId,
        json: {
          email: 'rowena@example.com',
          displayName: 'Rowena',
          roleId: roles.healthcare_staff,
          credential,
          credentialFields,
        },
      });
    const residentFields = {
      npi: NPI,
      program: 'Demo: internal medicine',
      supervisingAttending: 'Dr. Mercy',
    };
    const first = await invite('resident', residentFields);
    expect(first.status).toBe(201);
    const membershipId = first.body.membershipId as string;
    const removed = await call(`/v1/team/members/${membershipId}/remove`, {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: { reason: 'Demo: rotation ended' },
    });
    expect(removed.status).toBe(200);
    const attendingFields = { npi: '1245319599', licenseNumber: 'MD-9', licenseState: 'MI' };
    const again = await invite('attending', attendingFields);
    expect(again.status).toBe(201);
    expect(again.body.membershipId).toBe(membershipId);

    const history = await call(`/v1/team/members/${membershipId}/history`, { token: mercyToken, teamId });
    const changes = history.body as unknown as { kind: string; oldValue: unknown; newValue: unknown }[];
    expect(changes.map((c) => c.kind)).toEqual(['restored', 'removed', 'invited']);
    expect(changes[0]).toMatchObject({
      oldValue: { credential: 'resident', fields: residentFields },
      newValue: { roleKey: 'healthcare_staff', credential: 'attending' },
    });
  });

  it('moves down at once, without waiting for fields', async () => {
    const invited = await call('/v1/team/members', {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: {
        email: 'nadia@example.com',
        displayName: 'Nadia',
        roleId: roles.healthcare_staff,
        credential: 'np',
        credentialFields: { npi: NPI, licenseNumber: 'NP-1', licenseState: 'MI' },
      },
    });
    const down = await call(`/v1/team/members/${invited.body.membershipId}/credential`, {
      method: 'PUT',
      token: mercyToken,
      teamId,
      json: { credential: 'chw', reason: 'License lapsed' },
    });
    expect(down.body).toMatchObject({ credential: 'chw', direction: 'down', credentialFields: {} });
  });

  it('requires a reason for every role change, and logs it', async () => {
    const m = await call('/v1/team/members', {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: { email: 'lou@example.com', displayName: 'Lou', roleId: roles.healthcare_staff },
    });
    const noReason = await call(`/v1/team/members/${m.body.membershipId}/role`, {
      method: 'PUT',
      token: mercyToken,
      teamId,
      json: { roleId: roles.logistics },
    });
    expect(noReason.status).toBe(422);
    const ok = await call(`/v1/team/members/${m.body.membershipId}/role`, {
      method: 'PUT',
      token: mercyToken,
      teamId,
      json: { roleId: roles.logistics, reason: 'Coordinating runs now' },
    });
    expect(ok.body.role).toMatchObject({ key: 'logistics' });
    const events = await auditActions(mercyToken, teamId, 'membership.role_changed');
    expect(events[0]!.details).toMatchObject({
      from: 'healthcare_staff',
      to: 'logistics',
      reason: 'Coordinating runs now',
    });
  });

  it('lets only owners appoint Program Admins', async () => {
    const r = await call('/v1/team/members', {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: { email: 'second-admin@example.com', displayName: 'Second', roleId: roles.program_admin },
    });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('owner_only');
  });

  it('lets only a platform owner change a Program Admin’s credential, as an active member of the team', async () => {
    // A team of its own, so its second Program Admin leaves the last-admin guard below alone.
    const created = await call('/v1/owner/teams', {
      method: 'POST',
      token: ownerToken,
      json: { name: 'Credentials Team' },
    });
    expect(created.status).toBe(201);
    const crewId = created.body.id as string;
    const attendingFields = (npi: string, licenseNumber: string) => ({
      npi,
      licenseNumber,
      licenseState: 'MI',
    });
    const appoint = async (email: string, displayName: string, fields: Record<string, string>) => {
      const r = await call(`/v1/owner/teams/${crewId}/program-admins`, {
        method: 'POST',
        token: ownerToken,
        json: { email, displayName, credential: 'attending', credentialFields: fields },
      });
      expect(r.status).toBe(201);
      await h.acknowledge(r.body.userId as string);
      return {
        membershipId: r.body.membershipId as string,
        userId: r.body.userId as string,
        token: await h.tokenFor(email),
      };
    };
    const pamFields = attendingFields(NPI, 'MD-4402');
    const quinnFields = attendingFields('1245319599', 'MD-4403');
    const pam = await appoint('pam@example.com', 'Pam', pamFields);
    const quinn = await appoint('quinn@example.com', 'Quinn', quinnFields);
    const lower = (token: string, membershipId: string) =>
      call(`/v1/team/members/${membershipId}/credential`, {
        method: 'PUT',
        token,
        teamId: crewId,
        json: { credential: 'chw', reason: 'License lapsed' },
      });
    const credentialChanges = () => h.scratch.owner<
      { membershipId: string; oldValue: unknown; newValue: unknown; reason: string; changedBy: string }[]
    >`
      select membership_id as "membershipId", old_value as "oldValue", new_value as "newValue", reason,
             changed_by as "changedBy"
      from sineobex.membership_changes
      where team_id = ${crewId} and kind = 'credential' order by changed_at`;
    const credentialEvents = () => h.scratch.owner<
      { actorUserId: string; entityId: string; details: Record<string, unknown> }[]
    >`
      select actor_user_id as "actorUserId", entity_id as "entityId", details from sineobex.audit_events
      where team_id = ${crewId} and action = 'membership.credential_changed' order by id`;

    // A Program Admin who is not an owner changes neither another Program Admin's credential nor
    // their own.
    for (const [target, fields] of [
      [quinn, quinnFields],
      [pam, pamFields],
    ] as const) {
      const refused = await lower(pam.token, target.membershipId);
      expect(refused.status).toBe(403);
      expect(refused.body.error?.code).toBe('owner_only');
      const still = await call(`/v1/team/members/${target.membershipId}`, {
        token: pam.token,
        teamId: crewId,
      });
      expect(still.body).toMatchObject({ credential: 'attending', credentialFields: fields });
    }
    expect(await credentialChanges()).toEqual([]);
    expect(await credentialEvents()).toEqual([]);

    // An owner reaches the route only as an active member of the team with team.manage_users.
    expect((await lower(ownerToken, quinn.membershipId)).body.error?.code).toBe('not_a_member');
    const managers = await call('/v1/team/roles', {
      method: 'POST',
      token: pam.token,
      teamId: crewId,
      json: { name: 'Member managers', permissions: ['team.manage_users'] },
    });
    expect(managers.status).toBe(201);
    const joined = await call('/v1/team/members', {
      method: 'POST',
      token: pam.token,
      teamId: crewId,
      json: { email: 'sarah@example.com', displayName: 'Sarah', roleId: managers.body.id },
    });
    expect(joined.status).toBe(201);
    const ownerId = joined.body.userId as string;
    const changed = await lower(ownerToken, quinn.membershipId);
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ credential: 'chw', direction: 'down', credentialFields: {} });
    expect(await credentialEvents()).toEqual([
      {
        actorUserId: ownerId,
        entityId: quinn.membershipId,
        details: {
          userId: quinn.userId,
          from: 'attending',
          to: 'chw',
          direction: 'down',
          reason: 'License lapsed',
        },
      },
    ]);
    expect(await credentialChanges()).toEqual([
      {
        membershipId: quinn.membershipId,
        oldValue: { credential: 'attending', fields: quinnFields },
        newValue: { credential: 'chw', fields: {} },
        reason: 'License lapsed',
        changedBy: ownerId,
      },
    ]);
  });

  it('keeps at least one Program Admin on every team', async () => {
    const members = await call('/v1/team/members', { token: mercyToken, teamId });
    const mercy = (members.body as unknown as { email: string; membershipId: string }[]).find(
      (m) => m.email === 'mercy@example.com',
    )!;
    const r = await call(`/v1/owner/teams/${teamId}/members/${mercy.membershipId}/remove`, {
      method: 'POST',
      token: ownerToken,
      json: { reason: 'Testing the guard' },
    });
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe('last_admin');
  });

  it('refuses a role without the permission on the server, and logs the refusal', async () => {
    const staffToken = await h.tokenFor('brooke@example.com');
    const brooke = await h.scratch.owner<
      { id: string }[]
    >`select id from sineobex.users where email = 'brooke@example.com'`;
    await h.acknowledge(brooke[0]!.id);
    const r = await call('/v1/team/members', { token: staffToken, teamId });
    expect(r.status).toBe(403);
    const denials = await auditActions(mercyToken, teamId, 'access.denied');
    expect(denials[0]!.details).toMatchObject({ permission: 'team.manage_users', route: '/v1/team/members' });
  });

  it('cuts a removed person off at once, and disables their sign-in', async () => {
    const m = await call('/v1/team/members', {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: { email: 'temp@example.com', displayName: 'Temp', roleId: roles.healthcare_staff },
    });
    const temp = await h.scratch.owner<
      { id: string }[]
    >`select id from sineobex.users where email = 'temp@example.com'`;
    await h.acknowledge(temp[0]!.id);
    const tempToken = await h.tokenFor('temp@example.com');
    expect((await call('/v1/team/roles', { token: tempToken, teamId })).status).toBe(403); // no permission, but a member

    const removed = await call(`/v1/team/members/${m.body.membershipId}/remove`, {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: { reason: 'Left the program' },
    });
    expect(removed.body.status).toBe('removed');
    // The same, still-unexpired token is refused now.
    const after = await call('/v1/me', { token: tempToken });
    expect(after.status).toBe(403);
    expect(after.body.error?.code).toBe('account_disabled');
    expect(h.identityAdmin.identities.get('temp@example.com')?.disabled).toBe(true);
  });

  it('keeps teams apart even when someone passes another team id', async () => {
    const r = await call('/v1/team/members', { token: mercyToken, teamId: otherTeamId });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('not_a_member');
  });

  it('requires MFA for team data, while /v1/me says what is missing', async () => {
    const aal1 = await h.tokenFor('mercy@example.com', { aal: 'aal1' });
    expect((await call('/v1/team/members', { token: aal1, teamId })).body.error?.code).toBe('mfa_required');
    const me = await call('/v1/me', { token: aal1 });
    expect(me.status).toBe(200);
    expect(me.body.mfa).toEqual({ required: true, satisfied: false });
  });

  it('requires a recent sign-in for admin actions', async () => {
    const stale = await h.tokenFor('mercy@example.com', {
      authTime: new Date(h.clock.now.getTime() - 20 * 60_000),
    });
    const r = await call('/v1/team/members', {
      method: 'POST',
      token: stale,
      teamId,
      json: { email: 'x@example.com', displayName: 'X', roleId: roles.healthcare_staff },
    });
    expect(r.body.error?.code).toBe('reauth_required');
    // Reading still works.
    expect((await call('/v1/team/members', { token: stale, teamId })).status).toBe(200);
  });

  it('asks for the Terms of Use and confidentiality acknowledgement before any team data', async () => {
    await call('/v1/team/members', {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: { email: 'newbie@example.com', displayName: 'Newbie', roleId: roles.healthcare_staff },
    });
    const token = await h.tokenFor('newbie@example.com');
    const blocked = await call('/v1/team/roles', { token, teamId });
    expect(blocked.body.error?.code).toBe('acknowledgement_required');
    const me = await call('/v1/me', { token });
    const pending = me.body.pendingAcknowledgements as { kind: string; version: string }[];
    expect(pending.map((p) => p.kind).sort()).toEqual(['confidentiality', 'terms_of_use']);
    for (const p of pending) {
      expect((await call('/v1/me/acknowledgements', { method: 'POST', token, json: p })).status).toBe(200);
    }
    expect((await call('/v1/me', { token })).body.pendingAcknowledgements).toEqual([]);
  });

  it('refuses people who were never invited, and bad tokens', async () => {
    const stranger = await h.token({ subject: 'nobody' });
    expect((await call('/v1/me', { token: stranger })).body.error?.code).toBe('not_invited');
    expect((await call('/v1/me', { token: 'not.a.jwt' })).status).toBe(401);
    expect((await call('/v1/me')).status).toBe(401);
    const wrongIssuer = await h.token({ subject: 'owner|sarah@example.com', issuer: 'https://evil.example' });
    expect((await call('/v1/me', { token: wrongIssuer })).status).toBe(401);
  });

  it('lets only owners use the owner console', async () => {
    const r = await call('/v1/owner/teams', { token: mercyToken });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('owner_only');
  });

  it('builds custom roles only from existing permissions', async () => {
    const bad = await call('/v1/team/roles', {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: { name: 'Driver', permissions: ['routes.view', 'routes.teleport'] },
    });
    expect(bad.status).toBe(422);
    const good = await call('/v1/team/roles', {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: { name: 'Driver', permissions: ['routes.view', 'patients.view'] },
    });
    expect(good.status).toBe(201);
    expect(good.body).toMatchObject({
      name: 'Driver',
      isStandard: false,
      permissions: ['routes.view', 'patients.view'],
    });
    // A long name still makes a key the database accepts (41 characters at most).
    const long = await call('/v1/team/roles', {
      method: 'POST',
      token: mercyToken,
      teamId,
      json: { name: 'Healthcare Staff + Review duplicates', permissions: ['patients.view'] },
    });
    expect(long.status).toBe(201);
    expect(long.body.key).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
    const standard = await call(`/v1/team/roles/${roles.logistics}`, {
      method: 'PUT',
      token: mercyToken,
      teamId,
      json: { name: 'Logistics+', permissions: ['patients.view'] },
    });
    expect(standard.body.error?.code).toBe('standard_role');
  });

  it('keeps the permission catalog in step with the database', async () => {
    const [row] = await h.scratch.owner<{ p: string[] }[]>`select sineobex.known_permissions() as p`;
    expect([...row!.p].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('records each new session once, and the chain verifies', async () => {
    const token = await h.tokenFor('mercy@example.com', { sessionId: 'session-xyz' });
    await call('/v1/me', { token });
    await call('/v1/me', { token });
    const sessions = await h.scratch
      .owner`select * from sineobex.sessions_seen where session_id = 'session-xyz'`;
    expect(sessions).toHaveLength(1);
    const verified = await call('/v1/team/audit/verify', { method: 'POST', token: mercyToken, teamId });
    expect(verified.body).toMatchObject({ ok: true, problem: null });
    expect(verified.body.checked as number).toBeGreaterThan(5);
  });
});
