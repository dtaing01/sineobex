#!/usr/bin/env node
// A tiny OIDC-style identity provider for local development and end-to-end tests ONLY.
//
// It signs ES256 access tokens shaped like Supabase Auth's (aal, amr, session_id), so the API's
// real verification path runs unchanged. Password is the same for everyone (DEV_IDP_PASSWORD,
// default "sineobex-demo") and the MFA code is always 000000. It listens on 127.0.0.1 only and
// refuses to start when NODE_ENV=production. Never deploy it.
//
// With DEV_IDP_TEST_HOOKS=1, which apps/portal/playwright.config.ts alone sets, it takes one test
// hook: POST /test/stale-sign-in { email, minutes } dates that person's next sign-in back by that
// many minutes, so an end-to-end test can take an export through /reauth. The sign-in after it is
// fresh, as /reauth's is. Without the variable the path does not exist.
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, createLocalJWKSet } from 'jose';

if (process.env.NODE_ENV === 'production') {
  console.error('dev-idp refuses to run with NODE_ENV=production');
  process.exit(1);
}

const PORT = Number(process.env.DEV_IDP_PORT ?? 8790);
const ISSUER = process.env.DEV_IDP_ISSUER ?? `http://localhost:${PORT}`;
const AUDIENCE = process.env.DEV_IDP_AUDIENCE ?? 'sineobex-local';
const PASSWORD = process.env.DEV_IDP_PASSWORD ?? 'sineobex-demo';
const MFA_CODE = '000000';
const TTL_SECONDS = Number(process.env.DEV_IDP_TTL_SECONDS ?? 3600);

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'dev-idp', alg: 'ES256', use: 'sig' };
const jwks = createLocalJWKSet({ keys: [jwk] });
const refreshTokens = new Map(); // token -> { email, aal, amr, sessionId }
const TEST_HOOKS = process.env.DEV_IDP_TEST_HOOKS === '1';
const staleNext = new Map(); // email -> seconds the next sign-in is dated back (TEST_HOOKS only)
const staleSessions = new Map(); // session ID -> seconds its MFA step is dated back

async function mint({ email, aal, amr, sessionId }) {
  return new SignJWT({ email, aal, amr, session_id: sessionId, role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'dev-idp' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(`dev|${email}`)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(privateKey);
}

async function session(entry) {
  const refresh = randomUUID();
  refreshTokens.set(refresh, entry);
  return { access_token: await mint(entry), refresh_token: refresh, expires_in: TTL_SECONDS };
}

const now = () => Math.floor(Date.now() / 1000);

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    return JSON.parse(body || '{}');
  } catch {
    return {};
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/.well-known/jwks.json') return send(res, 200, { keys: [jwk] });
    if (req.method === 'POST' && req.url === '/token') {
      const body = await readJson(req);
      if (body.grant_type === 'password') {
        const email = String(body.email ?? '')
          .trim()
          .toLowerCase();
        if (!email || body.password !== PASSWORD) return send(res, 401, { error: 'invalid_grant' });
        const back = staleNext.get(email) ?? 0;
        staleNext.delete(email);
        const entry = {
          email,
          aal: 'aal1',
          amr: [{ method: 'password', timestamp: now() - back }],
          sessionId: randomUUID(),
        };
        if (back > 0) staleSessions.set(entry.sessionId, back);
        return send(res, 200, { ...(await session(entry)), mfa: 'challenge' });
      }
      if (body.grant_type === 'refresh_token') {
        const entry = refreshTokens.get(String(body.refresh_token ?? ''));
        if (!entry) return send(res, 401, { error: 'invalid_grant' });
        refreshTokens.delete(String(body.refresh_token));
        return send(res, 200, await session(entry));
      }
      return send(res, 400, { error: 'unsupported_grant_type' });
    }
    if (req.method === 'POST' && req.url === '/mfa/verify') {
      const body = await readJson(req);
      if (body.code !== MFA_CODE) return send(res, 400, { error: 'invalid_code' });
      const { payload } = await jwtVerify(String(body.access_token ?? ''), jwks, {
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const back = staleSessions.get(payload.session_id) ?? 0;
      staleSessions.delete(payload.session_id);
      const entry = {
        email: payload.email,
        aal: 'aal2',
        amr: [...(payload.amr ?? []), { method: 'totp', timestamp: now() - back }],
        sessionId: payload.session_id,
      };
      return send(res, 200, await session(entry));
    }
    if (TEST_HOOKS && req.method === 'POST' && req.url === '/test/stale-sign-in') {
      const body = await readJson(req);
      const email = String(body.email ?? '')
        .trim()
        .toLowerCase();
      const minutes = body.minutes;
      if (!email || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        return send(res, 400, { error: 'bad_request' });
      }
      staleNext.set(email, minutes * 60);
      return send(res, 200, {});
    }
    send(res, 404, { error: 'not_found' });
  } catch {
    send(res, 400, { error: 'bad_request' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `dev-idp listening on ${ISSUER} (audience ${AUDIENCE}); password "${PASSWORD}", MFA code ${MFA_CODE}`,
  );
});
