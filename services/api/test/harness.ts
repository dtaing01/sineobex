import { createScratchDatabase, type ScratchDatabase } from '@sineobex/db/testing';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { createApp, type App } from '../src/app.ts';
import { REQUIRED_ACKNOWLEDGEMENTS } from '../src/auth/acknowledgements.ts';
import { createMemoryIdentityAdmin } from '../src/auth/identity-admin.ts';
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
  /** When the person last authenticated; defaults to the harness clock. */
  authTime?: Date;
  sessionId?: string;
}

export interface Harness {
  app: App;
  db: Database;
  scratch: ScratchDatabase;
  config: Config;
  clock: { now: Date; advance(ms: number): void; set(d: Date): void };
  identityAdmin: ReturnType<typeof createMemoryIdentityAdmin>;
  token(options: TokenOptions): Promise<string>;
  /** Mints a token for an existing user row, by email. */
  tokenFor(email: string, options?: Omit<TokenOptions, 'subject'>): Promise<string>;
  /** Inserts a platform owner who has accepted the acknowledgements. */
  seedOwner(email: string, displayName?: string): Promise<string>;
  acknowledge(userId: string): Promise<void>;
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
    IDENTITY_ADMIN: 'memory',
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
  const identityAdmin = createMemoryIdentityAdmin(TEST_ISSUER);
  const app = createApp({
    config,
    db,
    identityAdmin,
    verifier: createLocalVerifier({ issuer: TEST_ISSUER, audience: TEST_AUDIENCE, jwks: { keys: [jwk] } }),
    log: options.log ?? silentLogger,
    now: () => clock.now,
  });

  const mint = async (o: TokenOptions) => {
    const authTime = Math.floor((o.authTime ?? clock.now).getTime() / 1000);
    const claims: Record<string, unknown> = {
      aal: o.aal ?? 'aal2',
      amr: [{ method: 'password', timestamp: authTime }],
      session_id: o.sessionId ?? `s-${o.subject}`,
    };
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
  };

  const acknowledge = async (userId: string) => {
    for (const a of REQUIRED_ACKNOWLEDGEMENTS) {
      await scratch.owner`insert into sineobex.acknowledgements (user_id, kind, version)
        values (${userId}, ${a.kind}, ${a.version}) on conflict do nothing`;
    }
  };

  return {
    app,
    db,
    scratch,
    config,
    clock,
    identityAdmin,
    acknowledge,
    token: mint,
    async tokenFor(email, o = {}) {
      const rows = await scratch.owner<{ authSubject: string }[]>`
        select auth_subject as "authSubject" from sineobex.users where email = ${email}`;
      if (!rows[0]) throw new Error(`no user ${email}`);
      return mint({ ...o, subject: rows[0].authSubject });
    },
    async seedOwner(email, displayName = 'Owner') {
      const [u] = await scratch.owner<{ id: string }[]>`
        insert into sineobex.users (email, display_name, auth_issuer, auth_subject)
        values (${email}, ${displayName}, ${TEST_ISSUER}, ${`owner|${email}`}) returning id`;
      await scratch.owner`insert into sineobex.platform_owners (user_id) values (${u!.id})`;
      await acknowledge(u!.id);
      return u!.id;
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
