import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { canonicalJson, valueHash } from '../src/sync/canonical.ts';
import type { Harness } from './harness.ts';

export type Json = Record<string, unknown> & { error?: { code: string; details?: Record<string, unknown> } };

export async function call(h: Harness, path: string, init: Parameters<Harness['request']>[1] = {}) {
  const res = await h.request(path, init);
  return { status: res.status, body: (await res.json()) as Json };
}

const b64u = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64url');

/** A phone: its key, its sequence counter, and helpers to build and sign what it sends. */
export class FakePhone {
  readonly deviceId = randomUUID();
  seq = 0;
  private constructor(
    private readonly keys: CryptoKeyPair,
    readonly publicKey: string,
  ) {}

  static async create(): Promise<FakePhone> {
    const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const raw = await crypto.subtle.exportKey('raw', keys.publicKey);
    return new FakePhone(keys, b64u(raw));
  }

  async sign(payload: unknown): Promise<string> {
    const sig = await crypto.subtle.sign(
      'Ed25519',
      this.keys.privateKey,
      new TextEncoder().encode(canonicalJson(payload)),
    );
    return b64u(sig);
  }

  async signed<P extends Record<string, unknown>>(payload: P) {
    return { payload, signature: await this.sign(payload) };
  }

  async change(c: {
    entity: 'encounter' | 'encounter_note' | 'audit';
    recordId?: string;
    op: 'create' | 'set' | 'append';
    field?: string;
    value: unknown;
    baseVersion?: number;
    follows?: string;
    supersedes?: string;
    conflictOf?: string;
    resolution?: 'replace' | 'keep_server';
    deviceTime?: string;
    correctedTime?: string;
    clockVerified?: boolean;
  }) {
    return {
      changeId: randomUUID(),
      seq: ++this.seq,
      recordId: c.recordId ?? randomUUID(),
      baseVersion: 0,
      deviceTime: '2026-10-20T14:50:00.000Z',
      clockVerified: true,
      ...c,
      valueHash: await valueHash(c.value),
    };
  }
}

export interface Team {
  teamId: string;
  ownerToken: string;
  /** Program Admin, signed in just now (admin actions need a recent sign-in). */
  adminToken: string;
  adminId: string;
  /** Two clinicians who chart. */
  aToken: string;
  aId: string;
  bToken: string;
  bId: string;
  /** Community health worker: no encounters.chart. */
  chwToken: string;
  chwId: string;
  aMembershipId: string;
}

async function userId(h: Harness, email: string): Promise<string> {
  const rows = await h.scratch.owner<{ id: string }[]>`select id from sineobex.users where email = ${email}`;
  return rows[0]!.id;
}

export async function setupTeam(h: Harness): Promise<Team> {
  await h.seedOwner('owner@example.com', 'Owner (demo)');
  const ownerToken = await h.tokenFor('owner@example.com');
  const team = await call(h, '/v1/owner/teams', {
    method: 'POST',
    token: ownerToken,
    json: { name: 'Sync Team' },
  });
  expect(team.status).toBe(201);
  const teamId = team.body.id as string;
  const admin = await call(h, `/v1/owner/teams/${teamId}/program-admins`, {
    method: 'POST',
    token: ownerToken,
    json: { email: 'admin@example.com', displayName: 'Alex (demo)' },
  });
  expect(admin.status).toBe(201);
  const adminId = await userId(h, 'admin@example.com');
  await h.acknowledge(adminId);
  const adminToken = await h.tokenFor('admin@example.com');

  const asAdmin = { teamId, adminToken };
  // Credentials don't affect sync until signing (phase 4).
  const a = await addMember(h, asAdmin, 'jordan@example.com', 'Jordan (demo)');
  const b = await addMember(h, asAdmin, 'casey@example.com', 'Casey (demo)');
  const chw = await addMember(h, asAdmin, 'sam@example.com', 'Sam (demo)', 'community_health_worker', 'chw');
  return {
    teamId,
    ownerToken,
    adminToken,
    adminId,
    aToken: a.token,
    aId: a.id,
    bToken: b.token,
    bId: b.id,
    chwToken: chw.token,
    chwId: chw.id,
    aMembershipId: a.membershipId,
  };
}

/** Another team, after setupTeam: its admin and one clinician with a registered phone. */
export async function secondTeam(h: Harness) {
  const ownerToken = await h.tokenFor('owner@example.com');
  const team = await call(h, '/v1/owner/teams', {
    method: 'POST',
    token: ownerToken,
    json: { name: 'Second Team' },
  });
  expect(team.status).toBe(201);
  const teamId = team.body.id as string;
  const admin = await call(h, `/v1/owner/teams/${teamId}/program-admins`, {
    method: 'POST',
    token: ownerToken,
    json: { email: 'second-admin@example.com', displayName: 'Morgan (demo)' },
  });
  expect(admin.status).toBe(201);
  await h.acknowledge(await userId(h, 'second-admin@example.com'));
  const adminToken = await h.tokenFor('second-admin@example.com');
  const member = await addMember(h, { teamId, adminToken }, 'second-staff@example.com', 'Taylor (demo)');
  const phone = await FakePhone.create();
  await register(h, phone, member.token, teamId);
  return { teamId, token: member.token, phone };
}

/** An admin moves a member to another role (by its key), as the members page does. */
export async function setRole(
  h: Harness,
  team: { teamId: string; adminToken: string },
  membershipId: string,
  role: string,
) {
  const roles = await call(h, '/v1/team/roles', { token: team.adminToken, teamId: team.teamId });
  const roleId = (roles.body as unknown as { key: string; id: string }[]).find((r) => r.key === role)!.id;
  const r = await call(h, `/v1/team/members/${membershipId}/role`, {
    method: 'PUT',
    token: team.adminToken,
    teamId: team.teamId,
    json: { roleId, reason: 'Covering another desk for a day' },
  });
  expect(r.status).toBe(200);
}

/** A member the team's admin invited, who accepted the acknowledgements. */
export async function addMember(
  h: Harness,
  team: { teamId: string; adminToken: string },
  email: string,
  displayName: string,
  role = 'healthcare_staff',
  credential = 'none',
) {
  const roles = await call(h, '/v1/team/roles', { token: team.adminToken, teamId: team.teamId });
  const roleId = (roles.body as unknown as { key: string; id: string }[]).find((r) => r.key === role)!.id;
  const r = await call(h, '/v1/team/members', {
    method: 'POST',
    token: team.adminToken,
    teamId: team.teamId,
    json: { email, displayName, roleId, credential },
  });
  expect(r.status).toBe(201);
  const id = await userId(h, email);
  await h.acknowledge(id);
  return { id, token: await h.tokenFor(email), membershipId: r.body.membershipId as string };
}

/** A person removed from the team while their phones were offline: only the phones' keys work now. */
export async function removedPhones(h: Harness, t: Team, email: string, displayName: string, count: number) {
  const member = await addMember(h, t, email, displayName);
  const phones: FakePhone[] = [];
  for (let i = 0; i < count; i++) {
    const phone = await FakePhone.create();
    await register(h, phone, member.token, t.teamId);
    phones.push(phone);
  }
  const removed = await call(h, `/v1/team/members/${member.membershipId}/remove`, {
    method: 'POST',
    token: t.adminToken,
    teamId: t.teamId,
    json: { reason: 'Left the program' },
  });
  expect(removed.status).toBe(200);
  return { phones, userId: member.id };
}

/** A phone whose person was removed from the team while it was offline: only its key works now. */
export async function removedPhone(h: Harness, t: Team, email: string, displayName: string) {
  const { phones, userId } = await removedPhones(h, t, email, displayName, 1);
  return { phone: phones[0]!, userId };
}

/** A removed person's phone handing its unsynced work to quarantine, signed with its key. */
export async function handOver(h: Harness, phone: FakePhone, changes: unknown[]) {
  return call(h, `/v1/devices/${phone.deviceId}/quarantine`, {
    method: 'POST',
    json: await phone.signed({ purpose: 'quarantine', deviceId: phone.deviceId, changes }),
  });
}

export async function register(h: Harness, phone: FakePhone, token: string, teamId: string) {
  const r = await call(h, '/v1/devices', {
    method: 'POST',
    token,
    teamId,
    json: { deviceId: phone.deviceId, platform: 'android', appVersion: '0.2.0', publicKey: phone.publicKey },
  });
  expect([200, 201]).toContain(r.status);
  return r;
}

export async function push(
  h: Harness,
  phone: FakePhone,
  token: string,
  teamId: string,
  changes: unknown[],
  options: { deviceTime?: string; counts?: Record<string, number>; oldest?: string } = {},
) {
  return call(h, '/v1/sync/push', {
    method: 'POST',
    token,
    teamId,
    json: {
      deviceId: phone.deviceId,
      clock: { deviceTime: options.deviceTime ?? h.clock.now.toISOString() },
      unsynced: { counts: options.counts ?? { encounters: changes.length }, oldest: options.oldest },
      changes,
    },
  });
}

export type Result = {
  changeId: string;
  status: string;
  serverVersion?: number;
  hash?: string;
  reason?: string;
  details?: Record<string, unknown>;
  server?: { value: unknown; version: number; changedBy: string | null };
  quarantined?: boolean;
};

export const results = (body: Json) => body.results as Result[];
