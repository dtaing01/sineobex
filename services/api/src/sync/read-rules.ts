import { ACCESS_RULES, type AccessRule, type Permission } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { RULES } from './entities/index.ts';
import type { StoredRecord } from './records.ts';

/**
 * Who may read a record of each kind through sync at all (phase 3 design 3.6, 4.1; phase 4
 * lifecycle 6.1, 6.4 rule 7). The one copy (D99; the coordinator's decision on review findings
 * VA-1 and VS-1): the sync read refuses a request by it (routes/sync.ts requireRead), the review
 * queue hides a held change by it (review.ts shownChange), and a value sent back to a phone holds
 * nothing by it (apply.ts fieldForAnswer), so the three cannot drift. The sync read feeds editing,
 * so a visit's records need encounters.chart; a problem and its notes the problem list's rule;
 * every other record, a referral among them, patients.view. The note rule, a sensitive problem's
 * and a Medical visit's summary's come after this.
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

/**
 * Whether [permissions] read this stored record through sync at all: its kind's rule (readNeed),
 * then a sensitive problem's, for the problem and for a note on it. What a note shows of its
 * answers, and a visit of its summary, the caller asks next.
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
  return true;
}
