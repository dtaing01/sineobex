import { mkdtemp, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnvironment, loadMigrations, migrate, MIGRATIONS_DIR, setEnvironment } from '../src/migrate.ts';
import { seed } from '../seed/seed.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';

describe('migration runner', () => {
  let db: ScratchDatabase;

  beforeAll(async () => {
    db = await createScratchDatabase({ migrate: false });
  });
  afterAll(async () => {
    await db.drop();
  });

  it('applies every migration once and is idempotent', async () => {
    const all = await loadMigrations();
    const first = await migrate(db.owner);
    expect(first.applied).toEqual(all.map((m) => m.version));
    const second = await migrate(db.owner);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toHaveLength(all.length);
  });

  it('refuses to run when an applied migration was edited', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    for (const f of await readdir(MIGRATIONS_DIR)) await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    await writeFile(join(dir, '0001_base.sql'), '-- edited\n', { flag: 'a' });
    await expect(migrate(db.owner, { dir })).rejects.toThrow(/was edited after it was applied/);
  });

  it('keeps tables out of the public schema', async () => {
    const rows = await db.owner<{ n: number }[]>`
      select count(*)::int as n from information_schema.tables where table_schema = 'public'
    `;
    expect(rows[0]!.n).toBe(0);
  });
});

describe('environment marker', () => {
  let db: ScratchDatabase;
  beforeAll(async () => {
    db = await createScratchDatabase({ migrate: false });
    await migrate(db.owner);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('is write-once', async () => {
    expect(await getEnvironment(db.owner)).toBeNull();
    await setEnvironment(db.owner, 'pilot');
    await setEnvironment(db.owner, 'pilot');
    await expect(setEnvironment(db.owner, 'preview')).rejects.toThrow(/cannot be changed/);
    await expect(db.owner`update sineobex.environment set kind = 'preview'`).rejects.toThrow(/write-once/);
  });

  it('stops the seed from running outside demo environments', async () => {
    await expect(seed(db.owner)).rejects.toThrow(/Refusing to seed/);
  });
});

describe('application role', () => {
  let db: ScratchDatabase;
  beforeAll(async () => {
    db = await createScratchDatabase();
  });
  afterAll(async () => {
    await db.drop();
  });

  it('can read the environment but not change it', async () => {
    const app = postgres(db.appUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await app<{ kind: string }[]>`select kind from sineobex.environment`;
      expect(rows[0]!.kind).toBe('test');
      await expect(app`delete from sineobex.environment`).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it('normalizes names for search', async () => {
    const rows = await db.owner<
      { n: string }[]
    >`select sineobex.normalize_name(${"  José O'Brien-Smith "}) as n`;
    expect(rows[0]!.n).toBe('jose o brien smith');
  });
});
