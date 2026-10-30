// Usage:
//   DATABASE_URL=... tsx src/cli.ts migrate [--environment local|preview|pilot|production]
//   DATABASE_URL=... tsx src/cli.ts seed
//   DATABASE_URL=... tsx src/cli.ts grant-api <login-role>
//   DATABASE_URL=... tsx src/cli.ts add-owner --email <e> --name <n> --issuer <oidc issuer> --subject <sub>
//
// add-owner bootstraps the owner registry (module 1). It is the only way to create an owner:
// owners create teams and appoint Program Admins through the API afterwards. Create the person's
// sign-in at the identity provider first and pass its subject (the Supabase user id, or the
// Cognito sub).
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
      case 'add-owner': {
        const opt = (name: string) => {
          const i = args.indexOf(`--${name}`);
          const v = i >= 0 ? args[i + 1] : undefined;
          if (!v) throw new Error(`add-owner needs --${name}`);
          return v;
        };
        const email = opt('email').trim().toLowerCase();
        const [user] = await sql<{ id: string }[]>`
          insert into sineobex.users (email, display_name, auth_issuer, auth_subject)
          values (${email}, ${opt('name')}, ${opt('issuer')}, ${opt('subject')})
          on conflict (email) do update set display_name = excluded.display_name
          returning id`;
        await sql`insert into sineobex.platform_owners (user_id) values (${user!.id}) on conflict do nothing`;
        console.log(`owner ${email} registered (${user!.id})`);
        break;
      }
      default:
        throw new Error(
          `Unknown command: ${command ?? '(none)'}. Use migrate, seed, grant-api or add-owner.`,
        );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
