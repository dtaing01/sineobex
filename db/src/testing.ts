import { randomBytes } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { migrate, setEnvironment } from './migrate.ts';

/**
 * Test helper: a fresh database per test file, migrated and marked `test`, plus a non-owner
 * login role so tests exercise row-level security the way the API does.
 *
 * Needs TEST_ADMIN_DATABASE_URL (a superuser connection, default postgres://postgres@localhost:5432/postgres).
 */
export interface ScratchDatabase {
  name: string;
  /** Owner connection: migrations, fixtures, tampering in tests. */
  ownerUrl: string;
  /** Connection as a member of sineobex_app, the way the API connects. */
  appUrl: string;
  owner: Sql;
  drop: () => Promise<void>;
}

const APP_LOGIN = 'sineobex_api_test';
const APP_PASSWORD = 'local-test-only';

export function adminUrl(): string {
  return process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';
}

function withDatabase(url: string, database: string, user?: string, password?: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  if (user !== undefined) u.username = user;
  if (password !== undefined) u.password = password;
  return u.toString();
}

export async function createScratchDatabase(options: { migrate?: boolean } = {}): Promise<ScratchDatabase> {
  const name = `sineobex_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${name}`);
    await admin.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${APP_LOGIN}') then
          create role ${APP_LOGIN} login password '${APP_PASSWORD}';
        end if;
      end $$;
    `);
  } finally {
    await admin.end();
  }

  const ownerUrl = withDatabase(adminUrl(), name);
  const owner = postgres(ownerUrl, { max: 4, onnotice: () => {} });
  if (options.migrate !== false) {
    await migrate(owner);
    await setEnvironment(owner, 'test');
    await owner.unsafe(`grant sineobex_app to ${APP_LOGIN}`);
    await owner.unsafe(
      `alter role ${APP_LOGIN} in database ${name} set search_path = sineobex, public, extensions`,
    );
  }

  return {
    name,
    ownerUrl,
    appUrl: withDatabase(adminUrl(), name, APP_LOGIN, APP_PASSWORD),
    owner,
    drop: async () => {
      await owner.end({ timeout: 5 });
      const a = postgres(adminUrl(), { max: 1, onnotice: () => {} });
      try {
        await a.unsafe(`drop database if exists ${name} with (force)`);
      } finally {
        await a.end();
      }
    },
  };
}
