import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { Permission } from '../src/auth/permissions.ts';
import { createLogger, type Logger } from '../src/lib/log.ts';
import type { Harness } from './harness.ts';

/**
 * Shared helpers for the phase 3 API tests (phase 3 design 15: owned by S0, read-only for S1-S4).
 * They write straight to the database as its owner, so a test can set up patients, members and
 * merges before the routes that make them exist. Everyone here is made up.
 */

// ------------------------------------------------------------------------------------------------
// Members with exactly the permissions a test needs
// ------------------------------------------------------------------------------------------------

export interface Member {
  userId: string;
  membershipId: string;
  roleId: string;
  token: string;
}

let memberCount = 0;

/**
 * A member of the team whose role holds exactly `permissions` (a custom role, which may combine any
 * existing keys, Oct 12), who accepted the acknowledgements and signed in just now.
 */
export async function memberWith(
  h: Harness,
  teamId: string,
  permissions: readonly Permission[],
  options: { email?: string; displayName?: string; credential?: string } = {},
): Promise<Member> {
  const n = ++memberCount;
  const email = options.email ?? `member-${n}-${randomUUID().slice(0, 8)}@example.com`;
  const [role] = await h.scratch.owner<{ id: string }[]>`
    insert into sineobex.roles (team_id, key, name, permissions)
    values (${teamId}, ${`custom_${n}_${randomUUID().slice(0, 8)}`}, ${`Custom ${n}`}, ${[...permissions]})
    returning id`;
  const [user] = await h.scratch.owner<{ id: string }[]>`
    insert into sineobex.users (email, display_name, auth_issuer, auth_subject)
    values (${email}, ${options.displayName ?? `Member ${n} (demo)`}, ${h.config.OIDC_ISSUER}, ${`member|${email}`})
    returning id`;
  const [membership] = await h.scratch.owner<{ id: string }[]>`
    insert into sineobex.team_memberships (team_id, user_id, role_id, credential)
    values (${teamId}, ${user!.id}, ${role!.id}, ${options.credential ?? 'none'}) returning id`;
  await h.acknowledge(user!.id);
  return { userId: user!.id, membershipId: membership!.id, roleId: role!.id, token: await h.tokenFor(email) };
}

/** A team with no members, for tests that only need somewhere to put patients. */
export async function createTeam(h: Harness, name = 'Patients Team (demo)'): Promise<string> {
  const [team] = await h.scratch.owner<{ id: string }[]>`
    insert into sineobex.teams (name) values (${name}) returning id`;
  return team!.id;
}

// ------------------------------------------------------------------------------------------------
// Patients
// ------------------------------------------------------------------------------------------------

export type BirthValue =
  { precision: 'day'; date: string } | { precision: 'year' | 'estimated'; year: number } | null;

export interface NewPatient {
  id?: string;
  preferredName?: string | null;
  legalName?: { given: string | null; family: string | null } | null;
  visualDescriptor?: string | null;
  birth?: BirthValue;
  livingSituation?: { kind: string; other?: string } | null;
  usualArea?: string | null;
  preferredLanguage?: string | null;
  allergyScreen?: 'not_asked' | 'none_known';
  idCardChoice?: 'not_asked' | 'wants' | 'declined';
  aliases?: string[];
  allergies?: { substance: string; category?: string; severity?: string; reaction?: string }[];
  /** When it was registered (and last seen); defaults to the harness clock. */
  at?: Date;
}

export interface CreatedPatient {
  id: string;
  aliasIds: string[];
  allergyIds: string[];
  consentIds: string[];
}

/** Every patient field sync can change, each at version 1 after a create, as the apply path leaves them. */
export const PATIENT_FIELDS = [
  'preferredName',
  'legalName',
  'visualDescriptor',
  'birth',
  'livingSituation',
  'usualArea',
  'preferredLanguage',
  'allergyScreen',
  'idCardChoice',
] as const;

/**
 * A registered patient as an accepted intake leaves it: the row (canonical, version 1, every field at
 * version 1 with `created` history), its street names and allergies, and consent given verbally.
 */
export async function createPatient(
  h: Harness,
  teamId: string,
  authorId: string,
  p: NewPatient = {},
): Promise<CreatedPatient> {
  const id = p.id ?? randomUUID();
  const at = p.at ?? h.clock.now;
  const birth = p.birth ?? null;
  const values: Record<(typeof PATIENT_FIELDS)[number], unknown> = {
    preferredName: p.preferredName === undefined ? 'Demo person' : p.preferredName,
    legalName: p.legalName ?? null,
    visualDescriptor: p.visualDescriptor ?? null,
    birth,
    livingSituation: p.livingSituation ?? null,
    usualArea: p.usualArea ?? null,
    preferredLanguage: p.preferredLanguage ?? null,
    allergyScreen: p.allergyScreen ?? 'not_asked',
    idCardChoice: p.idCardChoice ?? 'not_asked',
  };
  const versions = Object.fromEntries(PATIENT_FIELDS.map((f) => [f, 1]));
  const meta = Object.fromEntries(
    PATIENT_FIELDS.map((f) => [f, { by: authorId, at: at.toISOString(), changeId: null }]),
  );
  const sql = h.scratch.owner;
  await sql`
    insert into sineobex.patients (id, team_id, canonical_id, preferred_name, legal_given_name, legal_family_name,
      visual_descriptor, birth_precision, birth_date, birth_year, living_situation, living_situation_other,
      usual_area, preferred_language, allergy_screen, id_card_choice, last_seen_at, registered_at, clock_verified,
      author_user_id, field_versions, field_meta)
    values (${id}, ${teamId}, ${id}, ${values.preferredName as string | null}, ${p.legalName?.given ?? null},
      ${p.legalName?.family ?? null}, ${p.visualDescriptor ?? null}, ${birth?.precision ?? null},
      ${birth?.precision === 'day' ? birth.date : null},
      ${birth ? (birth.precision === 'day' ? Number(birth.date.slice(0, 4)) : birth.year) : null},
      ${p.livingSituation?.kind ?? null}, ${p.livingSituation?.other ?? null}, ${p.usualArea ?? null},
      ${p.preferredLanguage ?? null}, ${values.allergyScreen as string}, ${values.idCardChoice as string}, ${at}, ${at},
      true, ${authorId}, ${sql.json(versions)}, ${sql.json(meta)})`;
  for (const f of PATIENT_FIELDS) {
    await sql`
      insert into sineobex.field_history (team_id, entity, record_id, field, version, value, kind, changed_by)
      values (${teamId}, 'patient', ${id}, ${f}, 1, ${sql.json(values[f] as never)}, 'created', ${authorId})`;
  }
  const aliasIds: string[] = [];
  for (const alias of p.aliases ?? []) {
    const aliasId = randomUUID();
    await sql`
      insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id)
      values (${aliasId}, ${teamId}, ${id}, ${alias}, ${authorId})`;
    aliasIds.push(aliasId);
  }
  const allergyIds: string[] = [];
  for (const a of p.allergies ?? []) {
    const allergyId = randomUUID();
    await sql`
      insert into sineobex.patient_allergies (id, team_id, patient_id, substance, category, severity, reaction,
        recorded_at, author_user_id)
      values (${allergyId}, ${teamId}, ${id}, ${a.substance}, ${a.category ?? 'unknown'}, ${a.severity ?? 'unknown'},
        ${a.reaction ?? null}, ${at}, ${authorId})`;
    allergyIds.push(allergyId);
  }
  const consentIds = [randomUUID(), randomUUID()];
  await sql`
    insert into sineobex.patient_consents (id, team_id, patient_id, kind, decision, method, script_version, language,
      recorded_by, recorded_at, clock_verified)
    values (${consentIds[0]!}, ${teamId}, ${id}, 'care_and_record', 'given', 'verbal', '2026-10-1', 'en', ${authorId}, ${at}, true),
           (${consentIds[1]!}, ${teamId}, ${id}, 'privacy_notice', 'acknowledged', 'verbal', '2026-10-1', 'en', ${authorId}, ${at}, true)`;
  return { id, aliasIds, allergyIds, consentIds };
}

// ------------------------------------------------------------------------------------------------
// Merges, for tests that need a merged pair before the merge route exists
// ------------------------------------------------------------------------------------------------

export interface DirectMerge {
  mergeId: string;
  pairId: string;
  decisionId: string;
}

/**
 * Merges `mergedId` into `survivorId` the way a merge leaves patient rows (phase 3 design 8.4 steps
 * 2 and 8): the merged record points at the survivor, every row whose canonical_id was the merged
 * patient now has the survivor's, and the pair, the decision and the merge row are written. It fills
 * no blank, opens no review and writes no audit event; tests of the merge itself use the route.
 */
export async function mergeDirect(
  h: Harness,
  teamId: string,
  mergedId: string,
  survivorId: string,
  decidedBy: string,
  comment = 'Same person, confirmed by ID card',
): Promise<DirectMerge> {
  return h.scratch.owner.begin(async (sql) => {
    const [a, b] = [mergedId, survivorId].sort() as [string, string];
    const [pair] = await sql<{ id: string }[]>`
      insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, sources, status, decided_at, decided_by)
      values (${teamId}, ${a}, ${b}, 0.95, '{staff_report}', 'merged', now(), ${decidedBy})
      on conflict (team_id, patient_a, patient_b)
        do update set status = 'merged', decided_at = now(), decided_by = ${decidedBy}
      returning id`;
    const [decision] = await sql<{ id: string }[]>`
      insert into sineobex.duplicate_decisions (team_id, pair_id, decision, comment, survivor_id, decided_by)
      values (${teamId}, ${pair!.id}, 'merge', ${comment}, ${survivorId}, ${decidedBy}) returning id`;
    const [merge] = await sql<{ id: string }[]>`
      insert into sineobex.patient_merges (team_id, pair_id, survivor_id, merged_id, decision_id, merged_by)
      values (${teamId}, ${pair!.id}, ${survivorId}, ${mergedId}, ${decision!.id}, ${decidedBy}) returning id`;
    await sql`update sineobex.patients set status = 'merged', merged_into = ${survivorId}
              where team_id = ${teamId} and id = ${mergedId}`;
    await sql`update sineobex.patients set canonical_id = ${survivorId}
              where team_id = ${teamId} and canonical_id = ${mergedId}`;
    return { mergeId: merge!.id, pairId: pair!.id, decisionId: decision!.id };
  });
}

// ------------------------------------------------------------------------------------------------
// Audit events
// ------------------------------------------------------------------------------------------------

export interface AuditRow {
  id: string;
  action: string;
  actorUserId: string | null;
  entity: string | null;
  entityId: string | null;
  patientId: string | null;
  deviceId: string | null;
  details: Record<string, unknown>;
}

/** The newest audit event's ID, so a test can look only at what came after. */
export async function auditMark(h: Harness): Promise<string> {
  const [row] = await h.scratch.owner<{ last: string }[]>`
    select coalesce(max(id), 0)::text as last from sineobex.audit_events`;
  return row!.last;
}

/**
 * The audit events with this action (after `after`, for this patient, in this team) and asserts
 * there is at least one; `count` asserts exactly that many.
 */
export async function expectAudit(
  h: Harness,
  action: string,
  options: { patientId?: string | null; teamId?: string; after?: string; count?: number } = {},
): Promise<AuditRow[]> {
  const sql = h.scratch.owner;
  const rows = await sql<AuditRow[]>`
    select id::text, action, actor_user_id as "actorUserId", entity, entity_id as "entityId",
           patient_id as "patientId", device_id as "deviceId", details
    from sineobex.audit_events
    where action = ${action}
      and id > ${options.after ?? '0'}::bigint
      ${options.teamId ? sql`and team_id = ${options.teamId}` : sql``}
      ${options.patientId !== undefined ? sql`and patient_id is not distinct from ${options.patientId}` : sql``}
    order by id`;
  if (options.count !== undefined) expect(rows).toHaveLength(options.count);
  else expect(rows.length, `audit event ${action}`).toBeGreaterThan(0);
  return rows;
}

/** No audit event's details mention any of these strings (names, search text, tokens). */
export async function expectAuditClean(h: Harness, terms: readonly string[], after = '0'): Promise<void> {
  const rows = await h.scratch.owner<{ details: string }[]>`
    select details::text as details from sineobex.audit_events where id > ${after}::bigint`;
  const text = rows.map((r) => r.details.toLowerCase()).join('\n');
  for (const t of terms) expect(text, `audit details mention "${t}"`).not.toContain(t.toLowerCase());
}

// ------------------------------------------------------------------------------------------------
// Logs
// ------------------------------------------------------------------------------------------------

export interface LogSpy {
  /** Pass as createHarness({ log }). */
  log: Logger;
  lines: string[];
  /** No line mentions any of these strings (seeded names, aliases, birth dates, tokens, search text). */
  expectClean(terms: readonly string[]): void;
}

/** A logger that keeps every line the API writes, through the real allowlist. */
export function logSpy(): LogSpy {
  const lines: string[] = [];
  return {
    log: createLogger({ level: 'debug', sink: (line) => lines.push(line) }),
    lines,
    expectClean(terms) {
      const text = lines.join('\n').toLowerCase();
      for (const t of terms) expect(text, `a log line mentions "${t}"`).not.toContain(t.toLowerCase());
    },
  };
}
