/**
 * Provider-side account management: create the sign-in identity when someone is invited, and
 * disable it when they are removed. The API binds each user row to the identity's subject at
 * invite time, so a sign-in is never matched to a person by email alone.
 *
 * Supabase Auth in the preview; Amazon Cognito in production (phase 12, AdminCreateUser,
 * AdminDisableUser, AdminUserGlobalSignOut). Tests and local development use the in-memory one.
 */
export interface ProviderIdentity {
  issuer: string;
  subject: string;
}

export interface IdentityAdmin {
  /** Creates the identity and sends the invitation, or returns the existing identity for this email. */
  inviteOrFind(email: string, displayName: string): Promise<ProviderIdentity>;
  /** Blocks sign-in and revokes refresh tokens. Access tokens die at the API at once anyway. */
  disable(identity: ProviderIdentity): Promise<void>;
  enable(identity: ProviderIdentity): Promise<void>;
}

export class IdentityAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityAdminError';
  }
}

export function createSupabaseIdentityAdmin(options: {
  url: string;
  serviceRoleKey: string;
  redirectTo?: string;
  fetch?: typeof fetch;
}): IdentityAdmin {
  const f = options.fetch ?? fetch;
  const base = options.url.replace(/\/$/, '');
  const issuer = `${base}/auth/v1`;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    'content-type': 'application/json',
  };

  async function findByEmail(email: string): Promise<string | null> {
    // The admin API pages through users; teams are small, so a bounded scan is acceptable.
    for (let page = 1; page <= 20; page++) {
      const res = await f(`${issuer}/admin/users?page=${page}&per_page=200`, { headers });
      if (!res.ok) throw new IdentityAdminError(`listing identities failed (${res.status})`);
      const body = (await res.json()) as { users?: { id: string; email?: string }[] };
      const users = body.users ?? [];
      const hit = users.find((u) => u.email?.toLowerCase() === email);
      if (hit) return hit.id;
      if (users.length < 200) return null;
    }
    return null;
  }

  return {
    async inviteOrFind(email, displayName) {
      const res = await f(`${issuer}/invite`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          data: { display_name: displayName },
          ...(options.redirectTo ? { redirect_to: options.redirectTo } : {}),
        }),
      });
      if (res.ok) {
        const user = (await res.json()) as { id: string };
        return { issuer, subject: user.id };
      }
      if (res.status === 422 || res.status === 409) {
        const existing = await findByEmail(email);
        if (existing) return { issuer, subject: existing };
      }
      throw new IdentityAdminError(`invitation failed (${res.status})`);
    },
    async disable(identity) {
      const res = await f(`${issuer}/admin/users/${encodeURIComponent(identity.subject)}`, {
        method: 'PUT',
        headers,
        // A long ban blocks sign-in and invalidates refresh tokens.
        body: JSON.stringify({ ban_duration: '876000h' }),
      });
      if (!res.ok) throw new IdentityAdminError(`disabling identity failed (${res.status})`);
    },
    async enable(identity) {
      const res = await f(`${issuer}/admin/users/${encodeURIComponent(identity.subject)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ban_duration: 'none' }),
      });
      if (!res.ok) throw new IdentityAdminError(`enabling identity failed (${res.status})`);
    },
  };
}

/** In-memory provider for tests and local development with the dev identity provider. */
export function createMemoryIdentityAdmin(issuer: string): IdentityAdmin & {
  identities: Map<string, { subject: string; disabled: boolean; displayName: string }>;
} {
  const identities = new Map<string, { subject: string; disabled: boolean; displayName: string }>();
  return {
    identities,
    async inviteOrFind(email, displayName) {
      let entry = identities.get(email);
      if (!entry) {
        entry = { subject: `dev|${crypto.randomUUID()}`, disabled: false, displayName };
        identities.set(email, entry);
      }
      return { issuer, subject: entry.subject };
    },
    async disable(identity) {
      for (const entry of identities.values()) if (entry.subject === identity.subject) entry.disabled = true;
    },
    async enable(identity) {
      for (const entry of identities.values()) if (entry.subject === identity.subject) entry.disabled = false;
    },
  };
}
