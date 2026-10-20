import type { SessionOptions } from 'iron-session';
import type { Tokens } from './auth/types';

export const SESSION_COOKIE = 'sx-session';
/** Module 9, desktop: "auto-lock after 15 minutes idle". */
export const IDLE_MINUTES = 15;
/** Warn this long before the idle sign-out, so people can stay signed in (WCAG 2.2.1). */
export const IDLE_WARNING_SECONDS = 120;
/** However active, a session ends after a working day. */
export const MAX_SESSION_HOURS = 12;
/** Refresh the access token when it has less than this left. */
export const REFRESH_MARGIN_MS = 5 * 60_000;

export interface SessionData {
  /** Present once the person has passed MFA. */
  tokens: Tokens;
  /** Between password and MFA. Never usable for API calls that need aal2. */
  pending: {
    tokens: Tokens;
    factorId: string | null;
    enrollment?: { factorId: string; qrImage: string; secret: string };
  };
  /** The verified authenticator, for re-authentication before admin actions. */
  factorId: string;
  teamId: string;
  lastActivity: number;
  startedAt: number;
}

export function sessionOptions(): SessionOptions {
  const env = process.env.PORTAL_ENV ?? 'local';
  const secret =
    process.env.SESSION_SECRET ??
    (['local', 'test'].includes(env) ? 'local-only-session-secret-not-for-deploy-0000' : '');
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return {
    cookieName: SESSION_COOKIE,
    password: secret,
    ttl: MAX_SESSION_HOURS * 3600,
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
  };
}

export type IdleState = 'active' | 'idle' | 'too_old';

export function idleState(s: Partial<SessionData>, now: number): IdleState {
  if (!s.startedAt || now - s.startedAt > MAX_SESSION_HOURS * 3600_000) return 'too_old';
  if (!s.lastActivity || now - s.lastActivity > IDLE_MINUTES * 60_000) return 'idle';
  return 'active';
}
