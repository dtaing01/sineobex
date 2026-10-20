import { createScratchDatabase, type ScratchDatabase } from '@sineobex/db/testing';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { createApp, type App } from '../src/app.ts';
import { createLocalVerifier } from '../src/auth/verifier.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { createDatabase, createSql, type Database } from '../src/db/database.ts';
import { silentLogger, type Logger } from '../src/lib/log.ts';

export const TEST_ISSUER = 'https://idp.test.sineobex.invalid';
export const TEST_AUDIENCE = 'sineobex-api';

export interface TokenOptions {
  subject: string;
  email?: string;
  emailVerified?: boolean;
  aal?: 'aal1' | 'aal2';
  expiresInSeconds?: number;
  issuer?: string;
}

export interface Harness {
  app: App;
  db: Database;
  scratch: ScratchDatabase;
  config: Config;
  clock: { now: Date; advance(ms: number): void; set(d: Date): void };
  token(options: TokenOptions): Promise<string>;
  request(
    path: string,
    init?: RequestInit & { token?: string; teamId?: string; deviceId?: string; json?: unknown },
  ): Promise<Response>;
  close(): Promise<void>;
}

export async function createHarness(
  options: { configOverrides?: Partial<Record<string, string>>; log?: Logger } = {},
): Promise<Harness> {
  const scratch = await createScratchDatabase();
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const config = loadConfig({
    APP_ENV: 'test',
    DATABASE_URL: scratch.appUrl,
    OIDC_ISSUER: TEST_ISSUER,
    OIDC_AUDIENCE: TEST_AUDIENCE,
    OIDC_JWKS_URL: 'https://idp.test.sineobex.invalid/jwks',
    MFA_MODE: 'aal',
    ...options.configOverrides,
  });
  const sql = createSql(scratch.appUrl, { max: 4 });
  const db = createDatabase(sql);
  const clock = {
    now: new Date('2026-10-20T15:00:00.000Z'),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
    set(d: Date) {
      this.now = d;
    },
  };
  const app = createApp({
    config,
    db,
    verifier: createLocalVerifier({ issuer: TEST_ISSUER, audience: TEST_AUDIENCE, jwks: { keys: [jwk] } }),
    log: options.log ?? silentLogger,
    now: () => clock.now,
  });

  return {
    app,
    db,
    scratch,
    config,
    clock,
    async token(o) {
      const claims: Record<string, unknown> = { aal: o.aal ?? 'aal2' };
      if (o.email !== undefined) {
        claims.email = o.email;
        claims.email_verified = o.emailVerified ?? true;
      }
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setIssuer(o.issuer ?? TEST_ISSUER)
        .setAudience(TEST_AUDIENCE)
        .setSubject(o.subject)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + (o.expiresInSeconds ?? 3600))
        .sign(privateKey);
    },
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (init.token) headers.set('authorization', `Bearer ${init.token}`);
      if (init.teamId) headers.set('x-team-id', init.teamId);
      if (init.deviceId) headers.set('x-device-id', init.deviceId);
      let body = init.body;
      if (init.json !== undefined) {
        headers.set('content-type', 'application/json');
        body = JSON.stringify(init.json);
      }
      return app.request(path, { ...init, headers, body });
    },
    async close() {
      await db.close();
      await scratch.drop();
    },
  };
}
