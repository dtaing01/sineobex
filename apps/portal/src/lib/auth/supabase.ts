import 'server-only';
import { AuthError, type AuthProvider, type Tokens } from './types';

/**
 * Supabase Auth over its REST API, called only from the portal's server. Used for sign-in alone:
 * the portal never reads or writes Supabase tables (enforced by the PHI guard).
 */
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: { factors?: { id: string; factor_type: string; status: string }[] };
}

export function createSupabaseAuth(options: {
  url: string;
  anonKey: string;
  fetch?: typeof fetch;
}): AuthProvider {
  const f = options.fetch ?? fetch;
  const base = `${options.url.replace(/\/$/, '')}/auth/v1`;
  const headers = (token?: string) => ({
    apikey: options.anonKey,
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  const toTokens = (t: TokenResponse): Tokens => ({
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  });

  async function post<T>(
    path: string,
    body: unknown,
    token?: string,
  ): Promise<{ ok: boolean; status: number; json: T }> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new AuthError('unavailable', 'Sign-in is unavailable right now. Try again in a minute.');
    }
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, json };
  }

  return {
    kind: 'supabase',
    async signIn(email, password) {
      const r = await post<TokenResponse>('/token?grant_type=password', { email, password });
      if (!r.ok) {
        if (r.status === 400 || r.status === 401)
          throw new AuthError('invalid_credentials', 'That email and password don’t match.');
        throw new AuthError('unavailable', 'Sign-in is unavailable right now. Try again in a minute.');
      }
      const tokens = toTokens(r.json);
      const factor = r.json.user?.factors?.find((x) => x.factor_type === 'totp' && x.status === 'verified');
      return factor
        ? { status: 'mfa_challenge', tokens, factorId: factor.id }
        : { status: 'mfa_enroll', tokens };
    },
    async startEnrollment(tokens) {
      const r = await post<{ id: string; totp?: { qr_code: string; secret: string } }>(
        '/factors',
        { factor_type: 'totp', friendly_name: `Sineobex ${new Date().toISOString().slice(0, 10)}` },
        tokens.accessToken,
      );
      if (!r.ok || !r.json.totp)
        throw new AuthError('unavailable', 'Couldn’t start authenticator setup. Try again.');
      return { factorId: r.json.id, qrImage: r.json.totp.qr_code, secret: r.json.totp.secret };
    },
    async verifyMfa(tokens, factorId, code) {
      const challenge = await post<{ id: string }>(
        `/factors/${encodeURIComponent(factorId)}/challenge`,
        {},
        tokens.accessToken,
      );
      if (!challenge.ok) throw new AuthError('session_expired', 'Your sign-in expired. Start again.');
      const verify = await post<TokenResponse>(
        `/factors/${encodeURIComponent(factorId)}/verify`,
        { challenge_id: challenge.json.id, code },
        tokens.accessToken,
      );
      if (!verify.ok)
        throw new AuthError(
          'invalid_code',
          'That code didn’t work. Check your authenticator app and try the newest code.',
        );
      return toTokens(verify.json);
    },
    async refresh(refreshToken) {
      const r = await post<TokenResponse>('/token?grant_type=refresh_token', { refresh_token: refreshToken });
      if (!r.ok) throw new AuthError('session_expired', 'Your session ended. Sign in again.');
      return toTokens(r.json);
    },
    async signOut(tokens) {
      await post('/logout?scope=local', {}, tokens.accessToken).catch(() => undefined);
    },
  };
}
