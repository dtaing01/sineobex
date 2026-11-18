import { visibleAnswers, type NoteReader, type ResolvedNoteType } from '@sineobex/forms';
import type { TeamScope } from '../auth/context.ts';
import { mayViewProblems, PERMISSION_KEYS } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { hiddenCorrections, signoffHashShown, type StoredCorrection } from '../encounters/read.ts';
import { encounterStatus, noteIsEmpty, type NoteStatus } from '../encounters/rules.ts';
import { ApiError, conflict, forbidden, notFound } from '../lib/errors.ts';
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
import { isSensitiveCode } from './entities/problem.ts';
import {
  answerHidden,
  byDefinition,
  DefinitionError,
  definitionOf,
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
  SyncResultValue,
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
    const shown = new Map<string, { field: string | null; value: unknown } | null>();
    for (const r of page) shown.set(r.id, await shownChange(tx, scope, r));
    const items = page.map((r) => ({
      id: r.id,
      user: { userId: r.userId, displayName: r.userName },
      deviceId: r.deviceId,
      changeId: r.changeId,
      entity: r.entity,
      recordId: r.recordId,
      op: r.op,
      // What the reviewer may not read is held all the same: no value, and no path that names it.
      ...(shown.get(r.id) ?? { field: null, value: null, hidden: true as const }),
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
 * A held change as this reviewer may read it, by the sync read's rules (routes/sync.ts requireRead,
 * fetchRecords; lifecycle 6.4 rule 2, review finding RD-3), or null when they may not: Phase 4
 * sends the queue hidden answers and whole Medical notes on purpose. A visit's records need
 * encounters.chart, and a Medical visit's summary and its own addenda what reads its notes (RD-7);
 * a note's change needs a note they may read, with every answer it sends or would replace one they
 * may see; a sign-off goes without its hash to a reader who does not see every answer of any note. A problem and its notes need the problem list's keys, and a sensitive one,
 * or one whose create is still held, patients.view_sensitive. Everything else needs patients.view. Values were never schema-checked,
 * so anything that cannot be read as a change of its kind is hidden.
 */
async function shownChange(
  tx: Tx,
  scope: TeamScope,
  r: Pick<QuarantineRow, 'entity' | 'op' | 'field' | 'value' | 'recordId'>,
): Promise<{ field: string | null; value: unknown } | null> {
  const shown = { field: r.field, value: await shownValue(r) };
  const v = (typeof r.value === 'object' && r.value !== null ? r.value : {}) as Record<string, unknown>;
  const uuid = (x: unknown) => (typeof x === 'string' && UUID.test(x) ? x : null);
  switch (r.entity) {
    case 'encounter':
      if (!scope.can('encounters.chart')) return null;
      return r.field === 'summary' && !readsMedical(scope) && (await medicalVisit(tx, r.recordId))
        ? null
        : shown;
    case 'encounter_note':
    case 'note_signoff':
    case 'note_addendum':
    case 'note_correction':
      if (!scope.can('encounters.chart')) return null;
      return (await noteChangeShown(tx, scope, r, v, uuid)) ? withoutUnseenHash(scope, r, v, shown) : null;
    case 'problem':
    case 'problem_note': {
      if (!mayViewProblems(scope.team.permissions)) return null;
      if (scope.can('patients.view_sensitive')) return shown;
      if (r.entity === 'problem' && r.op === 'create') return sensitiveProblem(v) ? null : shown;
      // A set of a problem, or a note on one: the problem as it is, or its create held here.
      const problemId = r.entity === 'problem' ? r.recordId : uuid(v.problemId);
      const problem = problemId ? await RULES.problem.load(tx, problemId, false) : null;
      return problem && problem.attributes.sensitive !== true ? shown : null;
    }
    default:
      return scope.can('patients.view') ? shown : null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether the reviewer reads Medical notes, and so a Medical visit's summary (5.1, D37). */
const readsMedical = (scope: TeamScope) => mayViewProblems(scope.team.permissions);

/**
 * Whether a held change's visit is Medical (lifecycle 5.1; review finding RD-7), as the sync read
 * asks of it. A visit not on the chart, its create still held, or one the value does not name, is
 * read as Medical: its kind cannot be told from the chart.
 */
async function medicalVisit(tx: Tx, encounterId: string | null): Promise<boolean> {
  const visit = encounterId ? await RULES.encounter.load(tx, encounterId, false) : null;
  return visit === null || visit.values.kind === 'medical';
}

/** A problem's create, or a code set, that names a sensitive code (problem.ts applyCreate). */
function sensitiveProblem(v: Record<string, unknown>): boolean {
  if (v.sensitive === true) return true;
  const code = (v.code as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && isSensitiveCode(code);
}

/**
 * Whether the reviewer may read a held change of a note, or of what hangs off one: the note's type
 * and every answer the change sends, or would replace, as the sync read would show them.
 */
async function noteChangeShown(
  tx: Tx,
  scope: TeamScope,
  r: Pick<QuarantineRow, 'entity' | 'op' | 'field' | 'value' | 'recordId'>,
  v: Record<string, unknown>,
  uuid: (x: unknown) => string | null,
): Promise<boolean> {
  const readerFor = (note: StoredRecord | null) =>
    noteReader(
      scope.team.permissions,
      scope.team.credential,
      note !== null && scope.principal.userId === actingAuthor(note),
    );
  try {
    if (r.entity === 'encounter_note' && r.op === 'create') {
      const version = typeof v.noteTypeVersion === 'number' ? v.noteTypeVersion : null;
      if (typeof v.noteTypeKey !== 'string' || version === null) return false;
      const type = await definitionOf(tx, scope.team.teamId, v.noteTypeKey, version);
      const data = (typeof v.data === 'object' && v.data !== null ? v.data : {}) as Record<string, unknown>;
      if (!type) return false;
      const reader = readerFor(null);
      return byDefinition(
        () =>
          visibleAnswers(type, data, reader) !== null &&
          !Object.entries(data).some(([path, value]) => answerHidden(type, data, path, value, reader)),
      );
    }
    // An addendum to the visit itself is read with the visit: with its summary, on a Medical one.
    if (r.entity === 'note_addendum' && v.noteId === null)
      return readsMedical(scope) || !(await medicalVisit(tx, uuid(v.encounterId)));
    const noteId = r.entity === 'encounter_note' ? r.recordId : uuid(v.noteId);
    const note = noteId ? await noteRules.load(tx, noteId, false) : null;
    if (!note) return false;
    const type = await noteTypeOf(tx, note);
    if (type === undefined) return true;
    const reader = readerFor(note);
    const answers = answersOf(note);
    if (byDefinition(() => visibleAnswers(type, answers, reader)) === null) return false;
    const hides = (field: unknown, value: unknown) => {
      if (typeof field !== 'string' || !field.startsWith('data.')) return false;
      const path = field.slice('data.'.length);
      return byDefinition(
        () =>
          (Object.hasOwn(answers, path) && answerHidden(type, answers, path, answers[path], reader)) ||
          answerHidden(type, answers, path, value, reader),
      );
    };
    if (r.entity === 'encounter_note') return !hides(r.field, r.value);
    if (r.entity === 'note_correction') {
      const changes = Array.isArray(v.changes) ? (v.changes as Record<string, unknown>[]) : [];
      return !changes.some((c) => typeof c !== 'object' || c === null || hides(c.field, c.newValue));
    }
    return true;
  } catch (err) {
    if (err instanceof DefinitionError) return false;
    throw err;
  }
}

/** A held sign-off without its hash for a reviewer who does not see every answer of any note. */
function withoutUnseenHash(
  scope: TeamScope,
  r: Pick<QuarantineRow, 'entity'>,
  v: Record<string, unknown>,
  shown: { field: string | null; value: unknown },
) {
  const reader = noteReader(scope.team.permissions, scope.team.credential, false);
  if (r.entity !== 'note_signoff' || readsWhole(reader)) return shown;
  const { contentHash: _, ...rest } = v;
  return { ...shown, value: rest };
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

/** An accept the chart's rules refused: thrown to roll back the attempt's savepoint. */
class Refused extends Error {
  constructor(readonly result: SyncResultValue) {
    super('refused');
  }
}

/**
 * A held sign-off that will not reach the chart: rejected, or its accept refused as the note no
 * longer matches it (review finding NOT-12). Its phone let go of it when it was held, so its sender
 * gets `change_not_applied` naming the note, unless one they have not read yet says so already.
 * Only for a sign-off of a note on the chart; anything else tells nobody. The note's ID, or null.
 */
async function signoffNotApplied(
  tx: Tx,
  teamId: string,
  item: Pick<QuarantineRow, 'entity' | 'op' | 'userId' | 'value'>,
): Promise<string | null> {
  if (item.entity !== 'note_signoff' || item.op !== 'create') return null;
  // Values were never schema-checked, so the note is read only when it is a UUID.
  const noteId = (item.value as { noteId?: unknown } | null)?.noteId;
  if (typeof noteId !== 'string' || !UUID.test(noteId)) return null;
  const [note] = await tx<{ id: string }[]>`
    select id from sineobex.encounter_notes where id = ${noteId} and team_id = ${teamId}`;
  if (!note) return null;
  await tx`
    insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
    select ${teamId}, ${item.userId}, 'change_not_applied', 'encounter_note', ${note.id}
    where not exists (
      select 1 from sineobex.user_notices
      where user_id = ${item.userId} and kind = 'change_not_applied' and entity = 'encounter_note'
        and record_id = ${note.id} and read_at is null)`;
  return note.id;
}

/** The patient a queue item is about, as the queue names it (migration 0020, patient_of_change). */
async function patientOfItem(tx: Tx, itemId: string): Promise<string | null> {
  const [row] = await tx<{ patientId: string | null }[]>`
    select sineobex.patient_of_change(q.entity, q.record_id, q.value) as patient_id
    from sineobex.quarantine_items q where q.id = ${itemId}`;
  return row?.patientId ?? null;
}

const waitingOnRecord = () =>
  conflict(
    'waiting_on_record',
    'This belongs to a record that is also waiting for review. Decide on that record first.',
  );

/**
 * Accept applies the change to the chart under the usual rules, as the person who made it and
 * approved by the admin; if it would overwrite a different value, nothing is applied and the admin
 * is told, and a late change to a finished note is kept in its history as a push of it would be.
 * Only a reviewer who may read the change accepts it (403 `change_hidden`). Reject keeps the item,
 * with the reason, forever.
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
      // Only a reviewer who may read the change may put it on the chart, by the queue's rules, which
      // are the sync read's (review finding RD-3): anyone else may reject it, or leave it for someone
      // who can read it. Asked before anything else answers of the record. A change of a record whose
      // create is itself held reads as hidden until that record is decided, and waits on it.
      if ((await shownChange(tx, scope, item)) === null) {
        if (await heldCreate(tx, { teamId: scope.team.teamId, authorId: item.userId }, change))
          throw waitingOnRecord();
        return 'hidden' as const;
      }
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
      // The attempt runs in a savepoint of its own, rolled back when it is refused, so the item
      // stays pending and the chart is untouched.
      const result = await tx
        .savepoint(async (sp) => {
          const r = await applyInSavepoint(sp, audit, actor, change, item.valueHash);
          if (r.status !== 'accepted') throw new Refused(r);
          return r;
        })
        .catch((err: unknown) => {
          if (err instanceof Refused) return err.result;
          throw err;
        });
      if (result.status !== 'accepted') {
        if (result.reason === 'stale_reference' && (await heldCreate(tx, actor, change)))
          throw waitingOnRecord();
        const problem = typeof result.details?.problem === 'string' ? result.details.problem : null;
        const refused = conflict(
          'cannot_apply',
          result.reason === 'stale_reference'
            ? 'The record this belongs to isn’t on the chart, so this can’t be applied.'
            : problem === 'content_changed'
              ? 'The note changed after it was signed, so this can’t be applied. Whoever sent it has been told to complete the note again.'
              : 'This record can’t be applied as it stands.',
          {
            status: result.status,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(problem ? { problem } : {}),
          },
        );
        if (item.entity !== 'note_signoff' || problem !== 'content_changed') throw refused;
        // A held sign-off the note no longer matches (review finding NOT-12): its phone let go of
        // it when it was held, so its sender is told the note needs completing again, and the
        // refusal is logged with it. The item stays pending, for the reviewer to reject.
        const noteId = await signoffNotApplied(tx, scope.team.teamId, item);
        await audit({
          action: 'quarantine.accept_refused',
          entity: 'encounter_note',
          entityId: noteId ?? item.recordId,
          patientId: await patientOfItem(tx, itemId),
          details: { itemId, changeId: item.changeId, problem },
        });
        return refused;
      }
    }
    // A held sign-off rejected tells its sender the note needs completing again (NOT-12).
    if (decision === 'reject') await signoffNotApplied(tx, scope.team.teamId, item);

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
  if (outcome instanceof ApiError) throw outcome;
  if (outcome === 'own') {
    await scope.tx((_, audit) =>
      audit({ action: 'access.denied', details: { reason: 'own_quarantined_change', itemId } }),
    );
    throw forbidden('Someone else on the team must review your own records.', 'own_change');
  }
  if (outcome === 'hidden') {
    await scope.tx((_, audit) =>
      audit({ action: 'access.denied', details: { reason: 'change_hidden', itemId } }),
    );
    throw forbidden(
      'Your role can’t read this record, so you can’t accept it onto the chart. You can reject it, or leave it for someone who can read it.',
      'change_hidden',
    );
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
     * answers it changes is hidden from the reader, now or in any state the note has held, since its
     * old or new value would give it away (encounters/read.ts hiddenCorrections).
     * A sign-off's content hash goes only to whoever acts as the author, its signer, and a reader
     * who sees every answer of any note (readsWhole), and never over a visit's summary withheld from
     * the reader (encounters/read.ts signoffHashShown).
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
        case 'note_signoff': {
          const note = await noteOf(record);
          const read = await noteAsRead(note);
          if (!read) return null;
          const visit = await RULES.encounter.load(tx, note!.attributes.encounterId as string, false);
          return signoffHashShown(
            read,
            record.authorUserId,
            scope.principal.userId,
            !visit || medicalHidden(visit),
          )
            ? record
            : withoutHash(record);
        }
        case 'encounter':
          return {
            ...(medicalHidden(record) ? withoutSummary(record) : record),
            status: await statusShown(record),
          };
        case 'note_addendum': {
          // An addendum to the visit itself is read with the visit: with its summary, on a Medical one.
          if (record.attributes.noteId !== null) return (await noteAsRead(await noteOf(record))) && record;
          const visit = await RULES.encounter.load(tx, record.attributes.encounterId as string, false);
          return visit && !medicalHidden(visit) ? record : null;
        }
        case 'note_correction': {
          const read = await noteAsRead(await noteOf(record));
          if (!read) return null;
          // Asked with every correction of the note, in the order they were applied: one is hidden
          // when a value it names was hidden in any state the note has held (LRD-1).
          const all = await tx<StoredCorrection[]>`
            select id, outcome, changes from sineobex.note_corrections
            where team_id = ${record.teamId} and note_id = ${record.attributes.noteId as string}
            order by created_at, id`;
          return hiddenCorrections(read, all).has(record.id) ? null : record;
        }
        default:
          return record;
      }
    }

    /**
     * A Medical visit's summary is Medical content (lifecycle 6.4 row 1, D37): read, as its notes
     * are, with patients.view and encounters.chart or billing.view_codes (review finding RD-7).
     */
    function medicalHidden(visit: StoredRecord): boolean {
      return visit.values.kind === 'medical' && !mayViewProblems(scope.team.permissions);
    }

    /**
     * A visit's status as the reader is shown it: worked out from the notes they may read, so it
     * says nothing of a note left out (lifecycle 6.4 rule 2; review finding LRD-2). The visit read
     * and the timeline work it out the same way (encounters/read.ts, timeline.ts).
     */
    async function statusShown(visit: StoredRecord): Promise<string> {
      const rows = await tx<{ id: string }[]>`
        select id from sineobex.encounter_notes where team_id = ${visit.teamId} and encounter_id = ${visit.id}`;
      const counted = [];
      for (const { id } of rows) {
        const read = await noteAsRead(await noteRules.load(tx, id, false));
        if (!read) continue;
        const status = read.note.status as NoteStatus;
        counted.push({
          status,
          medical: read.note.internal.medical === true,
          empty: status === 'draft' && noteIsEmpty(read.answers),
        });
      }
      return encounterStatus(counted);
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
  });
}

/** The records of a visit's notes: read through their note, and logged as a view of it. */
const NOTE_SIDE: ReadonlySet<AnyRecordEntityName> = new Set([
  'encounter_note',
  'note_signoff',
  'note_addendum',
  'note_correction',
]);

/**
 * A reader who sees every answer that counts in any note (lifecycle 6.4 rule 4): every key that
 * hides an answer and a credential that charts Medical. Asked of the reader, never of what the
 * note holds, so whether a sign-off's hash is sent tells nothing of the note.
 */
const readsWhole = (reader: NoteReader) =>
  reader.readsMedical && reader.viewSensitive && reader.viewSensitiveExams && reader.chartsMedical;

/**
 * A sign-off without the hash of what was signed (lifecycle 6.4 rule 4, review findings NOT-5 and
 * RD-1): hashed again over what the reader is shown, with each guess of what is hidden, it would
 * say which guess was charted.
 */
function withoutHash(signoff: StoredRecord): StoredRecord {
  const { contentHash: _, ...attributes } = signoff.attributes;
  return { ...signoff, attributes };
}

/** A visit without its summary: no value, no version, no mark of who wrote it. */
function withoutSummary(visit: StoredRecord): StoredRecord {
  const { summary: _v, ...values } = visit.values;
  const { summary: _n, ...fieldVersions } = visit.fieldVersions;
  const { summary: _m, ...fieldMeta } = visit.fieldMeta;
  return { ...visit, values, fieldVersions, fieldMeta };
}

/**
 * A note with only [shown] for answers, each at the value shown: a hidden one leaves no key. Its
 * version and time are those of the latest field it shows, so a change to a hidden answer leaves
 * no mark that something changed, or when (lifecycle 6.4 rule 2, review finding RD-6). The phone
 * reads only the fields' versions.
 */
function onlyAnswers(note: StoredRecord, shown: Record<string, unknown>): StoredRecord {
  const kept = <T>(byField: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(byField).filter(
        ([field]) => !field.startsWith('data.') || Object.hasOwn(shown, field.slice('data.'.length)),
      ),
    );
  const values = kept(note.values);
  for (const [path, value] of Object.entries(shown)) values[`data.${path}`] = value;
  const fieldVersions = kept(note.fieldVersions);
  const fieldMeta = kept(note.fieldMeta);
  const updated = Math.max(
    note.createdAt.getTime(),
    ...Object.values(fieldMeta).map((m) => Date.parse(m.at)),
  );
  return {
    ...note,
    values,
    fieldVersions,
    fieldMeta,
    version: Math.max(1, ...Object.values(fieldVersions)),
    updatedAt: new Date(updated),
  };
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
