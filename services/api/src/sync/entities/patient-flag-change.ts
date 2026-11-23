import type { z } from '@hono/zod-openapi';
import type { AuditFn } from '../../auth/context.ts';
import type { Permission } from '../../auth/permissions.ts';
import type { Tx } from '../../db/database.ts';
import { flagHead, flagHidden, type FlagHead } from '../read-rules.ts';
import {
  bookkeeping,
  invalid,
  receivedAtOf,
  rejected,
  when,
  type EntityRules,
  type FieldMeta,
  type StoredRecord,
} from '../records.ts';
import { FlagChangeCreate, flagReasonInvalid, Retraction, valueParents, valueProblem } from './values.ts';

/**
 * A patient's flag changes (phase 5 design 4.5, 6.2): a flag set or cleared, with a reason, by
 * anyone who edits the chart, from a phone or from the portal. A flag is never a value two phones
 * could overwrite: each change is a record of its own, created once, and the current flags are
 * folded from them (currentFlags, 5.3). It copies a referral's shape (referral.ts): never
 * overwritten, and its one change is entered in error, set once with a reason, by its author or a
 * Program Admin. The database wants who and when with the reason
 * (patient_flag_changes_error_with_status, 0024), so all three are written with the status.
 *
 * It is refused only for what its sender can fix: a flag the team does not hold (unknown_flag,
 * Choose a flag) and its reason (reason_invalid, Change the reason). A flag hidden from its sender
 * is held for a Program Admin, as a lowered role is. An archived flag is taken from a phone: it
 * stays on the patient (5.1), as every record made against an older state is.
 */

type Value = z.infer<typeof FlagChangeCreate>;

/** A flag change to store, from a phone's change or from the portal's form (design 4.5, 7). */
export interface NewFlagChange {
  id: string;
  teamId: string;
  patientId: string;
  flagId: string;
  action: 'set' | 'clear';
  reason: string;
  authorUserId: string;
  /** What the author may do and see: the flag rule is asked of them (design 6.2). */
  permissions: ReadonlySet<Permission>;
  /** When it was made, by the phone's clock (when(c)); null at the desk, where it is the receipt. */
  at: Date | null;
  /** The phone's own time; null from the portal. */
  deviceTime: Date | null;
  clockVerified: boolean;
  /** The phone and the sync change that carried it; null from the portal. */
  deviceId: string | null;
  changeId: string | null;
  /** The Program Admin who accepted it from review. */
  approvedBy: string | null;
  /** When the server first received it: a held change's hold time (receivedAtOf); null, now. */
  receivedAt: Date | null;
  /** What the audit event names before the change's own details: the sync change, on whose behalf. */
  auditDetails: Record<string, unknown>;
}

/**
 * Why a flag change is not stored, in the shared check's order: a flag the team does not hold as a
 * flag, then its reason, then the flag rule; `archived` only where the caller asks for it.
 */
export type FlagChangeRefusal = 'unknown_flag' | 'reason_invalid' | 'hidden' | 'archived';

/**
 * The one check and insert of a flag change, which the push and the portal's flag route both call,
 * so the online and offline paths cannot drift (design 7, D99): the flag, then the reason, then the
 * flag rule, each answered before anything is written, then the row and its audit event in the
 * caller's transaction. The flag is read with its sensitive uncast (flagHead) and checked before the
 * insert, so its foreign key never throws inside a push. `refuseArchivedSet` is the portal's rule: a
 * flag no longer on the team's list is never offered to be set (5.1). `stored` is false when the id
 * is taken, and then nothing is written.
 */
export async function insertFlagChange(
  tx: Tx,
  audit: AuditFn,
  change: NewFlagChange,
  { refuseArchivedSet = false }: { refuseArchivedSet?: boolean } = {},
): Promise<{ refused: FlagChangeRefusal } | { stored: boolean; flag: FlagHead }> {
  const flag = await flagHead(tx, change.teamId, change.flagId);
  if (!flag) return { refused: 'unknown_flag' };
  if (flagReasonInvalid(change.reason)) return { refused: 'reason_invalid' };
  if (flagHidden(change.permissions, flag)) return { refused: 'hidden' };
  // PLAN-OPEN (BM-78): what happens to the patients who carry a flag when it is archived? It stays
  // on them and can be cleared; it is never offered to be set again, so only the portal, which
  // offers it, refuses a set. A phone that set it offline before it was archived is taken.
  if (refuseArchivedSet && change.action === 'set' && flag.state === 'archived')
    return { refused: 'archived' };
  // PLAN-OPEN (PL-24): which time orders a patient's flag changes? The change's own time, never later
  // than when the server received it, as a patient's last seen (D90): a phone whose clock runs ahead
  // never wins every change. The receipt is the database's clock (a hold's time, else now), never
  // the API's, which can run ahead of it: 0024's check compares the two.
  const rows = await tx`
    insert into sineobex.patient_flag_changes (id, team_id, patient_id, flag_id, action, reason, effective_at,
      received_at, device_time, clock_verified, author_user_id, created_device_id, change_id, approved_by)
    select ${change.id}, ${change.teamId}, ${change.patientId}, ${change.flagId}, ${change.action},
           ${change.reason}, least(coalesce(${change.at}::timestamptz, r.at), r.at), r.at,
           ${change.deviceTime}::timestamptz, ${change.clockVerified}, ${change.authorUserId},
           ${change.deviceId}::uuid, ${change.changeId}::uuid, ${change.approvedBy}::uuid
    from (select coalesce(${change.receivedAt}::timestamptz, now()) as at) r
    on conflict (id) do nothing
    returning id`;
  if (rows.length === 0) return { stored: false, flag };
  await audit({
    action: 'patient_flag.changed',
    entity: 'patient_flag_change',
    entityId: change.id,
    patientId: change.patientId,
    deviceTime: change.deviceTime,
    details: { ...change.auditDetails, action: change.action, ...flagDetails(flag, change.flagId) },
  });
  return { stored: true, flag };
}

/**
 * What a flag change's audit event names of its flag: its tier, and its id only when it is not
 * sensitive. Every member reads the team's flags by id, and the audit chain is never redacted (D41),
 * so a sensitive flag's id would tell any reader of the log what the chart hides (design 9).
 */
const flagDetails = (flag: FlagHead | null, flagId: string) => ({
  tier: flag?.tier ?? null,
  ...(flag && !flag.sensitive ? { flagId } : {}),
});

/** The change's flag as the team holds it now, read with the change (load). */
const flagOf = (rec: StoredRecord) => rec.internal.flag as FlagHead | null;

/** A flag change as its row holds it (flagChangeColumns). */
export interface FlagChangeRow {
  id: string;
  teamId: string;
  patientId: string;
  flagId: string;
  action: 'set' | 'clear';
  reason: string;
  effectiveAt: Date;
  clockVerified: boolean;
  status: 'active' | 'entered_in_error';
  errorReason: string | null;
  errorBy: string | null;
  errorAt: Date | null;
  authorUserId: string;
  version: number;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  receivedAt: Date;
  updatedAt: Date;
}

/** The columns of a flag change `f`, as load reads them and the chart reads its group's (charts.ts). */
export const flagChangeColumns = (tx: Tx) => tx`
  f.id, f.team_id, f.patient_id, f.flag_id, f.action, f.reason, f.effective_at, f.clock_verified, f.status,
  f.error_reason, f.error_by, f.error_at, f.author_user_id, f.version, f.field_versions, f.field_meta,
  f.received_at, f.updated_at`;

/**
 * A flag change as sync reads it, from its row and its flag as the team holds it now: the one shape
 * the sync read, a value sent back and the chart's flagChanges all snapshot (design 6.1), so the
 * phone imports the same record whichever way it came.
 */
export function flagChangeRecord(r: FlagChangeRow, flag: FlagHead | null): StoredRecord {
  return {
    entity: 'patient_flag_change',
    id: r.id,
    teamId: r.teamId,
    status: r.status,
    authorUserId: r.authorUserId,
    version: r.version,
    patientId: r.patientId,
    fieldVersions: r.fieldVersions,
    fieldMeta: r.fieldMeta,
    values: { enteredInError: r.status === 'entered_in_error' ? { reason: r.errorReason } : null },
    attributes: {
      patientId: r.patientId,
      flagId: r.flagId,
      action: r.action,
      reason: r.reason,
      effectiveAt: r.effectiveAt.toISOString(),
      clockVerified: r.clockVerified,
    },
    // The flag as the team holds it now, which mayChange and the mark's event read.
    internal: { flag },
    // Made when the server received it: a held change's hold time.
    createdAt: r.receivedAt,
    updatedAt: r.updatedAt,
  };
}

export const flagChangeRules: EntityRules<Value> = {
  entity: 'patient_flag_change',
  auditPrefix: 'patient_flag',
  // PLAN-OPEN (BM-69): who may flag a patient? Whoever holds patients.edit, the key that edits the
  // chart; its mark needs the same, and then its author or a Program Admin (mayChange).
  permission: () => 'patients.edit',
  // PLAN-OPEN (PL-19): who counts as a Program Admin, to mark someone else's flag change entered in
  // error, with no new keys? A holder of team.manage_users, as phase 4's assign reads it. Never a
  // sender the flag is hidden from, its author included once their role no longer sees it (D136):
  // held for someone who may see it.
  mayChange: (actor, rec) =>
    !flagHidden(actor.permissions, flagOf(rec)) &&
    (rec.authorUserId === actor.authorId || actor.permissions.has('team.manage_users')),
  // A patient-side record (D32).
  takesTeamLock: () => true,
  create: FlagChangeCreate,
  valueProblem: (op, field, value, today) => valueProblem('patient_flag_change', op, field, value, today),
  parents: (v) => valueParents('patient_flag_change', 'create', undefined, v),
  parentsOfSet: () => [],

  async applyCreate(ctx, v) {
    const c = ctx.change;
    const stored = await insertFlagChange(ctx.tx, ctx.audit, {
      id: c.recordId,
      teamId: ctx.actor.teamId,
      patientId: v.patientId,
      flagId: v.flagId,
      action: v.action,
      reason: v.reason,
      authorUserId: ctx.actor.authorId,
      permissions: ctx.actor.permissions,
      at: when(c),
      deviceTime: new Date(c.deviceTime),
      clockVerified: c.clockVerified,
      deviceId: ctx.actor.deviceId,
      changeId: c.changeId,
      approvedBy: ctx.actor.approvedBy,
      receivedAt: await receivedAtOf(ctx.tx, c.changeId),
      auditDetails: { ...ctx.actor.auditDetails, changeId: c.changeId, clockVerified: c.clockVerified },
    });
    // A flag hidden from its sender is no refusal they can fix: decide holds it (apply.ts).
    if ('refused' in stored)
      return stored.refused === 'hidden' ? rejected('permission') : invalid(stored.refused);
    // Its one field is the mark, so the create writes no history of its own, as a referral's.
    return stored.stored ? { status: 'accepted', serverVersion: 1 } : invalid('record_exists');
  },

  // PLAN-OPEN (PL-18): what happens to a flag change made on the wrong patient? It is marked entered
  // in error, once, with a reason, and stays: a second mark is kept in history (set_once).
  fieldClass: (field) => (field === 'enteredInError' ? 'set_once' : null),
  fieldSchema: (field) => (field === 'enteredInError' ? Retraction : null),

  async load(tx, id, lock) {
    const rows = await tx<FlagChangeRow[]>`
      select ${flagChangeColumns(tx)} from sineobex.patient_flag_changes f where f.id = ${id}
      ${lock ? tx`for no key update` : tx``}`;
    const r = rows[0];
    return r ? flagChangeRecord(r, await flagHead(tx, r.teamId, r.flagId)) : null;
  },

  async write(tx, rec, field, value, version, meta) {
    const { reason } = value as { reason: string };
    const rows = await tx<{ version: number }[]>`
      update sineobex.patient_flag_changes
      set status = 'entered_in_error', error_reason = ${reason}, error_by = ${meta.by}, error_at = ${meta.at},
          ${bookkeeping(tx, field, version, meta)}
      where id = ${rec.id} returning version`;
    return rows[0]!.version;
  },

  writeAction: () => 'patient_flag.entered_in_error',
  // The flag it was about, as its create's event names it: never a sensitive flag's id.
  writeDetails: (s) => flagDetails(flagOf(s.rec), s.rec.attributes.flagId as string),
};
