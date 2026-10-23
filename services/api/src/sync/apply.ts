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
  MAX_NOTE_FIELDS,
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
  QuarantineReasonName,
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
  awaiting_review:
    'The record this belongs to is waiting for a Program Admin’s review. This was sent for review with it.',
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
  /**
   * A push: a change refused for permission, or one that belongs to a record held for review, is
   * held for review too. An admin's accept: it fails outright.
   */
  holdForReview: boolean;
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

/** Whose a change ID is: the team, person and phone that sent it. */
export interface ChangeOwner {
  teamId: string;
  userId: string;
  deviceId: string;
}

/**
 * Everyone holding this change ID, as a receipt or a change held for review, in any team. IDs are
 * unique across teams but a transaction sees only its own team's rows (migration 0005).
 */
export async function changeOwners(tx: Tx, changeId: string): Promise<ChangeOwner[]> {
  return tx<ChangeOwner[]>`select team_id, user_id, device_id from sineobex.change_owner(${changeId})`;
}

export const sameOwner = (a: ChangeOwner, b: ChangeOwner) =>
  a.teamId === b.teamId && a.userId === b.userId && a.deviceId === b.deviceId;

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
    if (change.supersedes || change.conflictOf) {
      const fixed = (await settle(tx, actor, change)).filter((s) => s.status === 'rejected');
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

/**
 * Settles the rejections and conflicts an accepted fix or choice covers, so none stays open on the
 * server once the phone holds nothing of it. That is what the phone folded into it: its earlier
 * unsettled changes to the same field (a fix or a choice covers every one, linked or not), or for
 * a fixed create the record's rejections (edits sent with the failed create were refused only
 * because the record didn't exist). Then, by the person's own links, in this team, what each of
 * those fixed or resolved in turn: a fix of a fix, or a choice made on a fix that met a conflict,
 * under any ID the phone had. Links are followed by primary key, and the field is found through
 * sync_changes_record. `union` drops a row it has already seen, so links in a circle end the walk.
 * A change held for review is the admin's to settle.
 */
async function settle(tx: Tx, actor: ApplyActor, c: SyncChangeInput) {
  const open = tx`s.status in ('rejected', 'conflict') and s.resolved_by_change is null
    and coalesce(s.details ->> 'quarantined', 'false') <> 'true'`;
  return tx<{ changeId: string; status: 'rejected' | 'conflict' }[]>`
    with recursive covered (change_id, supersedes, conflict_of) as (
      select s.change_id, s.supersedes, s.conflict_of from sineobex.sync_changes s
      where s.change_id = ${c.changeId}
         or (s.team_id = ${actor.teamId} and s.user_id = ${actor.authorId} and s.record_id = ${c.recordId}
             and ${open} and ${
               c.op === 'create'
                 ? tx`s.status = 'rejected'`
                 : tx`s.device_id = ${actor.deviceId} and s.field = ${c.field ?? null} and s.device_seq < ${c.seq}`
             })
      union
      select s.change_id, s.supersedes, s.conflict_of
      from covered k join sineobex.sync_changes s on s.change_id in (k.supersedes, k.conflict_of)
      where s.team_id = ${actor.teamId} and s.user_id = ${actor.authorId}
    )
    update sineobex.sync_changes s set resolved_by_change = ${c.changeId}
    from covered k
    where s.change_id = k.change_id and s.change_id <> ${c.changeId} and ${open}
    returning s.change_id, s.status`;
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
    if (!actor.holdForReview) return rejected('permission');
    return hold(tx, audit, actor, c, hash, 'permission');
  }

  if (c.op !== 'create' && c.op !== 'set')
    return rejected('validation', { problem: 'append_only_for_audit' });
  const outcome = c.op === 'create' ? await create(tx, audit, actor, c) : await set(tx, audit, actor, c);
  // The record isn't on the chart because the person's own create of it waits for review: this
  // change can't be applied before that decision, and isn't wrong either, so it waits with it.
  if (actor.holdForReview && outcome.status === 'rejected' && outcome.reason === 'stale_reference') {
    const waitsOn = await heldCreate(tx, actor, c);
    if (waitsOn) return hold(tx, audit, actor, c, hash, 'awaiting_review', { waitsOn });
  }
  return outcome;
}

/** Holds a change for a Program Admin to review, and tells the phone it may let go of it. */
async function hold(
  tx: Tx,
  audit: AuditFn,
  actor: ApplyActor,
  c: SyncChangeInput,
  hash: string,
  reason: 'permission' | 'awaiting_review',
  details: Record<string, unknown> = {},
): Promise<Outcome> {
  await quarantine(tx, actor, c, hash, reason);
  await audit({
    action: 'sync.quarantined',
    entity: c.entity,
    entityId: c.recordId,
    details: { changeId: c.changeId, reason, ...details },
  });
  return { status: 'rejected', reason, quarantined: true };
}

/**
 * The person's own create, still waiting for review, of the record [c] needs on the chart: the
 * record it changes, or a new note's encounter. Returns that create's change ID.
 */
export async function heldCreate(
  tx: Tx,
  actor: Pick<ApplyActor, 'teamId' | 'authorId'>,
  c: SyncChangeInput,
): Promise<string | null> {
  let needs: { entity: RecordEntityName; id: string };
  if (c.op === 'set' && (c.entity === 'encounter' || c.entity === 'encounter_note')) {
    needs = { entity: c.entity, id: c.recordId };
  } else if (c.op === 'create' && c.entity === 'encounter_note') {
    const parsed = NoteCreate.safeParse(c.value);
    if (!parsed.success) return null;
    needs = { entity: 'encounter', id: parsed.data.encounterId };
  } else {
    return null;
  }
  const rows = await tx<{ changeId: string }[]>`
    select change_id from sineobex.quarantine_items
    where team_id = ${actor.teamId} and user_id = ${actor.authorId} and status = 'pending'
      and op = 'create' and entity = ${needs.entity} and record_id = ${needs.id}
    limit 1`;
  return rows[0]?.changeId ?? null;
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
  const dataFields = Object.keys(record.fieldVersions).filter((f) => f.startsWith('data.'));
  if (field.startsWith('data.') && !(field in record.fieldVersions) && dataFields.length >= MAX_NOTE_FIELDS) {
    return rejected('validation', { problem: 'too_many_fields' });
  }
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
  reason: QuarantineReasonName,
): Promise<boolean> {
  // Received at the moment it is stored, not when its transaction began: a hand-over stores a
  // phone's work in one transaction, and the queue then shows it in the order it was made, so a
  // record comes before what belongs to it.
  const rows = await tx`
    insert into sineobex.quarantine_items
      (team_id, device_id, user_id, change_id, entity, record_id, op, field, value, value_hash,
       details, device_time, reason, received_at)
    values (${actor.teamId}, ${actor.deviceId}, ${actor.authorId}, ${c.changeId}, ${c.entity}, ${c.recordId},
            ${c.op}, ${c.field ?? null}, ${jsonb(tx, c.value)}, ${hash},
            ${jsonb(tx, changeDetails(c))}, ${new Date(c.deviceTime)}, ${reason}, clock_timestamp())
    on conflict (change_id) do nothing
    returning id`;
  return rows.length > 0;
}
