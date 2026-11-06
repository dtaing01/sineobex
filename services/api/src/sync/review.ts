import type { TeamScope } from '../auth/context.ts';
import { PERMISSION_KEYS } from '../auth/permissions.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import {
  applyInSavepoint,
  changeOwners,
  findReceipt,
  heldCreate,
  sameOwner,
  type ApplyActor,
} from './apply.ts';
import { RULES, takesTeamLock } from './entities/index.ts';
import { lockTeamWrites } from './locks.ts';
import { snapshot } from './records.ts';
import type {
  AnyRecordEntityName,
  QuarantineQueryValue,
  QuarantineReasonName,
  RecordSnapshotValue,
  SyncChangeInput,
} from './schemas.ts';

/** What a Program Admin reviews (quarantine), and what a phone reads back (records, notices). */

interface QuarantineRow {
  id: string;
  userId: string;
  userName: string;
  deviceId: string;
  changeId: string;
  entity: string;
  recordId: string;
  op: string;
  field: string | null;
  value: unknown;
  valueHash: string;
  details: Record<string, unknown>;
  deviceTime: Date;
  reason: QuarantineReasonName;
  status: 'pending' | 'accepted' | 'rejected';
  receivedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionReason: string | null;
  patientId: string | null;
}

/** Items per page of the review queue. */
export const QUARANTINE_PAGE_SIZE = 50;

/**
 * The review queue, oldest first, a page at a time and optionally one person's, so one person's
 * flood of held work can't hide someone else's hand-over behind it.
 */
export async function listQuarantine(scope: TeamScope, { status, userId, afterId }: QuarantineQueryValue) {
  return scope.tx(async (tx, audit) => {
    // The patient each item is about (migration 0009, patient_of_change): the record itself, its
    // row's patient, or what its value names; for a note or an encounter, through the encounter,
    // on the chart or its create held here, whatever was decided on it. Values were never
    // schema-checked, so text is read only when it is a UUID.
    const rows = await tx<QuarantineRow[]>`
      select q.*, u.display_name as user_name, du.display_name as decided_by_name,
             sineobex.patient_of_change(q.entity, q.record_id, q.value) as patient_id
      from sineobex.quarantine_items q
      join sineobex.users u on u.id = q.user_id
      left join sineobex.users du on du.id = q.decided_by
      where q.status = ${status}
        ${userId ? tx`and q.user_id = ${userId}` : tx``}
        ${
          afterId
            ? tx`and (q.received_at, q.id) > (
                select a.received_at, a.id from sineobex.quarantine_items a where a.id = ${afterId})`
            : tx``
        }
      order by q.received_at, q.id
      limit ${QUARANTINE_PAGE_SIZE + 1}`;
    const page = rows.slice(0, QUARANTINE_PAGE_SIZE);
    // Whom the queue can be filtered to: everyone with items in this status, and whoever it is
    // filtered to already, so the filter still shows them once their last item is decided.
    const people = await tx<{ userId: string; displayName: string }[]>`
      select u.id as user_id, u.display_name from sineobex.users u
      where u.id in (
        select q.user_id from sineobex.quarantine_items q
        where q.status = ${status} ${userId ? tx`or q.user_id = ${userId}` : tx``})
      order by u.display_name, u.id`;
    // The values are chart content, so looking at the queue is itself logged, item by item with
    // the patient, so a patient's access report shows it.
    await audit({
      action: 'quarantine.viewed',
      details: { status, count: page.length, ...(userId ? { userId } : {}), ...(afterId ? { afterId } : {}) },
    });
    for (const r of page) {
      await audit({
        action: 'quarantine.item_viewed',
        entity: r.entity === 'audit' ? 'quarantine_item' : r.entity,
        entityId: r.entity === 'audit' ? r.id : r.recordId,
        patientId: r.patientId,
        details: { itemId: r.id },
      });
    }
    const items = page.map((r) => ({
      id: r.id,
      user: { userId: r.userId, displayName: r.userName },
      deviceId: r.deviceId,
      changeId: r.changeId,
      entity: r.entity,
      recordId: r.recordId,
      op: r.op,
      field: r.field,
      value: r.value,
      deviceTime: r.deviceTime.toISOString(),
      reason: r.reason,
      status: r.status,
      receivedAt: r.receivedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedBy: r.decidedBy ? { userId: r.decidedBy, displayName: r.decidedByName ?? '' } : null,
      decisionReason: r.decisionReason,
    }));
    return { items, nextAfterId: rows.length > page.length ? page.at(-1)!.id : null, people };
  });
}

/**
 * Accept applies the change to the chart under the usual rules, as the person who made it and
 * approved by the admin; if it would overwrite a different value or touch a signed note, nothing
 * is applied and the admin is told. Reject keeps the item, with the reason, forever.
 */
export async function decideQuarantine(
  scope: TeamScope,
  itemId: string,
  decision: 'accept' | 'reject',
  reason: string,
) {
  const outcome = await scope.tx(async (tx, audit) => {
    // A patient-side item, or an encounter naming a patient, takes the team's write lock before
    // its row (D32), as a push of the same change would. What it is never changes, so a look first
    // is enough to know.
    const [peek] = await tx<Pick<QuarantineRow, 'entity' | 'op' | 'field' | 'value'>[]>`
      select entity, op, field, value from sineobex.quarantine_items where id = ${itemId}`;
    if (peek && takesTeamLock(peek as SyncChangeInput)) await lockTeamWrites(tx, scope.team.teamId);
    const rows = await tx<QuarantineRow[]>`
      select q.*, null as user_name, null as decided_by_name, null as patient_id
      from sineobex.quarantine_items q where q.id = ${itemId} for update`;
    const item = rows[0];
    if (!item) throw notFound('quarantined record');
    if (item.status !== 'pending') throw conflict('already_decided', 'This record was already reviewed.');
    // Review means a second person: nobody decides on their own change.
    if (item.userId === scope.principal.userId) return 'own' as const;
    if (decision === 'accept' && item.entity === 'audit') {
      throw conflict(
        'not_applicable',
        'Activity log entries are recorded when they arrive; there is nothing to apply.',
      );
    }

    if (decision === 'accept') {
      const d = item.details;
      const change: SyncChangeInput = {
        changeId: item.changeId,
        seq: Number(d.seq ?? 0),
        entity: item.entity as SyncChangeInput['entity'],
        recordId: item.recordId,
        op: item.op as SyncChangeInput['op'],
        ...(item.field ? { field: item.field } : {}),
        value: item.value,
        valueHash: item.valueHash,
        baseVersion: Number(d.baseVersion ?? 0),
        ...(typeof d.follows === 'string' ? { follows: d.follows } : {}),
        ...(typeof d.supersedes === 'string' ? { supersedes: d.supersedes } : {}),
        ...(typeof d.conflictOf === 'string' ? { conflictOf: d.conflictOf } : {}),
        ...(d.resolution === 'replace' || d.resolution === 'keep_server' ? { resolution: d.resolution } : {}),
        deviceTime: item.deviceTime.toISOString(),
        ...(typeof d.correctedTime === 'string' ? { correctedTime: d.correctedTime } : {}),
        clockVerified: d.clockVerified === true,
      };
      // Someone else's change under this ID, in this team or in another (which this one can't
      // see), would collide with this one's receipt.
      const owner = { teamId: scope.team.teamId, userId: item.userId, deviceId: item.deviceId };
      if ((await changeOwners(tx, item.changeId)).some((o) => !sameOwner(o, owner))) {
        throw conflict(
          'change_id_taken',
          'Another change was stored under this one’s ID, so it can’t be applied. Reject it, and ask for it to be charted again.',
        );
      }
      // Rejected or conflicted at push is no reason to refuse it now: the admin decides on the
      // value as it stands, and applyChange checks it against the chart again.
      const existing = await findReceipt(tx, item.changeId);
      if (existing?.status === 'accepted') {
        throw conflict('already_applied', 'This change already reached the chart.');
      }
      const actor: ApplyActor = {
        teamId: scope.team.teamId,
        authorId: item.userId,
        approvedBy: scope.principal.userId,
        deviceId: item.deviceId,
        // The admin's accept is the approval, whatever the person's role held.
        permissions: new Set(PERMISSION_KEYS),
        holdForReview: false,
        now: scope.deps.now(),
        auditDetails: { onBehalfOf: item.userId, quarantineItem: item.id },
      };
      // A database constraint the checks missed answers cannot_apply below, not a server error.
      const result = await applyInSavepoint(tx, audit, actor, change, item.valueHash);
      if (result.status !== 'accepted') {
        // Throwing rolls back the attempt, so the item stays pending and the chart is untouched.
        if (result.reason === 'stale_reference' && (await heldCreate(tx, actor, change))) {
          throw conflict(
            'waiting_on_record',
            'This belongs to a record that is also waiting for review. Decide on that record first.',
          );
        }
        throw conflict(
          'cannot_apply',
          result.reason === 'stale_reference'
            ? 'The record this belongs to isn’t on the chart, so this can’t be applied.'
            : 'This record can’t be applied as it stands.',
          { status: result.status, ...(result.reason ? { reason: result.reason } : {}) },
        );
      }
    }

    await tx`
      update sineobex.quarantine_items set status = ${decision === 'accept' ? 'accepted' : 'rejected'},
        decided_by = ${scope.principal.userId}, decided_at = ${scope.deps.now()}, decision_reason = ${reason}
      where id = ${itemId}`;
    await audit({
      action: decision === 'accept' ? 'quarantine.accepted' : 'quarantine.rejected',
      entity: item.entity,
      entityId: item.recordId,
      details: { itemId, changeId: item.changeId, reason },
    });
    return 'decided' as const;
  });
  if (outcome === 'own') {
    await scope.tx((_, audit) =>
      audit({ action: 'access.denied', details: { reason: 'own_quarantined_change', itemId } }),
    );
    throw forbidden('Someone else on the team must review your own records.', 'own_change');
  }
  return { ok: true as const };
}

/**
 * The server's copy of records a phone holds open, with every field's version. The route has
 * checked each entity's read rule; a sensitive problem (or its note) the role can't see is
 * reported missing, like one the team lacks (design 4.3). Each read is logged, a patient-side
 * one as a view of that patient.
 */
export async function fetchRecords(scope: TeamScope, refs: { entity: AnyRecordEntityName; id: string }[]) {
  return scope.tx(async (tx, audit) => {
    const records: RecordSnapshotValue[] = [];
    const missing: typeof refs = [];
    for (const ref of refs) {
      const rules = RULES[ref.entity];
      const record = await rules.load(tx, ref.id, false);
      if (!record || !(await mayRead(scope, record))) {
        missing.push(ref);
        continue;
      }
      records.push(snapshot(record));
      const encounterSide = ref.entity === 'encounter' || ref.entity === 'encounter_note';
      await audit({
        action: encounterSide ? `${rules.auditPrefix}.viewed` : 'patient.viewed',
        entity: ref.entity,
        entityId: ref.id,
        patientId: record.patientId,
        details: { source: 'sync' },
      });
    }
    return { records, missing };

    /** Sensitive problems need patients.view_sensitive (Oct 19); a note goes with its problem. */
    async function mayRead(s: TeamScope, record: { entity: string; attributes: Record<string, unknown> }) {
      if (s.can('patients.view_sensitive')) return true;
      if (record.entity === 'problem') return record.attributes.sensitive !== true;
      if (record.entity !== 'problem_note') return true;
      const problem = await RULES.problem.load(tx, record.attributes.problemId as string, false);
      return problem?.attributes.sensitive !== true;
    }
  });
}

export async function listNotices(scope: TeamScope) {
  const rows = await scope.tx(
    (tx) => tx<
      {
        id: string;
        kind: string;
        entity: string | null;
        recordId: string | null;
        createdAt: Date;
        readAt: Date | null;
      }[]
    >`
      select id, kind, entity, record_id, created_at, read_at from sineobex.user_notices
      where user_id = ${scope.principal.userId}
      order by created_at desc limit 100`,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    entity: r.entity,
    recordId: r.recordId,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt?.toISOString() ?? null,
  }));
}

export async function markNoticeRead(scope: TeamScope, noticeId: string) {
  const rows = await scope.tx(
    (tx) => tx`
      update sineobex.user_notices set read_at = coalesce(read_at, ${scope.deps.now()})
      where id = ${noticeId} and user_id = ${scope.principal.userId} returning id`,
  );
  if (rows.length === 0) throw notFound('notice');
  return { ok: true as const };
}
