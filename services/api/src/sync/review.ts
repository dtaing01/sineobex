import type { TeamScope } from '../auth/context.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import { applyChange, changeOwners, findReceipt, sameOwner, type ApplyActor } from './apply.ts';
import { loadRecord, snapshot } from './records.ts';
import type { RecordEntityName, RecordSnapshotValue, SyncChangeInput } from './schemas.ts';

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
  reason: 'access_removed' | 'permission';
  status: 'pending' | 'accepted' | 'rejected';
  receivedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionReason: string | null;
  patientId: string | null;
}

const UUID_TEXT = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export async function listQuarantine(scope: TeamScope, status: 'pending' | 'accepted' | 'rejected') {
  return scope.tx(async (tx, audit) => {
    // The patient each item is about. A note's encounter comes from the chart or from the note's
    // create held here; the encounter's patient from the chart or from its create held here,
    // whatever was decided on it; last, the item's own value (an activity log entry names the
    // patient it read). Values were never schema-checked, so text is cast only when it is a UUID.
    const rows = await tx<QuarantineRow[]>`
      select q.*, u.display_name as user_name, du.display_name as decided_by_name,
             coalesce(
               e.patient_id,
               case when ec.value ->> 'patientId' ~ ${UUID_TEXT} then (ec.value ->> 'patientId')::uuid end,
               case when q.value ->> 'patientId' ~ ${UUID_TEXT} then (q.value ->> 'patientId')::uuid end
             ) as patient_id
      from sineobex.quarantine_items q
      join sineobex.users u on u.id = q.user_id
      left join sineobex.users du on du.id = q.decided_by
      left join lateral (
        select case when q.entity = 'encounter' then q.record_id::text
                    when q.entity = 'encounter_note' then coalesce(
                      (select n.encounter_id::text from sineobex.encounter_notes n where n.id = q.record_id),
                      (select c.value ->> 'encounterId' from sineobex.quarantine_items c
                       where c.entity = 'encounter_note' and c.op = 'create' and c.record_id = q.record_id
                       order by c.received_at desc limit 1))
               end as id
      ) enc_text on true
      left join lateral (
        select case when enc_text.id ~ ${UUID_TEXT} then enc_text.id::uuid end as id
      ) enc on true
      left join sineobex.encounters e on e.id = enc.id
      left join lateral (
        select c.value from sineobex.quarantine_items c
        where c.entity = 'encounter' and c.op = 'create' and c.record_id = enc.id
        order by c.received_at desc limit 1
      ) ec on true
      where q.status = ${status}
      order by q.received_at
      limit 200`;
    // The values are chart content, so looking at the queue is itself logged, item by item with
    // the patient, so a patient's access report shows it.
    await audit({ action: 'quarantine.viewed', details: { status, count: rows.length } });
    for (const r of rows) {
      await audit({
        action: 'quarantine.item_viewed',
        entity: r.entity === 'audit' ? 'quarantine_item' : r.entity,
        entityId: r.entity === 'audit' ? r.id : r.recordId,
        patientId: r.patientId,
        details: { itemId: r.id },
      });
    }
    return rows.map((r) => ({
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
        canChart: true,
        quarantineOnPermission: false,
        auditDetails: { onBehalfOf: item.userId, quarantineItem: item.id },
      };
      const result = await applyChange(tx, audit, actor, change, item.valueHash);
      if (result.status !== 'accepted') {
        // Throwing rolls back the attempt, so the item stays pending and the chart is untouched.
        throw conflict('cannot_apply', 'This record can’t be applied as it stands.', {
          status: result.status,
          ...(result.reason ? { reason: result.reason } : {}),
        });
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

const PREFIX: Record<RecordEntityName, string> = { encounter: 'encounter', encounter_note: 'note' };

/** The server's copy of records a phone holds open, with every field's version. Each read is logged. */
export async function fetchRecords(scope: TeamScope, refs: { entity: RecordEntityName; id: string }[]) {
  return scope.tx(async (tx, audit) => {
    const records: RecordSnapshotValue[] = [];
    const missing: typeof refs = [];
    for (const ref of refs) {
      const record = await loadRecord(tx, ref.entity, ref.id, false);
      if (!record) {
        missing.push(ref);
        continue;
      }
      records.push(snapshot(record));
      await audit({
        action: `${PREFIX[ref.entity]}.viewed`,
        entity: ref.entity,
        entityId: ref.id,
        patientId: record.patientId,
        details: { source: 'sync' },
      });
    }
    return { records, missing };
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
