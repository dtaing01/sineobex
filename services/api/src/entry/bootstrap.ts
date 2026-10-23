import type { Sql } from 'postgres';
import { createApp, type App } from '../app.ts';
import {
  createMemoryIdentityAdmin,
  createSupabaseIdentityAdmin,
  type IdentityAdmin,
} from '../auth/identity-admin.ts';
import { createOidcVerifier } from '../auth/verifier.ts';
import { DEMO_ENVS, loadConfig, type AppEnv, type Config } from '../config.ts';
import { createDatabase, createSql } from '../db/database.ts';
import { createLogger, type Logger } from '../lib/log.ts';

/**
 * Refuses to serve when the deployment and its database disagree about what they are:
 * a preview API must never reach a pilot database, and a production API must never run on a
 * database that was set up for made-up patients.
 */
export async function assertDatabaseMatches(sql: Sql, appEnv: AppEnv): Promise<void> {
  const rows = await sql<{ kind: AppEnv }[]>`select kind from sineobex.environment`;
  const kind = rows[0]?.kind ?? null;
  const appIsDemo = DEMO_ENVS.includes(appEnv);
  if (!appIsDemo) {
    if (kind !== appEnv) {
      throw new Error(
        `APP_ENV is ${appEnv} but the database is marked ${kind ?? 'unset'}; refusing to start`,
      );
    }
    return;
  }
  if (kind !== null && !DEMO_ENVS.includes(kind)) {
    throw new Error(`APP_ENV is ${appEnv} (demo) but the database is marked ${kind}; refusing to start`);
  }
}

export interface Runtime {
  app: App;
  config: Config;
  log: Logger;
  close: () => Promise<void>;
}

export async function bootstrap(env: Record<string, string | undefined>): Promise<Runtime> {
  const config = loadConfig(env);
  const log = createLogger({ level: config.APP_ENV === 'local' ? 'debug' : 'info' });
  const sql = createSql(config.DATABASE_URL, {
    max: config.DATABASE_POOL_MAX,
    prepare: config.DATABASE_PREPARE,
  });
  await assertDatabaseMatches(sql, config.APP_ENV);
  const db = createDatabase(sql);
  const verifier = createOidcVerifier({
    issuer: config.OIDC_ISSUER,
    audience: config.OIDC_AUDIENCE,
    jwksUrl: config.OIDC_JWKS_URL,
  });
  const identityAdmin: IdentityAdmin =
    config.IDENTITY_ADMIN === 'supabase'
      ? createSupabaseIdentityAdmin({
          url: config.SUPABASE_URL!,
          serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY!,
          ...(config.INVITE_REDIRECT_URL ? { redirectTo: config.INVITE_REDIRECT_URL } : {}),
        })
      : createMemoryIdentityAdmin(config.OIDC_ISSUER);
  const app = createApp({ config, db, verifier, identityAdmin, log, now: () => new Date() });
  return { app, config, log, close: () => db.close() };
}
