import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sql } from 'postgres';

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export type EnvironmentKind = 'local' | 'test' | 'preview' | 'pilot' | 'production';
export const ENVIRONMENT_KINDS: readonly EnvironmentKind[] = ['local', 'test', 'preview', 'pilot', 'production'];

/** Environments that may hold only made-up patients. The seed refuses to run anywhere else. */
export const DEMO_ENVIRONMENTS: readonly EnvironmentKind[] = ['local', 'test', 'preview'];

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Any constant works; it only has to be the same for every runner so two deploys can't migrate at once.
const MIGRATION_LOCK_KEY = 7_401_552_019;

export const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url).pathname;

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set<string>();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`Migration file name must look like 0001_name.sql: ${file}`);
    const [, version, name] = match as unknown as [string, string, string];
    if (seen.has(version)) throw new Error(`Two migrations share version ${version}`);
    seen.add(version);
    const sql = await readFile(join(dir, file), 'utf8');
    migrations.push({ version, name, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return migrations;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Applies every pending migration in version order, all in one transaction, so a failed deploy
 * leaves the database exactly as it was (migrations must therefore avoid CREATE INDEX CONCURRENTLY).
 * Refuses to run if a migration that was already applied has since been edited: applied
 * migrations are history, and changing one would make databases disagree silently.
 */
export async function migrate(
  sql: Sql,
  options: { dir?: string; log?: (line: string) => void } = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => {});
  const migrations = await loadMigrations(options.dir);
  const result: MigrateResult = { applied: [], alreadyApplied: [] };

  await sql.begin(async (tx) => {
    // Transaction-scoped so the lock is released however the run ends.
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;
    await tx.unsafe(`
      create schema if not exists sineobex_meta;
      create table if not exists sineobex_meta.schema_migrations (
        version    text primary key,
        name       text not null,
        checksum   text not null,
        applied_at timestamptz not null default now()
      );
    `);

    const rows = await tx<{ version: string; checksum: string }[]>`
      select version, checksum from sineobex_meta.schema_migrations
    `;
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const known = new Set(migrations.map((m) => m.version));
    for (const version of applied.keys()) {
      if (!known.has(version)) {
        throw new Error(`Database has migration ${version}, which is missing from this checkout`);
      }
    }

    for (const m of migrations) {
      const existing = applied.get(m.version);
      if (existing !== undefined) {
        if (existing !== m.checksum) {
          throw new Error(
            `Migration ${m.version}_${m.name} was edited after it was applied. Add a new migration instead.`,
          );
        }
        result.alreadyApplied.push(m.version);
        continue;
      }
      log(`applying ${m.version}_${m.name}`);
      await tx.savepoint(async (sp) => {
        await sp.unsafe(m.sql);
        await sp`
          insert into sineobex_meta.schema_migrations (version, name, checksum)
          values (${m.version}, ${m.name}, ${m.checksum})
        `;
      });
      result.applied.push(m.version);
    }
  });

  return result;
}

/**
 * Records what kind of environment this database is. Set once; changing it is refused, so a
 * preview database can never be relabelled as production (or the reverse) by a deploy script.
 */
export async function setEnvironment(sql: Sql, kind: EnvironmentKind): Promise<void> {
  if (!ENVIRONMENT_KINDS.includes(kind)) throw new Error(`Unknown environment kind: ${kind}`);
  const current = await getEnvironment(sql);
  if (current === kind) return;
  if (current !== null) {
    throw new Error(`This database is marked "${current}" and cannot be changed to "${kind}"`);
  }
  await sql`insert into sineobex.environment (kind) values (${kind})`;
}

export async function getEnvironment(sql: Sql): Promise<EnvironmentKind | null> {
  const rows = await sql<{ kind: EnvironmentKind }[]>`select kind from sineobex.environment`;
  return rows[0]?.kind ?? null;
}
