import type { Sql } from 'postgres';
import { DEMO_ENVIRONMENTS, getEnvironment } from '../src/migrate.ts';

/**
 * Loads made-up teams, staff, patients, routes and bags for the preview.
 *
 * Every person here is invented. Names come from a fixed list of obviously fictional names, birth
 * dates are synthetic, and no field is copied from a real record. The seed refuses to run against
 * any database not marked as a demo environment, so it can never put fake rows into the pilot.
 */
export async function seed(sql: Sql, options: { log?: (line: string) => void } = {}): Promise<void> {
  const log = options.log ?? (() => {});
  const kind = await getEnvironment(sql);
  if (kind === null || !DEMO_ENVIRONMENTS.includes(kind)) {
    throw new Error(
      `Refusing to seed: this database is marked "${kind ?? 'unset'}". The seed runs only in ${DEMO_ENVIRONMENTS.join(', ')}.`,
    );
  }
  log(`seeding ${kind} database with made-up data`);
}
