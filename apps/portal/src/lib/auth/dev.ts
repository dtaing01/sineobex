import 'server-only';
import { AuthError, type AuthProvider, type Tokens } from './types';

/**
 * Talks to tools/dev-idp.mjs: a local identity provider for development and end-to-end tests
 * only. The portal refuses to use it outside the local and test environments (see index.ts).
 */
export function createDevAuth(options: { url: string; fetch?: typeof fetch }): AuthProvider {
  const f = options.fetch ?? fetch;
  async function post(path: string, body: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    let res: Response;
    try {
      res = await f(`${options.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new AuthError('unavailable', 'The local sign-in service is not running (pnpm dev:idp).');
    }
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }
  const toTokens = (j: Record<string, unknown>): Tokens => ({
    accessToken: String(j.access_token),
    refreshToken: String(j.refresh_token),
    expiresAt: Date.now() + Number(j.expires_in) * 1000,
  });

  return {
    kind: 'dev',
    async signIn(email, password) {
      const r = await post('/token', { grant_type: 'password', email, password });
      if (!r.ok) throw new AuthError('invalid_credentials', 'That email and password don’t match.');
      const tokens = toTokens(r.json);
      return r.json.mfa === 'enroll'
        ? { status: 'mfa_enroll', tokens }
        : { status: 'mfa_challenge', tokens, factorId: 'dev-totp' };
    },
    async startEnrollment() {
      return {
        factorId: 'dev-totp',
        qrImage:
          'data:image/svg+xml;base64,' +
          btoa(
            '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#fff"/><text x="12" y="84" font-size="14">dev: use 000000</text></svg>',
          ),
        secret: 'DEVDEVDEVDEVDEVD',
      };
    },
    async verifyMfa(tokens, _factorId, code) {
      const r = await post('/mfa/verify', { access_token: tokens.accessToken, code });
      if (!r.ok)
        throw new AuthError(
          'invalid_code',
          'That code didn’t work. Check your authenticator app and try the newest code.',
        );
      return toTokens(r.json);
    },
    async refresh(refreshToken) {
      const r = await post('/token', { grant_type: 'refresh_token', refresh_token: refreshToken });
      if (!r.ok) throw new AuthError('session_expired', 'Your session ended. Sign in again.');
      return toTokens(r.json);
    },
    async signOut() {},
  };
}
