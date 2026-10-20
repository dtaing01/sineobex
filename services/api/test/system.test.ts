import { createScratchDatabase } from '@sineobex/db/testing';
import { migrate, setEnvironment } from '@sineobex/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { assertDatabaseMatches } from '../src/entry/bootstrap.ts';
import { createLogger, sanitize } from '../src/lib/log.ts';
import { createHarness, type Harness } from './harness.ts';

describe('system routes', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it('reports health and flags the deployment as demo', async () => {
    const res = await h.request('/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', environment: 'test', demo: true, release: 'dev' });
  });

  it('returns server time from the injected clock', async () => {
    const res = await h.request('/v1/time');
    expect(await res.json()).toEqual({ serverTime: '2026-10-20T15:00:00.000Z', epochMs: Date.parse('2026-10-20T15:00:00.000Z') });
  });

  it('sends no-store and security headers on every response', async () => {
    for (const path of ['/v1/health', '/v1/does-not-exist']) {
      const res = await h.request(path);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('strict-transport-security')).toContain('max-age=63072000');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(res.headers.get('x-request-id')).toBeTruthy();
    }
  });

  it('answers unknown routes with a JSON 404', async () => {
    const res = await h.request('/v1/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });

  it('publishes the OpenAPI document outside production', async () => {
    const res = await h.request('/openapi.json');
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/v1/health');
  });
});

describe('logger', () => {
  it('drops keys that are not on the allowlist', () => {
    expect(sanitize({ requestId: 'r1', patientName: 'Marcus T.', dob: '1946-01-01', status: 200 })).toEqual({
      requestId: 'r1',
      status: 200,
      droppedFields: 2,
    });
  });

  it('writes one JSON line per event', () => {
    const lines: string[] = [];
    createLogger({ sink: (l) => lines.push(l) }).info('request', { route: '/v1/health', body: '{"secret":1}' });
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({ level: 'info', event: 'request', route: '/v1/health', droppedFields: 1 });
    expect(lines[0]).not.toContain('secret');
  });
});

describe('configuration', () => {
  const base = {
    APP_ENV: 'preview',
    DATABASE_URL: 'postgres://u:p@h/db',
    OIDC_ISSUER: 'https://x.supabase.co/auth/v1',
    OIDC_AUDIENCE: 'authenticated',
    OIDC_JWKS_URL: 'https://x.supabase.co/auth/v1/.well-known/jwks.json',
  };

  it('refuses to turn off MFA outside local and test', () => {
    expect(() => loadConfig({ ...base, MFA_MODE: 'none' })).toThrow(/MFA_MODE=none/);
  });

  it('never echoes configuration values in errors', () => {
    try {
      loadConfig({ ...base, OIDC_ISSUER: 'not a url with password hunter2' });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).toContain('OIDC_ISSUER');
      expect(String(err)).not.toContain('hunter2');
    }
  });
});

describe('startup environment check', () => {
  it('refuses a demo deployment against a pilot database, and the reverse', async () => {
    const scratch = await createScratchDatabase({ migrate: true });
    try {
      // The scratch database is marked "test" (demo).
      await expect(assertDatabaseMatches(scratch.owner, 'production')).rejects.toThrow(/refusing to start/);
      await expect(assertDatabaseMatches(scratch.owner, 'preview')).resolves.toBeUndefined();
    } finally {
      await scratch.drop();
    }
    const pilot = await createScratchDatabase({ migrate: false });
    try {
      await migrate(pilot.owner);
      await setEnvironment(pilot.owner, 'pilot');
      await expect(assertDatabaseMatches(pilot.owner, 'preview')).rejects.toThrow(/refusing to start/);
      await expect(assertDatabaseMatches(pilot.owner, 'pilot')).resolves.toBeUndefined();
    } finally {
      await pilot.drop();
    }
  });
});
