import { visibleAnswers, type NoteReader, type ResolvedNoteType } from '@sineobex/forms';
import type { TeamScope } from '../auth/context.ts';
import { PERMISSION_KEYS } from '../auth/permissions.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import { idLinkTokenRef } from '../patients/id-links.ts';
import {
  applyInSavepoint,
  changeOwners,
  findReceipt,
  heldCreate,
  sameOwner,
  type ApplyActor,
} from './apply.ts';
import { RULES, takesTeamLock } from './entities/index.ts';
import { actingAuthor, answersOf, noteRules, noteTypeOf } from './entities/note.ts';
import { lockTeamWrites } from './locks.ts';
import {
  answerHidden,
  byDefinition,
  DefinitionError,
  noteReader,
  snapshot,
  type StoredRecord,
} from './records.ts';
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
    // The patient each item is about (migration 0020, patient_of_change): the record itself, its
    // row's patient, or what its value names; for a note or an encounter, through the encounter,
    // on the chart or its create held here, whatever was decided on it. A sign-off and a
    // correction answer through the note their value names, an addendum through its visit, and a
    // referral or an allergy through its row, or its held create when the row does not exist.
    // Values were never schema-checked, so text is read only when it is a UUID.
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
    const values = new Map<string, unknown>();
    for (const r of page) values.set(r.id, await shownValue(r));
    const items = page.map((r) => ({
      id: r.id,
      user: { userId: r.userId, displayName: r.userName },
      deviceId: r.deviceId,
      changeId: r.changeId,
      entity: r.entity,
      recordId: r.recordId,
      op: r.op,
      field: r.field,
      value: values.get(r.id),
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
 * An item's value as the queue shows it. A held ID link create carries the card's token, which
 * opens the patient's card page, so it is named the way audit events name it (review finding S7);
 * accepting the item applies the value as it was sent. Values were never schema-checked, so the
 * token is replaced only when it is a string, and dropped otherwise.
 */
async function shownValue(r: Pick<QuarantineRow, 'entity' | 'op' | 'value'>): Promise<unknown> {
  const v = r.value;
  if (r.entity !== 'id_link' || r.op !== 'create' || typeof v !== 'object' || v === null || !('token' in v)) {
    return v;
  }
  const { token, ...rest } = v as { token: unknown };
  return typeof token === 'string' ? { ...rest, tokenRef: await idLinkTokenRef(token) } : rest;
}

/**
 * Accept applies the change to the chart under the usual rules, as the person who made it and
 * approved by the admin; if it would overwrite a different value, nothing is applied and the admin
 * is told, and a late change to a finished note is kept in its history as a push of it would be.
 * Reject keeps the item, with the reason, forever.
 */
export async function decideQuarantine(
  scope: TeamScope,
  itemId: string,
  decision: 'accept' | 'reject',
  reason: string,
) {
  const outcome = await scope.tx(async (tx, audit) => {
    // An item takes the team's write lock before its row when a push of the same change would (D32,
    // takesTeamLock: every patient-side change, and every change of a visit and what belongs to it).
    // What it is never changes, so a look first is enough to know.
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
 * checked each entity's read rule; what the reader may not see is reported missing, like a record
 * the team lacks, or left out of the record. Each read is logged, a patient-side one as a view of
 * that patient.
 */
export async function fetchRecords(scope: TeamScope, refs: { entity: AnyRecordEntityName; id: string }[]) {
  return scope.tx(async (tx, audit) => {
    const records: RecordSnapshotValue[] = [];
    const missing: typeof refs = [];
    for (const ref of refs) {
      const rules = RULES[ref.entity];
      const record = await rules.load(tx, ref.id, false);
      const shown = record && (await asRead(record));
      if (!shown) {
        missing.push(ref);
        continue;
      }
      records.push(snapshot(shown));
      await audit({
        action:
          ref.entity === 'encounter'
            ? 'encounter.viewed'
            : NOTE_SIDE.has(ref.entity)
              ? 'note.viewed'
              : 'patient.viewed',
        entity: ref.entity,
        entityId: ref.id,
        patientId: shown.patientId,
        details: { source: 'sync' },
      });
    }
    return { records, missing };

    /**
     * The record as this reader may see it, or null when they may not see it at all. Sensitive
     * problems need patients.view_sensitive (Oct 19), and a problem's note goes with it. A note
     * leaves out the answers the reader may not see (lifecycle 6.4), and what hangs off a note goes
     * with it: its sign-offs, its addenda, and a correction, which is also missing when one of the
     * answers it changes is hidden from the reader, since its old or new value would give it away.
     */
    async function asRead(record: StoredRecord): Promise<StoredRecord | null> {
      switch (record.entity) {
        case 'problem':
          return scope.can('patients.view_sensitive') || record.attributes.sensitive !== true ? record : null;
        case 'problem_note': {
          if (scope.can('patients.view_sensitive')) return record;
          const problem = await RULES.problem.load(tx, record.attributes.problemId as string, false);
          return problem?.attributes.sensitive !== true ? record : null;
        }
        case 'encounter_note':
          return (await noteAsRead(record))?.note ?? null;
        case 'note_signoff':
          return (await noteAsRead(await noteOf(record))) ? record : null;
        case 'note_addendum':
          // An addendum to the visit itself is read with the visit.
          return record.attributes.noteId === null || (await noteAsRead(await noteOf(record)))
            ? record
            : null;
        case 'note_correction': {
          const read = await noteAsRead(await noteOf(record));
          if (!read) return null;
          const changes = record.attributes.changes as {
            field: string;
            oldValue: unknown;
            newValue: unknown;
          }[];
          return read.type === undefined ||
            !changes.some((c) => changeHidden(read.type!, read.answers, read.reader, c))
            ? record
            : null;
        }
        default:
          return record;
      }
    }

    function noteOf(record: StoredRecord) {
      return noteRules.load(tx, record.attributes.noteId as string, false);
    }

    /**
     * A note as this reader may read it (lifecycle 4.4, 6.4), with its type, the answers it holds
     * and the reader; null when they may not read it. Whoever acts as the author of a draft is sent
     * every answer it holds, hidden ones included, so they come back when their field shows again;
     * everyone else, and every finished note, gets the answers that count that the reader may see.
     * A hidden answer leaves no key behind: no value, no version, no mark of who changed it. A phase
     * 2 note with no version has no definition and is read whole. One whose definition the server
     * cannot read is missing: what it hides cannot be told.
     */
    async function noteAsRead(note: StoredRecord | null) {
      if (!note) return null;
      let type: ResolvedNoteType | undefined;
      try {
        type = await noteTypeOf(tx, note);
      } catch (err) {
        if (err instanceof DefinitionError) return null;
        throw err;
      }
      const reader = noteReader(
        scope.team.permissions,
        scope.team.credential,
        scope.principal.userId === actingAuthor(note),
      );
      const answers = answersOf(note);
      if (type === undefined || (reader.actsAsAuthor && note.status === 'draft')) {
        return { note, type, answers, reader };
      }
      let seen: Record<string, unknown> | null;
      try {
        seen = byDefinition(() => visibleAnswers(type, answers, reader));
      } catch (err) {
        if (err instanceof DefinitionError) return null;
        throw err;
      }
      return seen && { note: onlyAnswers(note, seen), type, answers, reader };
    }

    function changeHidden(
      type: ResolvedNoteType,
      answers: Record<string, unknown>,
      reader: NoteReader,
      c: { field: string; oldValue: unknown; newValue: unknown },
    ): boolean {
      const path = c.field.slice('data.'.length);
      try {
        return byDefinition(
          () =>
            answerHidden(type, answers, path, c.oldValue, reader) ||
            answerHidden(type, answers, path, c.newValue, reader),
        );
      } catch (err) {
        if (err instanceof DefinitionError) return true;
        throw err;
      }
    }
  });
}

/** The records of a visit's notes: read through their note, and logged as a view of it. */
const NOTE_SIDE: ReadonlySet<AnyRecordEntityName> = new Set([
  'encounter_note',
  'note_signoff',
  'note_addendum',
  'note_correction',
]);

/** A note with only [shown] for answers, each at the value shown: a hidden one leaves no key. */
function onlyAnswers(note: StoredRecord, shown: Record<string, unknown>): StoredRecord {
  const kept = <T>(byField: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(byField).filter(
        ([field]) => !field.startsWith('data.') || Object.hasOwn(shown, field.slice('data.'.length)),
      ),
    );
  const values = kept(note.values);
  for (const [path, value] of Object.entries(shown)) values[`data.${path}`] = value;
  return { ...note, values, fieldVersions: kept(note.fieldVersions), fieldMeta: kept(note.fieldMeta) };
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
