import { z } from '@hono/zod-openapi';
import type { AuditFn } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { Uuid } from '../routes/schemas.ts';
import { canonicalJson } from './canonical.ts';
import {
  appendHistory,
  EncounterCreate,
  fieldSchema,
  fieldState,
  insertEncounter,
  insertNote,
  isBlank,
  jsonb,
  jsonProblem,
  isLocked,
  loadRecord,
  MAX_VALUE_BYTES,
  NoteCreate,
  sameValue,
  writeField,
  type CreateInput,
  type HistoryEntry,
  type StoredRecord,
} from './records.ts';
import type {
  FieldStateValue,
  RecordEntityName,
  RejectReasonName,
  SyncChangeInput,
  SyncResultValue,
} from './schemas.ts';

/**
 * Applies one change entry from a phone (module 9) and writes its receipt. The caller runs this
 * inside one transaction with the audit entry, so a change is either stored with its receipt and
 * audit event, or not at all.
 */

/** Plain-English messages for rejections. Fixed strings: never built from the change. */
export const REJECT_MESSAGES: Record<RejectReasonName, string> = {
  validation: 'This entry has a problem. Open it, fix it and send it again.',
  signing_rule: 'Your credential can’t sign this note type. It was saved unsigned for a co-signer.',
  stale_reference: 'The record this belongs to no longer exists or was merged.',
  permission: 'You no longer have access to change this. It was sent to a Program Admin to review.',
  record_locked: 'This note is signed. Add an addendum instead.',
  hash_mismatch: 'The value arrived damaged. The app will send it again.',
};

/** Whose change this is, and what they may do. */
export interface ApplyActor {
  teamId: string;
  /** The person who made the change on the phone. */
  authorId: string;
  /** Who approved it, when someone else did (a Program Admin accepting a quarantined change). */
  approvedBy: string | null;
  deviceId: string;
  canChart: boolean;
  /** Changes refused for permission go to quarantine (push) or fail outright (an admin's accept). */
  quarantineOnPermission: boolean;
  /** Added to every audit event, e.g. { onBehalfOf } when an admin applies someone else's change. */
  auditDetails?: Record<string, unknown>;
}

type Outcome =
  | { status: 'accepted'; serverVersion: number }
  | { status: 'rejected'; reason: RejectReasonName; details?: Record<string, unknown>; quarantined?: boolean }
  | { status: 'conflict'; server: FieldStateValue };

const AuditAppend = z
  .object({
    action: z.enum(['patient.viewed', 'patient.searched', 'encounter.viewed', 'note.viewed']),
    entity: z
      .string()
      .regex(/^[a-z_]{1,40}$/)
      .optional(),
    entityId: Uuid.optional(),
    patientId: Uuid.optional(),
    resultCount: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();

const PREFIX: Record<RecordEntityName, string> = { encounter: 'encounter', encounter_note: 'note' };

const rejected = (reason: RejectReasonName, details?: Record<string, unknown>): Outcome => ({
  status: 'rejected',
  reason,
  ...(details ? { details } : {}),
});

function issues(error: z.ZodError): Record<string, unknown> {
  // Paths and codes only: zod messages are safe today, but a value must never reach a log.
  return { problems: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), code: i.code })) };
}

const when = (c: SyncChangeInput) => new Date(c.correctedTime ?? c.deviceTime);

/**
 * Pure checks that need no database: the value is storable and its hash matches. A broken value
 * is a lasting rejection, stored and logged like any other. A hash mismatch is not: nothing is
 * stored, so the same change can be sent again once the phone is fixed.
 */
export type Precheck =
  { ok: true; hash: string } | { ok: false; outcome: Outcome & { status: 'rejected' }; store: boolean };

export async function precheck(change: SyncChangeInput): Promise<Precheck> {
  const lasting = (problem: string): Precheck => ({
    ok: false,
    outcome: { status: 'rejected', reason: 'validation', details: { problem } },
    store: true,
  });
  if (change.value === undefined) return lasting('value_missing');
  let text: string;
  try {
    text = canonicalJson(change.value);
  } catch {
    return lasting('not_json');
  }
  // Checked for every change, because quarantine stores values without a field schema.
  if (jsonProblem(change.value)) return lasting('unstorable_value');
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_VALUE_BYTES) return lasting('too_large');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hash !== change.valueHash) {
    return { ok: false, outcome: { status: 'rejected', reason: 'hash_mismatch' }, store: false };
  }
  return { ok: true, hash };
}

export function toResult(changeId: string, o: Outcome, hash?: string): SyncResultValue {
  switch (o.status) {
    case 'accepted':
      return { changeId, status: 'accepted', serverVersion: o.serverVersion, ...(hash ? { hash } : {}) };
    case 'conflict':
      return { changeId, status: 'conflict', serverVersion: o.server.version, server: o.server };
    case 'rejected':
      return {
        changeId,
        status: 'rejected',
        reason: o.reason,
        message: REJECT_MESSAGES[o.reason],
        ...(o.details ? { details: o.details } : {}),
        ...(o.quarantined ? { quarantined: true, ...(hash ? { hash } : {}) } : {}),
      };
  }
}

interface Receipt {
  changeId: string;
  userId: string;
  deviceId: string;
  entity: string;
  recordId: string;
  field: string | null;
  valueHash: string;
  status: 'accepted' | 'rejected' | 'conflict';
  serverVersion: number | null;
  reason: RejectReasonName | null;
  details: Record<string, unknown> | null;
}

export async function findReceipt(tx: Tx, changeId: string): Promise<Receipt | null> {
  const rows = await tx<Receipt[]>`
    select change_id, user_id, device_id, entity, record_id, field, value_hash, status,
           server_version, reason, details
    from sineobex.sync_changes where change_id = ${changeId}`;
  return rows[0] ?? null;
}

/** The answer for a change the server already has. Conflicts show the server's current value. */
export async function resultFromReceipt(tx: Tx, r: Receipt): Promise<SyncResultValue> {
  if (r.status === 'accepted') {
    return {
      changeId: r.changeId,
      status: 'accepted',
      serverVersion: r.serverVersion ?? 0,
      hash: r.valueHash,
    };
  }
  if (r.status === 'rejected') {
    const quarantined = r.details?.quarantined === true;
    return toResult(
      r.changeId,
      { status: 'rejected', reason: r.reason ?? 'validation', details: r.details ?? undefined, quarantined },
      r.valueHash,
    );
  }
  const record =
    r.entity === 'encounter' || r.entity === 'encounter_note'
      ? await loadRecord(tx, r.entity, r.recordId, false)
      : null;
  const server =
    record && r.field
      ? fieldState(record, r.field)
      : { value: null, version: 0, changedBy: null, changedAt: null };
  return toResult(r.changeId, { status: 'conflict', server });
}

/**
 * Applies a change that passed `precheck` and has no receipt yet, then stores its receipt.
 * Returns what the phone is told.
 */
export async function applyChange(
  tx: Tx,
  audit: AuditFn,
  actor: ApplyActor,
  change: SyncChangeInput,
  hash: string,
  /** A rejection precheck already decided; stored and logged without touching any record. */
  rejection?: Outcome,
): Promise<SyncResultValue> {
  const outcome = rejection ?? (await decide(tx, audit, actor, change, hash));
  await storeReceipt(tx, actor, change, hash, outcome);

  if (outcome.status === 'accepted') {
    if (change.supersedes) {
      // A fixed create also settles the record's other rejections by this person: edits sent
      // with the failed create were refused only because the record didn't exist, and the phone
      // folds their values into the fix.
      const fixed = await tx<{ changeId: string }[]>`
        update sineobex.sync_changes set resolved_by_change = ${change.changeId}
        where user_id = ${actor.authorId} and status = 'rejected' and resolved_by_change is null
          and (change_id = ${change.supersedes}
               or (${change.op === 'create'} and record_id = ${change.recordId}))
        returning change_id`;
      if (fixed.length > 0) {
        await audit({
          action: 'sync.rejection_fixed',
          entity: change.entity,
          entityId: change.recordId,
          details: {
            ...actor.auditDetails,
            changeIds: fixed.map((f) => f.changeId),
            fixedBy: change.changeId,
          },
        });
      }
    }
    if (change.conflictOf) {
      await tx`
        update sineobex.sync_changes set resolved_by_change = ${change.changeId}
        where change_id = ${change.conflictOf} and user_id = ${actor.authorId}
          and status = 'conflict' and resolved_by_change is null`;
    }
  } else if (outcome.status === 'conflict') {
    await audit({
      action: 'sync.conflict',
      entity: change.entity,
      entityId: change.recordId,
      details: {
        ...actor.auditDetails,
        changeId: change.changeId,
        field: change.field,
        serverVersion: outcome.server.version,
      },
    });
  } else if (!outcome.quarantined) {
    await audit({
      action: 'sync.rejected',
      entity: change.entity,
      entityId: change.recordId,
      details: {
        ...actor.auditDetails,
        changeId: change.changeId,
        reason: outcome.reason,
        ...outcome.details,
      },
    });
  }
  return toResult(change.changeId, outcome, hash);
}

async function storeReceipt(tx: Tx, actor: ApplyActor, c: SyncChangeInput, hash: string, o: Outcome) {
  const serverVersion =
    o.status === 'accepted' ? o.serverVersion : o.status === 'conflict' ? o.server.version : null;
  const reason = o.status === 'rejected' ? o.reason : null;
  const details =
    o.status === 'rejected' ? { ...o.details, ...(o.quarantined ? { quarantined: true } : {}) } : null;
  // An admin accepting a quarantined change replaces the receipt its push got (quarantined,
  // rejected or in conflict). An accepted receipt is final.
  await tx`
    insert into sineobex.sync_changes
      (change_id, team_id, device_id, user_id, device_seq, entity, record_id, op, field, value_hash,
       base_version, follows, supersedes, conflict_of, resolution, device_time, corrected_time,
       clock_verified, status, server_version, reason, details)
    values (${c.changeId}, ${actor.teamId}, ${actor.deviceId}, ${actor.authorId}, ${c.seq}, ${c.entity},
            ${c.recordId}, ${c.op}, ${c.field ?? null}, ${hash}, ${c.baseVersion}, ${c.follows ?? null},
            ${c.supersedes ?? null}, ${c.conflictOf ?? null}, ${c.resolution ?? null}, ${new Date(c.deviceTime)},
            ${c.correctedTime ? new Date(c.correctedTime) : null}, ${c.clockVerified}, ${o.status},
            ${serverVersion}, ${reason}, ${details ? jsonb(tx, details) : null})
    on conflict (change_id) do update
      set status = excluded.status, server_version = excluded.server_version,
          reason = excluded.reason, details = excluded.details
      where sineobex.sync_changes.status <> 'accepted'`;
}

async function decide(
  tx: Tx,
  audit: AuditFn,
  actor: ApplyActor,
  c: SyncChangeInput,
  hash: string,
): Promise<Outcome> {
  if (c.entity === 'audit') {
    if (c.op !== 'append') return rejected('validation', { problem: 'audit_is_append_only' });
    const parsed = AuditAppend.safeParse(c.value);
    if (!parsed.success) return rejected('validation', issues(parsed.error));
    const v = parsed.data;
    await audit({
      action: v.action,
      entity: v.entity,
      entityId: v.entityId,
      patientId: v.patientId ?? null,
      deviceTime: new Date(c.deviceTime),
      details: {
        ...actor.auditDetails,
        offline: true,
        changeId: c.changeId,
        ...(v.resultCount === undefined ? {} : { resultCount: v.resultCount }),
      },
    });
    return { status: 'accepted', serverVersion: 1 };
  }

  if (!actor.canChart) {
    if (!actor.quarantineOnPermission) return rejected('permission');
    await quarantine(tx, actor, c, hash, 'permission');
    await audit({
      action: 'sync.quarantined',
      entity: c.entity,
      entityId: c.recordId,
      details: { changeId: c.changeId, reason: 'permission' },
    });
    return { status: 'rejected', reason: 'permission', quarantined: true };
  }

  if (c.op === 'create') return create(tx, audit, actor, c);
  if (c.op === 'set') return set(tx, audit, actor, c);
  return rejected('validation', { problem: 'append_only_for_audit' });
}

async function create(tx: Tx, audit: AuditFn, actor: ApplyActor, c: SyncChangeInput): Promise<Outcome> {
  const entity = c.entity as RecordEntityName;
  const input: CreateInput = {
    id: c.recordId,
    teamId: actor.teamId,
    authorUserId: actor.authorId,
    deviceId: actor.deviceId,
    changeId: c.changeId,
    at: when(c),
    deviceTime: new Date(c.deviceTime),
    clockVerified: c.clockVerified,
  };
  let initial: Record<string, unknown> | null;
  let patientId: string | null;
  if (entity === 'encounter') {
    const parsed = EncounterCreate.safeParse(c.value);
    if (!parsed.success) return rejected('validation', issues(parsed.error));
    initial = await insertEncounter(tx, input, parsed.data);
    patientId = parsed.data.patientId ?? null;
  } else {
    const parsed = NoteCreate.safeParse(c.value);
    if (!parsed.success) return rejected('validation', issues(parsed.error));
    const encounter = await loadRecord(tx, 'encounter', parsed.data.encounterId, false);
    if (!encounter) return rejected('stale_reference', { problem: 'encounter_missing' });
    if (isLocked(encounter)) return rejected('record_locked');
    initial = await insertNote(tx, input, parsed.data);
    patientId = encounter.patientId;
  }
  if (!initial) return rejected('validation', { problem: 'record_exists' });

  for (const [field, value] of Object.entries(initial)) {
    await appendHistory(tx, history(actor, c, entity, field, 1, value, undefined, 'created'));
  }
  await audit({
    action: `${PREFIX[entity]}.created`,
    entity,
    entityId: c.recordId,
    patientId,
    deviceTime: new Date(c.deviceTime),
    details: { ...actor.auditDetails, changeId: c.changeId, clockVerified: c.clockVerified },
  });
  return { status: 'accepted', serverVersion: 1 };
}

/** The draft reconciliation rule (Oct 19 decisions; plan D9). */
async function set(tx: Tx, audit: AuditFn, actor: ApplyActor, c: SyncChangeInput): Promise<Outcome> {
  const entity = c.entity as RecordEntityName;
  const field = c.field;
  if (!field) return rejected('validation', { problem: 'field_missing' });
  const schema = fieldSchema(entity, field);
  if (!schema) return rejected('validation', { problem: 'unknown_field' });
  const parsed = schema.safeParse(c.value);
  if (!parsed.success) return rejected('validation', issues(parsed.error));
  const value: unknown = parsed.data;

  const record = await loadRecord(tx, entity, c.recordId, true);
  if (!record) return rejected('stale_reference', { problem: 'record_missing' });
  if (isLocked(record)) return rejected('record_locked');
  const current = fieldState(record, field);
  const decider = actor.approvedBy ?? actor.authorId;
  const sawCurrent =
    c.baseVersion === current.version || (await followsCurrent(tx, actor, c, record, field, current.version));

  if (c.resolution === 'keep_server') {
    // The user looked at both and kept the server's value. Their own value is kept in history,
    // never lost, and the note's author is told when the kept value came from someone else.
    // Only the value they saw can be kept: if it changed again since, they choose again.
    if (!sawCurrent) return { status: 'conflict', server: current };
    await appendHistory(tx, {
      ...history(actor, c, entity, field, current.version, value, current.value, 'kept_both'),
      approvedBy: decider,
    });
    if (current.changedBy && current.changedBy !== actor.authorId && record.authorUserId !== decider) {
      await tx`
        insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
        values (${actor.teamId}, ${record.authorUserId}, 'conflict_resolved', ${entity}, ${record.id})`;
    }
    await audit({
      action: `${PREFIX[entity]}.conflict_resolved`,
      entity,
      entityId: record.id,
      patientId: record.patientId,
      deviceTime: new Date(c.deviceTime),
      details: {
        ...actor.auditDetails,
        changeId: c.changeId,
        field,
        kept: 'server',
        version: current.version,
      },
    });
    return { status: 'accepted', serverVersion: current.version };
  }

  // Already the server's value: nothing to write, and the phone now holds the current version.
  if (sameValue(current.value, value)) return { status: 'accepted', serverVersion: current.version };

  let kind: HistoryEntry['kind'];
  if (c.resolution === 'replace') {
    if (!sawCurrent) return { status: 'conflict', server: current };
    kind = 'replaced_after_review';
  } else if (sawCurrent) {
    kind = 'set';
  } else if (isBlank(current.value)) {
    kind = 'filled_blank';
  } else {
    // "A field that already holds a different value is never overwritten silently."
    return { status: 'conflict', server: current };
  }

  const version = current.version + 1;
  await writeField(tx, record, field, value, version, {
    by: actor.authorId,
    at: when(c).toISOString(),
    changeId: c.changeId,
  });
  await appendHistory(tx, {
    ...history(actor, c, entity, field, version, value, current.value, kind),
    approvedBy: kind === 'replaced_after_review' ? decider : actor.approvedBy,
  });
  await audit({
    action: `${PREFIX[entity]}.updated`,
    entity,
    entityId: record.id,
    patientId: record.patientId,
    deviceTime: new Date(c.deviceTime),
    details: { ...actor.auditDetails, changeId: c.changeId, field, kind, version },
  });
  return { status: 'accepted', serverVersion: version };
}

/**
 * A second edit to the same field made before the first was confirmed carries the first one's ID.
 * The person was looking at the current value if that change, by them, is what last wrote the
 * field (a set, or the create that filled it), or if its receipt shows it left the field at the
 * current version (it matched the value already there).
 */
async function followsCurrent(
  tx: Tx,
  actor: ApplyActor,
  c: SyncChangeInput,
  record: StoredRecord,
  field: string,
  version: number,
): Promise<boolean> {
  if (!c.follows) return false;
  const meta = record.fieldMeta[field];
  if (meta?.changeId === c.follows && meta.by === actor.authorId) return true;
  const prev = await findReceipt(tx, c.follows);
  return (
    prev !== null &&
    prev.status === 'accepted' &&
    prev.userId === actor.authorId &&
    prev.recordId === c.recordId &&
    prev.field === field &&
    prev.serverVersion === version
  );
}

function history(
  actor: ApplyActor,
  c: SyncChangeInput,
  entity: RecordEntityName,
  field: string,
  version: number,
  value: unknown,
  previousValue: unknown,
  kind: HistoryEntry['kind'],
): HistoryEntry {
  return {
    teamId: actor.teamId,
    entity,
    recordId: c.recordId,
    field,
    version,
    value,
    previousValue,
    kind,
    changedBy: actor.authorId,
    approvedBy: actor.approvedBy,
    changeId: c.changeId,
    deviceId: actor.deviceId,
    deviceTime: new Date(c.deviceTime),
  };
}

export function changeDetails(c: SyncChangeInput): Record<string, unknown> {
  return {
    seq: c.seq,
    baseVersion: c.baseVersion,
    follows: c.follows ?? null,
    supersedes: c.supersedes ?? null,
    conflictOf: c.conflictOf ?? null,
    resolution: c.resolution ?? null,
    correctedTime: c.correctedTime ?? null,
    clockVerified: c.clockVerified,
  };
}

/** Stores a change for a Program Admin to review. Idempotent by change ID. Returns false if it was already there. */
export async function quarantine(
  tx: Tx,
  actor: Pick<ApplyActor, 'teamId' | 'authorId' | 'deviceId'>,
  c: SyncChangeInput,
  hash: string,
  reason: 'access_removed' | 'permission',
): Promise<boolean> {
  const rows = await tx`
    insert into sineobex.quarantine_items
      (team_id, device_id, user_id, change_id, entity, record_id, op, field, value, value_hash,
       details, device_time, reason)
    values (${actor.teamId}, ${actor.deviceId}, ${actor.authorId}, ${c.changeId}, ${c.entity}, ${c.recordId},
            ${c.op}, ${c.field ?? null}, ${jsonb(tx, c.value)}, ${hash},
            ${jsonb(tx, changeDetails(c))}, ${new Date(c.deviceTime)}, ${reason})
    on conflict (change_id) do nothing
    returning id`;
  return rows.length > 0;
}
