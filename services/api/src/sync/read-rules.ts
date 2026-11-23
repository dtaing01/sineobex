import type { FlagTier } from '@sineobex/presets';
import { ACCESS_RULES, type AccessRule, type Permission } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { projectionFor } from '../patients/projection.ts';
import { RULES } from './entities/index.ts';
import type { StoredRecord } from './records.ts';

/**
 * Who may read a record of each kind through sync at all (phase 3 design 3.6, 4.1; phase 4
 * lifecycle 6.1, 6.4 rule 7). The one copy (D99; the coordinator's decision on review findings
 * VA-1 and VS-1): the sync read refuses a request by it (routes/sync.ts requireRead), the review
 * queue hides a held change by it (review.ts shownChange), and a value sent back to a phone holds
 * nothing by it (apply.ts fieldForAnswer), so the three cannot drift. The sync read feeds editing,
 * so a visit's records need encounters.chart; a problem and its notes the problem list's rule;
 * every other record, a referral and a flag change among them, patients.view. The note rule, a
 * sensitive problem's, a flag's (phase 5 design 6.2) and a Medical visit's summary's come after this.
 */
export type ReadNeed = { permission: Permission } | { rule: AccessRule };

export function readNeed(entity: string): ReadNeed {
  switch (entity) {
    case 'encounter':
    case 'encounter_note':
    case 'note_signoff':
    case 'note_addendum':
    case 'note_correction':
      return { permission: 'encounters.chart' };
    case 'problem':
    case 'problem_note':
      return { rule: 'mayViewProblems' };
    default:
      return { permission: 'patients.view' };
  }
}

/** Whether [permissions] read a record of [entity] through sync at all (readNeed). */
export function readsEntity(permissions: ReadonlySet<Permission>, entity: string): boolean {
  const need = readNeed(entity);
  return 'rule' in need ? ACCESS_RULES[need.rule](permissions) : permissions.has(need.permission);
}

/** A sensitive problem, and a note on one, is read with patients.view_sensitive (Oct 19). */
export const sensitiveHidden = (
  permissions: ReadonlySet<Permission>,
  problem: Pick<StoredRecord, 'attributes'> | null,
): boolean => problem?.attributes.sensitive === true && !permissions.has('patients.view_sensitive');

/** What the flag rule, and a flag change's own rules, read of one of the team's flags. */
export interface FlagHead {
  /** The body's tier, as text: `primary` or `secondary` in every body the API writes. */
  tier: string | null;
  sensitive: boolean;
  state: 'active' | 'archived';
}

/** One of the team's flags with what the chart, the team index, search and the flag list show of it. */
export interface TeamFlag extends FlagHead {
  id: string;
  tier: FlagTier;
  name: string;
  /** One of the named colours (FLAG_COLORS). */
  color: string;
  rank: number;
}

/**
 * The team's flags as they are now, each its head and its current version's body; only [flagId]'s
 * when one is named. Sensitive is read without a cast: a cast of a body no writer leaves would fail
 * with class 22, which stops a push at every retry (lifecycle 4.1), so such a body reads as not
 * sensitive. The one read of a flag every reader of the flag rule asks.
 */
const flagRows = (tx: Tx, teamId: string, flagId: string | null) => tx<TeamFlag[]>`
    select p.id, v.body ->> 'tier' as tier, coalesce(v.body -> 'sensitive' = 'true'::jsonb, false) as sensitive,
           p.state, v.body ->> 'name' as name, v.body ->> 'color' as color, v.body -> 'rank' as rank
    from sineobex.team_presets p
    join sineobex.team_preset_versions v
      on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    where p.team_id = ${teamId} and p.kind = 'flag' ${flagId === null ? tx`` : tx`and p.id = ${flagId}`}`;

/**
 * One of the team's flags as it is now; null when the id names no flag of the team (another kind of
 * preset, another team's, nothing).
 */
export async function flagHead(tx: Tx, teamId: string, flagId: string): Promise<FlagHead | null> {
  const [flag] = await flagRows(tx, teamId, flagId);
  return flag ?? null;
}

/** Every flag of the team as it is now, archived ones included, by ID. */
export async function teamFlags(tx: Tx, teamId: string): Promise<ReadonlyMap<string, TeamFlag>> {
  return new Map((await flagRows(tx, teamId, null)).map((f) => [f.id, f]));
}

/**
 * The flag rule, the one copy (design 6.2, D99, D136): whether [permissions] may not see [flag], a
 * flag the team does not hold or a sensitive one. The sync read, the review queue, a value sent
 * back, the chart, the team index, search and the flag routes all ask it.
 *
 * PLAN-OPEN (PL-23): who sees a sensitive flag? Whoever sees a sensitive problem: patients.view_sensitive
 * with the problem list (Projection.sensitive, the same on either surface), so a flag tells no
 * reader what the problem list would not.
 */
export const flagHidden = (
  permissions: ReadonlySet<Permission>,
  flag: Pick<FlagHead, 'sensitive'> | null,
): boolean => flag === null || (flag.sensitive && !projectionFor(permissions, 'portal').sensitive);

/**
 * A flag change as [readerId] may see it (design 6.2): nothing of it when [flag], its flag as the
 * team holds it now, is hidden from them; else the change, without its reason or its mark's when it
 * is entered in error and they neither made it nor are a Program Admin. A reason left out leaves no
 * key, and the mark's field holds `{}`: marked, and nothing of why.
 *
 * PLAN-OPEN (PL-18): what happens to a flag change made on the wrong patient? It is marked entered in
 * error, and its reasons are then shown only to its author and Program Admins: a reason written
 * about one patient is kept from the readers of another's chart.
 * PLAN-OPEN (PL-19): who counts as a Program Admin here, with no new keys? A holder of
 * team.manage_users, as phase 4's assign reads it.
 */
export function flagChangeShown(
  permissions: ReadonlySet<Permission>,
  readerId: string,
  change: StoredRecord,
  flag: Pick<FlagHead, 'sensitive'> | null,
): StoredRecord | null {
  if (flagHidden(permissions, flag)) return null;
  if (
    change.status !== 'entered_in_error' ||
    change.authorUserId === readerId ||
    permissions.has('team.manage_users')
  )
    return change;
  const { reason: _, ...attributes } = change.attributes;
  return { ...change, attributes, values: { ...change.values, enteredInError: {} } };
}

/**
 * Whether [permissions] read this stored record through sync at all: its kind's rule (readNeed),
 * then a sensitive problem's, for the problem and for a note on it, and the flag rule for a flag
 * change. What a note shows of its answers, a visit of its summary and a flag change of its reasons,
 * the caller asks next.
 */
export async function readsRecord(
  tx: Tx,
  permissions: ReadonlySet<Permission>,
  record: StoredRecord,
): Promise<boolean> {
  if (!readsEntity(permissions, record.entity)) return false;
  if (record.entity === 'problem') return !sensitiveHidden(permissions, record);
  if (record.entity === 'problem_note') {
    const problem = await RULES.problem.load(tx, record.attributes.problemId as string, false);
    return !sensitiveHidden(permissions, problem);
  }
  if (record.entity === 'patient_flag_change')
    return !flagHidden(permissions, await flagHead(tx, record.teamId, record.attributes.flagId as string));
  return true;
}
