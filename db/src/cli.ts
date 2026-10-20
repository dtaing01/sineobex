// Usage:
//   DATABASE_URL=... tsx src/cli.ts migrate [--environment local|preview|pilot|production]
//   DATABASE_URL=... tsx src/cli.ts seed
//   DATABASE_URL=... tsx src/cli.ts grant-api <login-role>
//
// DATABASE_URL must be the schema owner's connection (migrations create objects). The API itself
// connects with a different, non-owner login that is a member of sineobex_app.
import postgres from 'postgres';
import {
  ENVIRONMENT_KINDS,
  getEnvironment,
  migrate,
  setEnvironment,
  type EnvironmentKind,
} from './migrate.ts';
import { seed } from '../seed/seed.ts';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    switch (command) {
      case 'migrate': {
        const result = await migrate(sql, { log: (l) => console.log(l) });
        console.log(`applied ${result.applied.length}, already applied ${result.alreadyApplied.length}`);
        const envIndex = args.indexOf('--environment');
        if (envIndex >= 0) {
          const kind = args[envIndex + 1] as EnvironmentKind | undefined;
          if (!kind || !ENVIRONMENT_KINDS.includes(kind)) {
            throw new Error(`--environment must be one of ${ENVIRONMENT_KINDS.join(', ')}`);
          }
          await setEnvironment(sql, kind);
        }
        console.log(`environment: ${(await getEnvironment(sql)) ?? 'not set'}`);
        break;
      }
      case 'seed': {
        await seed(sql, { log: (l) => console.log(l) });
        break;
      }
      case 'grant-api': {
        const role = args[0];
        if (!role || !/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('grant-api needs a login role name');
        await sql.unsafe(`grant sineobex_app to ${role}`);
        await sql.unsafe(`alter role ${role} set search_path = sineobex, public, extensions`);
        console.log(`granted sineobex_app to ${role}`);
        break;
      }
      default:
        throw new Error(`Unknown command: ${command ?? '(none)'}. Use migrate, seed or grant-api.`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
