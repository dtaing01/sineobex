import type { z } from '@hono/zod-openapi';
import type { AuditFn } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { canonicalJson } from './canonical.ts';
import { applyField } from './entities/fields.ts';
import { missingParent, missingProblem, rulesFor } from './entities/index.ts';
import { AuditAppend, type ParentRef } from './entities/values.ts';
import {
  fieldState,
  invalid,
  jsonb,
  jsonProblem,
  MAX_VALUE_BYTES,
  rejected,
  type ApplyActor,
  type ChangeContext,
  type EntityRules,
  type Outcome,
  type StoredRecord,
} from './records.ts';
import type { QuarantineReasonName, RejectReasonName, SyncChangeInput, SyncResultValue } from './schemas.ts';

export type { ApplyActor } from './records.ts';

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

function issues(error: z.ZodError): Record<string, unknown> {
  // Paths and codes only: zod messages are safe today, but a value must never reach a log.
  return { problems: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), code: i.code })) };
}

/** The server's date, for rules about dates (YYYY-MM-DD, UTC). */
const today = (actor: ApplyActor) => actor.now.toISOString().slice(0, 10);

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
      return {
        changeId,
        status: 'accepted',
        serverVersion: o.serverVersion,
        ...(hash ? { hash } : {}),
        ...(o.server ? { server: o.server } : {}),
        ...(o.details ? { details: o.details } : {}),
      };
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

/**
 * The answer for a change the server already has, so a retry gets the answer the first attempt
 * got. A conflict, and a value kept but not applied (kept both, history only), show the field as
 * the server holds it now.
 */
export async function resultFromReceipt(tx: Tx, r: Receipt): Promise<SyncResultValue> {
  const current = async (recordId: string) => {
    const record = await rulesFor(r.entity)?.load(tx, recordId, false);
    return record && r.field
      ? fieldState(record, r.field)
      : { value: null, version: 0, changedBy: null, changedAt: null };
  };
  if (r.status === 'accepted') {
    const details = r.details ?? undefined;
    const kept = details?.outcome === 'kept_both' || details?.outcome === 'history_only';
    const on = typeof details?.redirectedTo === 'string' ? details.redirectedTo : r.recordId;
    return toResult(
      r.changeId,
      {
        status: 'accepted',
        serverVersion: r.serverVersion ?? 0,
        ...(kept ? { server: await current(on) } : {}),
        ...(details ? { details } : {}),
      },
      r.valueHash,
    );
  }
  if (r.status === 'rejected') {
    const quarantined = r.details?.quarantined === true;
    return toResult(
      r.changeId,
      { status: 'rejected', reason: r.reason ?? 'validation', details: r.details ?? undefined, quarantined },
      r.valueHash,
    );
  }
  return toResult(r.changeId, { status: 'conflict', server: await current(r.recordId) });
}

/**
 * An accepted change that never reached the chart as the person sent it: kept as the other value
 * of a review, kept in history only, or applied to a merged record's survivor.
 */
function keptNotApplied(details: Record<string, unknown> | null): boolean {
  return (
    details?.outcome === 'kept_both' ||
    details?.outcome === 'history_only' ||
    details?.redirectedTo !== undefined
  );
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
 * applyChange inside a savepoint (phase 3 design 2.2 step 5, D42). A database integrity error
 * (SQLSTATE class 23: not null, foreign key, unique, check) means a rule the API should have
 * checked first wasn't: it would fail the same way on every retry, and a push stops at a failing
 * change, so the phone's queue would never move again. Instead the change's writes roll back and it
 * is stored as a rejection naming the constraint (schema, never a value), which the worker sees and
 * fixes, and the devices page counts as the bug report it is. Any other error (a deadlock, a lost
 * connection) may succeed on retry, so it still aborts the transaction and stops the batch.
 *
 * Everything inside runs on the savepoint's own handle: postgres.js fails the whole transaction
 * when a query on the outer handle fails, even one that was caught.
 */
export async function applyInSavepoint(
  tx: Tx,
  audit: AuditFn,
  actor: ApplyActor,
  change: SyncChangeInput,
  hash: string,
  rejection?: Outcome,
): Promise<SyncResultValue> {
  try {
    return await tx.savepoint((sp) => applyChange(sp, audit, actor, change, hash, rejection));
  } catch (err) {
    const broken = integrityError(err);
    if (!broken) throw err;
    return applyChange(tx, audit, actor, change, hash, invalid('server_constraint', broken));
  }
}

/** The constraint an integrity error names, or null for any other error. */
function integrityError(err: unknown): { constraint: string | null; sqlstate: string } | null {
  const e = err as { code?: unknown; constraint_name?: unknown } | null;
  if (typeof e?.code !== 'string' || !e.code.startsWith('23')) return null;
  return { constraint: typeof e.constraint_name === 'string' ? e.constraint_name : null, sqlstate: e.code };
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
  // An accepted receipt keeps its details too (kept both, redirected, a link's outcome), so a
  // retry gets the same answer (design 2.5).
  const details =
    o.status === 'rejected'
      ? { ...o.details, ...(o.quarantined ? { quarantined: true } : {}) }
      : o.status === 'accepted'
        ? (o.details ?? null)
        : null;
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
  const rules = rulesFor(c.entity);
  if (!rules) {
    if (c.op !== 'append') return invalid('audit_is_append_only');
    const parsed = AuditAppend.safeParse(c.value);
    if (!parsed.success) return rejected('validation', issues(parsed.error));
    const v = parsed.data;
    // Offline reads join the chain as the person's own, at their device time. Search text never
    // travels (D41); which patients a search showed does, so each one's access report finds it.
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
        ...(v.patientIds === undefined ? {} : { patientIds: v.patientIds }),
        ...(v.criteria === undefined ? {} : { criteria: v.criteria }),
        ...(v.source === undefined ? {} : { source: v.source }),
        ...(v.checkId === undefined ? {} : { checkId: v.checkId }),
      },
    });
    return { status: 'accepted', serverVersion: 1 };
  }

  // Each entity names the existing catalog key it needs (design 2.2, D37): a community health
  // worker registers patients without being able to chart.
  if (!actor.permissions.has(rules.permission(c.op === 'set' ? 'set' : 'create', c.field))) {
    if (!actor.holdForReview) return rejected('permission');
    return hold(tx, audit, actor, c, hash, 'permission');
  }

  if (c.op !== 'create' && c.op !== 'set') return invalid('append_only_for_audit');
  const ctx: ChangeContext = { tx, audit, actor, change: c };
  const outcome = c.op === 'create' ? await create(ctx, rules) : await set(ctx, rules);
  if (actor.holdForReview && outcome.status === 'rejected') {
    // Only known once the record is: a problem marked entered in error by someone else.
    if (outcome.reason === 'permission') return hold(tx, audit, actor, c, hash, 'permission');
    // The record isn't on the chart because the person's own create of it (or of what it
    // names) waits for review: this change can't be applied before that decision, and isn't
    // wrong either, so it waits with it.
    if (outcome.reason === 'stale_reference') {
      const waitsOn = await heldCreate(tx, actor, c);
      if (waitsOn) return hold(tx, audit, actor, c, hash, 'awaiting_review', { waitsOn });
    }
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
 * The records [c] needs on the chart: for a set, the record it changes and what its value names;
 * for a create, its parents (a patient for an alias, an encounter for a note).
 */
function needs(rules: EntityRules, c: SyncChangeInput): ParentRef[] {
  if (c.op === 'set') {
    const parsed = c.field ? rules.fieldSchema(c.field)?.safeParse(c.value) : undefined;
    return [
      { entity: rules.entity, id: c.recordId },
      ...(parsed?.success ? rules.parentsOfSet(c.field!, parsed.data) : []),
    ];
  }
  const parsed = rules.create.safeParse(c.value);
  return parsed.success ? rules.parents(parsed.data) : [];
}

/**
 * The person's own create, still waiting for review, of a record [c] needs on the chart (the
 * record it changes, or a parent it names: a whole intake held, its aliases with it). Returns that
 * create's change ID.
 */
export async function heldCreate(
  tx: Tx,
  actor: Pick<ApplyActor, 'teamId' | 'authorId'>,
  c: SyncChangeInput,
): Promise<string | null> {
  const rules = rulesFor(c.entity);
  if (!rules || (c.op !== 'create' && c.op !== 'set')) return null;
  for (const need of needs(rules, c)) {
    const rows = await tx<{ changeId: string }[]>`
      select change_id from sineobex.quarantine_items
      where team_id = ${actor.teamId} and user_id = ${actor.authorId} and status = 'pending'
        and op = 'create' and entity = ${need.entity} and record_id = ${need.id}
      limit 1`;
    if (rows[0]) return rows[0].changeId;
  }
  return null;
}

/**
 * A new record (design 2.2 step 3): its value, the rules it breaks on its own, the parents it names
 * (which must exist in the team, in any status: a missing one is a stale reference, so a foreign key
 * never answers first), then the entity's own create.
 */
async function create(ctx: ChangeContext, rules: EntityRules): Promise<Outcome> {
  const parsed = rules.create.safeParse(ctx.change.value);
  if (!parsed.success) return rejected('validation', issues(parsed.error));
  const problem = rules.valueProblem?.('create', undefined, parsed.data, today(ctx.actor));
  if (problem) return invalid(problem);
  const missing = await missingParent(ctx.tx, ctx.actor.teamId, rules.parents(parsed.data));
  if (missing) return rejected('stale_reference', { problem: missingProblem(missing) });
  return rules.applyCreate(ctx, parsed.data);
}

/**
 * A change to one field (design 2.2 step 4): its value, the record (locked), what the value names,
 * the merged record's survivor when there is one, then the field's class decides (2.4).
 */
async function set(ctx: ChangeContext, rules: EntityRules): Promise<Outcome> {
  const { tx, actor, change: c } = ctx;
  const field = c.field;
  if (!field) return invalid('field_missing');
  const schema = rules.fieldSchema(field);
  const cls = rules.fieldClass(field);
  if (!schema || !cls) return invalid('unknown_field');
  const parsed = schema.safeParse(c.value);
  if (!parsed.success) return rejected('validation', issues(parsed.error));
  const value: unknown = parsed.data;
  const problem = rules.valueProblem?.('set', field, value, today(actor));
  if (problem) return invalid(problem);

  const named = await rules.load(tx, c.recordId, true);
  if (!named) return rejected('stale_reference', { problem: 'record_missing' });
  const missing = await missingParent(tx, actor.teamId, rules.parentsOfSet(field, value));
  if (missing) return rejected('stale_reference', { problem: missingProblem(missing) });
  if (rules.mayChange && !rules.mayChange(actor, named, field)) return rejected('permission');

  // A set naming a merged record applies to its survivor, as one that never saw the survivor's
  // value (design 2.7): a blank fills, the same value is a no-op, a different one is kept both.
  const redirect = rules.redirect ? await rules.redirect(tx, named, field) : null;
  const rec = redirect?.to ?? named;
  const cur = fieldState(rec, field);
  const saw =
    !redirect &&
    (c.baseVersion === cur.version || (await followsCurrent(tx, actor, c, rec, field, cur.version)));
  const outcome = await applyField(cls, { ...ctx, rules, rec, field, value, cur, saw, redirect });
  if (redirect && outcome.status === 'accepted') {
    return { ...outcome, details: { ...outcome.details, ...redirect.details } };
  }
  return outcome;
}

/**
 * A second edit to the same field made before the first was confirmed carries the first one's ID.
 * The person was looking at the current value if that change, by them, is what last wrote the
 * field (a set, or the create that filled it), or if its receipt shows it left the field at the
 * current version (it matched the value already there). Not when that change was kept rather than
 * applied, or applied to a merged record's survivor (design 2.2 step 7): the person never saw the
 * chart's value, and their second edit would overwrite it silently.
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
    !keptNotApplied(prev.details) &&
    prev.userId === actor.authorId &&
    prev.recordId === c.recordId &&
    prev.field === field &&
    prev.serverVersion === version
  );
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
