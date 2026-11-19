import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { RECENT_AUTH_MINUTES } from '../src/auth/context.ts';
import { createOidcVerifier } from '../src/auth/verifier.ts';

// tools/dev-idp.mjs, the local identity provider of the end-to-end tests, has one test-only hook
// (unit L6): with DEV_IDP_TEST_HOOKS=1, POST /test/stale-sign-in { email, minutes } dates that
// person's next sign-in back, so an end-to-end test can take an export through /reauth. The API
// reads the sign-in as the tokens say (verifier.ts), so this holds it there. Off, the hook is not
// there. Every person here is made up.

const IDP = fileURLToPath(new URL('../../../tools/dev-idp.mjs', import.meta.url));
const AUDIENCE = 'sineobex-local';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

let running: ChildProcess | undefined;
afterEach(() => {
  running?.kill();
  running = undefined;
});

/** Starts the identity provider on a free port, the hooks on or off, and answers its address. */
async function startIdp(hooks: boolean): Promise<string> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, DEV_IDP_PORT: String(port) };
  delete env.DEV_IDP_TEST_HOOKS;
  if (hooks) env.DEV_IDP_TEST_HOOKS = '1';
  running = spawn(process.execPath, [IDP], { env, stdio: 'ignore' });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${url}/.well-known/jwks.json`)).ok) return url;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the identity provider did not start');
}

const post = (url: string, path: string, body: unknown) =>
  fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A sign-in as the portal makes it (apps/portal/src/lib/auth/dev.ts): password, then MFA. */
async function signIn(url: string, email: string): Promise<string> {
  const first = await post(url, '/token', { grant_type: 'password', email, password: 'sineobex-demo' });
  expect(first.status).toBe(200);
  const { access_token } = (await first.json()) as { access_token: string };
  const mfa = await post(url, '/mfa/verify', { access_token, code: '000000' });
  expect(mfa.status).toBe(200);
  return ((await mfa.json()) as { access_token: string }).access_token;
}

/** How long ago the API reads the person's sign-in as, in minutes. */
async function minutesAgo(url: string, token: string): Promise<number> {
  const verified = await createOidcVerifier({
    issuer: url,
    audience: AUDIENCE,
    jwksUrl: `${url}/.well-known/jwks.json`,
  }).verify(token);
  return (Date.now() - verified.authTime!.getTime()) / 60_000;
}

describe('the dev identity provider’s test hook', () => {
  it('with DEV_IDP_TEST_HOOKS=1, dates the person’s next sign-in back, and that one only', async () => {
    const url = await startIdp(true);
    expect((await post(url, '/test/stale-sign-in', { email: 'ana@example.com', minutes: 60 })).status).toBe(
      200,
    );
    // Signed in an hour ago, as the API reads it: older than a recent sign-in.
    const stale = await minutesAgo(url, await signIn(url, 'Ana@Example.com'));
    expect(stale).toBeGreaterThan(59);
    expect(stale).toBeLessThan(61);
    expect(stale).toBeGreaterThan(RECENT_AUTH_MINUTES);
    // Signing in again (the portal's /reauth) is fresh, and nobody else was touched.
    expect(await minutesAgo(url, await signIn(url, 'ana@example.com'))).toBeLessThan(1);
    expect(await minutesAgo(url, await signIn(url, 'rae@example.com'))).toBeLessThan(1);
  });

  it('takes an email and a whole number of minutes, up to a day, and nothing else', async () => {
    const url = await startIdp(true);
    for (const body of [
      {},
      { email: 'ana@example.com' },
      { email: 'ana@example.com', minutes: 0 },
      { email: '', minutes: 5 },
      { email: 'ana@example.com', minutes: 1441 },
      { email: 'ana@example.com', minutes: 2.5 },
    ]) {
      expect((await post(url, '/test/stale-sign-in', body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('is not there without DEV_IDP_TEST_HOOKS=1', async () => {
    const url = await startIdp(false);
    expect((await post(url, '/test/stale-sign-in', { email: 'ana@example.com', minutes: 60 })).status).toBe(
      404,
    );
    expect(await minutesAgo(url, await signIn(url, 'ana@example.com'))).toBeLessThan(1);
  });
});
