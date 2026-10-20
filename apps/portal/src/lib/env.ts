// Server-side configuration. Read only in server code; nothing here reaches the browser bundle.
import 'server-only';

export type PortalEnv = 'local' | 'test' | 'preview' | 'pilot' | 'production';
const KINDS: readonly PortalEnv[] = ['local', 'test', 'preview', 'pilot', 'production'];

export function portalEnv(): PortalEnv {
  const v = process.env.PORTAL_ENV ?? 'local';
  if (!KINDS.includes(v as PortalEnv)) throw new Error('PORTAL_ENV is not a known environment');
  return v as PortalEnv;
}

/** Local and preview deployments may only hold made-up patients; every page says so. */
export function isDemo(env: PortalEnv = portalEnv()): boolean {
  return env === 'local' || env === 'test' || env === 'preview';
}

export function apiBaseUrl(): string {
  return process.env.API_URL ?? 'http://localhost:8787';
}
