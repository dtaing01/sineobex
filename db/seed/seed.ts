import {
  canonicalJson,
  installPresets,
  sha256Hex,
  type Preset,
  type ResolvedNoteType,
} from '@sineobex/forms';
import { installTeamPresets, totalsOf } from '@sineobex/presets';
import type { Sql } from 'postgres';
import { DEMO_ENVIRONMENTS, getEnvironment } from '../src/migrate.ts';
import { seedDemoEncounters } from './demo-encounters.ts';
import { seedDemoFlags } from './demo-flags.ts';
import { NEIGHBOUR_TEAM_ID, seedDemoPatients } from './demo-patients.ts';
import { seedDemoPresets } from './demo-presets.ts';

/**
 * Loads made-up teams, staff, patients, visits, routes and bags for the preview.
 *
 * Every person here is invented. Staff names carry "(demo)", emails use example.com, birth dates
 * are synthetic, and nothing is copied from a real record. The seed refuses to run against any
 * database not marked as a demo environment, so it can never put fake rows into the pilot.
 * It is idempotent: running it twice changes nothing.
 */
export const DEMO_TEAM_ID = '0d3e6f00-0000-4000-8000-000000000001';

export const DEMO_STAFF = [
  { email: 'owner@example.com', name: 'Morgan Ellis (demo)', role: null, credential: 'none', owner: true },
  {
    email: 'admin@example.com',
    name: 'Alex Rivera (demo)',
    role: 'program_admin',
    credential: 'attending',
    owner: false,
  },
  {
    email: 'logistics@example.com',
    name: 'Sam Okafor (demo)',
    role: 'logistics',
    credential: 'none',
    owner: false,
  },
  {
    email: 'clinician@example.com',
    name: 'Jordan Lee (demo)',
    role: 'healthcare_staff',
    credential: 'attending',
    owner: false,
  },
  {
    email: 'resident@example.com',
    name: 'Casey Nguyen (demo)',
    role: 'healthcare_staff',
    credential: 'resident',
    owner: false,
  },
  {
    email: 'billing@example.com',
    name: 'Riley Chen (demo)',
    role: 'billing_data',
    credential: 'none',
    owner: false,
  },
  {
    // The community health worker preset (a custom role every team gets): demographics, check-ins
    // and referrals, no problem list (phase 3 design 4.2).
    email: 'chw@example.com',
    name: 'Robin Patel (demo)',
    role: 'community_health_worker',
    credential: 'chw',
    owner: false,
  },
] as const;

/**
 * Who seeded patient records name as their author, in every demo environment (the preview has no
 * seeded staff: people are invited through the portal). No identity provider issues this issuer,
 * so nobody can sign in as it.
 */
export const SEED_AUTHOR = {
  email: 'demo-intake@example.com',
  name: 'Demo intake (demo)',
  issuer: 'urn:sineobex:demo-seed',
  subject: 'demo-intake',
} as const;

// A valid-format NPI used only for demo staff (CMS's documented example number).
const DEMO_NPI = '1234567893';

const FIELDS: Record<string, Record<string, string>> = {
  attending: { npi: DEMO_NPI, licenseNumber: 'DEMO-0001', licenseState: 'MI' },
  resident: { npi: DEMO_NPI, program: 'Demo Internal Medicine', supervisingAttending: 'Jordan Lee (demo)' },
  none: {},
};

export async function seed(
  sql: Sql,
  options: {
    log?: (line: string) => void;
    devIssuer?: string;
    /** The note type versions to install; generated/presets.json when left out (tests pass fixtures). */
    presets?: readonly Preset[];
  } = {},
): Promise<void> {
  const log = options.log ?? (() => {});
  const kind = await getEnvironment(sql);
  if (kind === null || !DEMO_ENVIRONMENTS.includes(kind)) {
    throw new Error(
      `Refusing to seed: this database is marked "${kind ?? 'unset'}". The seed runs only in ${DEMO_ENVIRONMENTS.join(', ')}.`,
    );
  }
  log(`seeding ${kind} database with made-up data`);

  await sql.begin(async (tx) => {
    await tx`select set_config('app.scope', 'platform', true)`;
    await tx`
      insert into sineobex.teams (id, name) values (${DEMO_TEAM_ID}, 'Demo Street Team (made-up data)')
      on conflict (id) do nothing`;
    await tx`
      insert into sineobex.roles (team_id, key, name, description, permissions)
      values (${DEMO_TEAM_ID}, 'community_health_worker', 'Community health worker',
              'Demographics, check-ins and referrals. No clinical notes.',
              array['patients.view', 'patients.edit', 'checkins.create', 'referrals.create', 'routes.view'])
      on conflict (team_id, key) do nothing`;

    // Staff accounts only where the local dev identity provider signs them in. In the preview,
    // people are invited through the portal so Supabase Auth creates their identities.
    if (kind === 'local' || kind === 'test') {
      const issuer = options.devIssuer ?? process.env.DEV_IDP_ISSUER ?? 'http://localhost:8790';
      for (const s of DEMO_STAFF) {
        const [user] = await tx<{ id: string }[]>`
          insert into sineobex.users (email, display_name, auth_issuer, auth_subject)
          values (${s.email}, ${s.name}, ${issuer}, ${`dev|${s.email}`})
          on conflict (email) do update set display_name = excluded.display_name
          returning id`;
        const userId = user!.id;
        for (const a of [
          { kind: 'terms_of_use', version: '2026-10-20' },
          { kind: 'confidentiality', version: '2026-10-20' },
        ]) {
          await tx`insert into sineobex.acknowledgements (user_id, kind, version) values (${userId}, ${a.kind}, ${a.version})
                   on conflict do nothing`;
        }
        if (s.owner) {
          await tx`insert into sineobex.platform_owners (user_id) values (${userId}) on conflict do nothing`;
          continue;
        }
        await tx`
          insert into sineobex.team_memberships (team_id, user_id, role_id, credential, credential_fields)
          select ${DEMO_TEAM_ID}, ${userId}, r.id, ${s.credential}, ${tx.json(FIELDS[s.credential] ?? {})}
          from sineobex.roles r
          where r.key = ${s.role!} and (r.team_id is null or r.team_id = ${DEMO_TEAM_ID})
          on conflict (team_id, user_id) do nothing`;
      }
      log(`  ${DEMO_STAFF.length} demo staff (password from the dev identity provider)`);
    }

    // A second team, so a similar name elsewhere is there to never be found.
    await tx`
      insert into sineobex.teams (id, name) values (${NEIGHBOUR_TEAM_ID}, 'Neighbouring Demo Team (made-up data)')
      on conflict (id) do nothing`;
    const [author] = await tx<{ id: string }[]>`
      insert into sineobex.users (email, display_name, auth_issuer, auth_subject)
      values (${SEED_AUTHOR.email}, ${SEED_AUTHOR.name}, ${SEED_AUTHOR.issuer}, ${SEED_AUTHOR.subject})
      on conflict (email) do update set display_name = excluded.display_name
      returning id`;
    const { patients } = await seedDemoPatients(tx, DEMO_TEAM_ID, author!.id);
    log(`  ${patients} made-up patients`);

    // Every note type version the platform ships, in both teams, as team creation does (forms
    // 3.2), and then every platform preset, whose maps read those note types (phase 5 design 5.2).
    // Platform scope is set above; a second run writes nothing. Team creation audits both installs;
    // the seed audits neither and logs the counts, since it is no one's act, as its patients and
    // visits are not (demo-encounters.ts).
    for (const teamId of [DEMO_TEAM_ID, NEIGHBOUR_TEAM_ID]) {
      const { installed, offered, heads } = await installPresets(tx, teamId, { presets: options.presets });
      log(
        `  note types in team ${teamId}: ${installed.length} version(s) installed, ${offered.length} offered, ` +
          `${heads.length} head(s) written`,
      );
      const presets = totalsOf(await installTeamPresets(tx, teamId));
      log(
        `  platform presets in team ${teamId}: ${presets.install} installed, ${presets.update} updated, ` +
          `${presets.offer} offered, ${presets.skipped} skipped`,
      );
    }

    // The demo team's own presets name the platform's, so they come after them. Their author is the
    // seed's, who is in every demo environment, so unlike the visits they need no seeded staff.
    const demoPresets = await seedDemoPresets(tx, DEMO_TEAM_ID, author!.id);
    log(
      demoPresets.skipped
        ? `  no demo presets: ${demoPresets.skipped}`
        : `  ${demoPresets.presets} made-up preset(s)`,
    );

    // Visits need the note types above, and staff whose credentials sign them: the preview has
    // none (people are invited there), so it gets no visit.
    const { visits, skipped } = await seedDemoEncounters(tx, DEMO_TEAM_ID);
    log(skipped ? `  no demo visits: ${skipped}` : `  ${visits} made-up visit(s)`);

    // Flags need the platform's flags above. They are the demo staff's, who may set them, as a
    // phone's change is, where those staff are; in the preview, which has none, the seed's own
    // author's, as the patients and presets are, so the preview shows flags too.
    const flags = await seedDemoFlags(tx, DEMO_TEAM_ID, author!.id);
    log(flags.skipped ? `  no demo flags: ${flags.skipped}` : `  ${flags.changes} made-up flag change(s)`);
  });
}

/**
 * Installs made-up note type definitions in the demo team, as the presets are installed, each under
 * its own hash: the test-only types (packages/contract/test-vectors/sync-note-types.json) the
 * phone's live sync scenarios chart on, as the API's tests install them in every test team
 * (lifecycle 4.4). Never part of the seed itself, and only in a database marked "test": no person
 * charts on these.
 */
export async function installTestNoteTypes(
  sql: Sql,
  definitions: readonly ResolvedNoteType[],
  options: { log?: (line: string) => void } = {},
): Promise<void> {
  const kind = await getEnvironment(sql);
  if (kind !== 'test') {
    throw new Error(
      `Refusing to install test-only note types: this database is marked "${kind ?? 'unset'}", not "test".`,
    );
  }
  const presets: Preset[] = await Promise.all(
    definitions.map(async (definition) => ({
      key: definition.key,
      version: definition.version,
      hash: await sha256Hex(canonicalJson(definition)),
      definition,
    })),
  );
  await sql.begin(async (tx) => {
    await tx`select set_config('app.scope', 'platform', true)`;
    const { installed } = await installPresets(tx, DEMO_TEAM_ID, { presets });
    options.log?.(`  ${installed.length} test-only note type version(s) installed in team ${DEMO_TEAM_ID}`);
  });
}
