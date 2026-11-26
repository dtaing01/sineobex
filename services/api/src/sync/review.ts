import { visibleAnswers } from '@sineobex/forms';
import { problemCheckDue } from '@sineobex/presets';
import type { TeamScope } from '../auth/context.ts';
import { mayViewProblems, PERMISSION_KEYS, type Permission } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import {
  hiddenCorrections,
  medicalHidden,
  noteAsRead,
  readerOf,
  readsWhole,
  signoffHashShown,
  statusNote,
  statusShown,
  type StatusNote,
  type StoredCorrection,
} from '../encounters/read.ts';
import { ApiError, conflict, forbidden, notFound } from '../lib/errors.ts';
import { idLinkTokenRef } from '../patients/id-links.ts';
import { problemCheckDays } from '../patients/projection.ts';
import {
  applyInSavepoint,
  changeOwners,
  findReceipt,
  heldCreate,
  sameOwner,
  viewedAction,
  type ApplyActor,
} from './apply.ts';
import { RULES, takesTeamLock } from './entities/index.ts';
import { actingAuthor, answersOf, noteRules, noteTypeOf } from './entities/note.ts';
import { lockTeamWrites } from './locks.ts';
import {
  flagChangeShown,
  flagHead,
  flagHidden,
  readsEntity,
  readsRecord,
  sensitiveHidden,
  teamFlags,
  type TeamFlag,
} from './read-rules.ts';
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
  /** For a flag change, the flag it names and, for a mark, who made the change (heldFlagOf). */
  flagId: string | null;
  flagAuthorId: string | null;
}

/** Items per page of the review queue. */
export const QUARANTINE_PAGE_SIZE = 50;

/**
 * The review queue, oldest first, a page at a time and optionally one person's, so one person's
 * flood of held work can't hide someone else's hand-over behind it.
 *
 * PLAN-OPEN (CO-15): should the queue also leave out, rather than list without its value, a held
 * change of a sensitive problem for a reviewer who may not read sensitive things? Phases 3 and 4
 * list it, as they do every change a reviewer may not read; phase 5 leaves out a hidden flag's
 * (D136, leftOut).
 */
export async function listQuarantine(scope: TeamScope, { status, userId, afterId }: QuarantineQueryValue) {
  return scope.tx(async (tx, audit) => {
    const flags = await teamFlags(tx, scope.team.teamId);
    // Paged in SQL by (received_at, id), and read on until a page is listed or the queue ends, so
    // what is left out for this reviewer never shortens a page while more is listed after it, and
    // the cursor follows what was listed.
    const page: QuarantineRow[] = [];
    let more = false;
    for (let after = afterId ?? null; ;) {
      // The patient each item is about (migration 0020, patient_of_change): the record itself, its
      // row's patient, or what its value names; for a note or an encounter, through the encounter,
      // on the chart or its create held here, whatever was decided on it. A sign-off and a
      // correction answer through the note their value names, an addendum through its visit, and a
      // referral or an allergy through its row, or its held create when the row does not exist.
      // Values were never schema-checked, so text is read only when it is a UUID.
      const rows = await tx<QuarantineRow[]>`
        select q.*, u.display_name as user_name, du.display_name as decided_by_name,
               sineobex.patient_of_change(q.entity, q.record_id, q.value) as patient_id,
               nf.flag_id, nf.flag_author_id
        from sineobex.quarantine_items q
        join sineobex.users u on u.id = q.user_id
        left join sineobex.users du on du.id = q.decided_by
        ${heldFlagOf(tx, scope.team.teamId)}
        where q.status = ${status}
          ${userId ? tx`and q.user_id = ${userId}` : tx``}
          ${
            after
              ? tx`and (q.received_at, q.id) > (
                  select a.received_at, a.id from sineobex.quarantine_items a where a.id = ${after})`
              : tx``
          }
        order by q.received_at, q.id
        limit ${QUARANTINE_PAGE_SIZE + 1}`;
      for (const r of rows) {
        if (leftOut(scope.team.permissions, flags, r)) continue;
        if (page.length === QUARANTINE_PAGE_SIZE) {
          more = true;
          break;
        }
        page.push(r);
      }
      if (more || rows.length <= QUARANTINE_PAGE_SIZE) break;
      after = rows.at(-1)!.id;
    }
    // Whom the queue can be filtered to: everyone with items in this status, and whoever it is
    // filtered to already, so the filter still shows them once their last item is decided; each
    // only for an item listed to this reviewer, so the filter names nobody for what it leaves out.
    const candidates = await tx<
      { userId: string; displayName: string; entity: string; flagId: string | null }[]
    >`
      select distinct u.id as user_id, u.display_name, q.entity, nf.flag_id
      from sineobex.quarantine_items q
      join sineobex.users u on u.id = q.user_id
      ${heldFlagOf(tx, scope.team.teamId)}
      where q.status = ${status} ${userId ? tx`or q.user_id = ${userId}` : tx``}
      order by u.display_name, u.id`;
    const people = new Map<string, { userId: string; displayName: string }>();
    for (const c of candidates) {
      if (!leftOut(scope.team.permissions, flags, c))
        people.set(c.userId, { userId: c.userId, displayName: c.displayName });
    }
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
    for (const r of page) shown.set(r.id, await shownChange(tx, scope, flags, r));
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
    return { items, nextAfterId: more ? page.at(-1)!.id : null, people: [...people.values()] };
  });
}

/**
 * Whether the review queue leaves a held change out for this reviewer altogether, unlisted,
 * uncounted, naming nobody in its people filter, and neither accepted nor rejected by them (D136;
 * design 6.2): a flag change whose flag, one of the team's, the flag rule hides from them. Listed
 * without its value, it would still tell them its sender set or cleared a sensitive flag, and when.
 * A change naming no flag of the team is hidden from every reviewer (shownChange), so it is listed
 * so, for anyone to reject: left out, it would wait for good and its sender would never be told.
 * What else a reviewer may not read is listed without its value, a mark's reason among them.
 */
function leftOut(
  permissions: ReadonlySet<Permission>,
  flags: ReadonlyMap<string, TeamFlag>,
  item: Pick<QuarantineRow, 'entity' | 'flagId'>,
): boolean {
  if (item.entity !== 'patient_flag_change' || item.flagId === null) return false;
  const flag = flags.get(item.flagId);
  return flag !== undefined && flagHidden(permissions, flag);
}

/**
 * The flag a held flag change of the queue (`q`) names, and for a set (an Entered in error mark) the
 * change's author, as `nf.flag_id` and `nf.flag_author_id`: a create's own flag, read only when it is
 * a UUID; for a mark, the change's as stored, or as its create held here names it, the latest, as
 * the queue names its patient (0024, patient_of_change), with who made it, the row's author or that
 * create's sender. Nulls for every other item. Only which flag: whether the reviewer may see it is
 * the flag rule's to say (flagHidden, D99).
 */
const heldFlagOf = (tx: Tx, teamId: string) => tx`
  left join lateral (
    select case when q.op = 'create' then sineobex.as_uuid(q.value ->> 'flagId')
                else coalesce(f.flag_id, c.flag_id) end as flag_id,
           case when q.op = 'create' then null
                when f.id is not null then f.author_user_id else c.user_id end as flag_author_id
    from (select 1) one
    left join sineobex.patient_flag_changes f
      on q.op <> 'create' and f.team_id = ${teamId} and f.id = q.record_id
    left join lateral (
      select sineobex.as_uuid(h.value ->> 'flagId') as flag_id, h.user_id from sineobex.quarantine_items h
      where q.op <> 'create' and h.team_id = ${teamId} and h.entity = 'patient_flag_change' and h.op = 'create'
        and h.record_id = q.record_id
      order by h.received_at desc limit 1) c on true
    where q.entity = 'patient_flag_change') nf on true`;

/**
 * A held change as this reviewer may read it, by the sync read's rules (read-rules.ts, the one copy
 * routes/sync.ts requireRead and fetchRecords use; lifecycle 6.4 rule 2, review findings RD-3 and
 * VA-1), or null when they may not: Phase 4
 * sends the queue hidden answers and whole Medical notes on purpose. A visit's records need
 * encounters.chart, and a Medical visit's summary and its own addenda what reads its notes (RD-7);
 * a note's change needs a note they may read, with every answer it sends or would replace one they
 * may see; a sign-off goes without its hash to a reader who does not see every answer of any note. A problem and its notes need the problem list's keys, and a sensitive one,
 * or one whose create is still held, patients.view_sensitive. A flag change needs a flag the flag rule
 * shows them (phase 5 design 6.2, D87): a create's, or for a mark the change's, stored or its create
 * held here (heldFlagOf), read from [flags], the team's. Everything else needs patients.view. Values
 * were never schema-checked, so anything that cannot be read as a change of its kind is hidden.
 */
async function shownChange(
  tx: Tx,
  scope: TeamScope,
  flags: ReadonlyMap<string, TeamFlag>,
  r: Pick<QuarantineRow, 'entity' | 'op' | 'field' | 'value' | 'recordId' | 'flagId' | 'flagAuthorId'>,
): Promise<{ field: string | null; value: unknown } | null> {
  // Whether they read a record of this kind at all: the sync read's one copy (read-rules.ts).
  if (!readsEntity(scope.team.permissions, r.entity)) return null;
  const shown = { field: r.field, value: await shownValue(r) };
  const v = (typeof r.value === 'object' && r.value !== null ? r.value : {}) as Record<string, unknown>;
  const uuid = (x: unknown) => (typeof x === 'string' && UUID.test(x) ? x : null);
  switch (r.entity) {
    case 'encounter':
      return r.field === 'summary' && !readsMedical(scope) && (await medicalVisit(tx, r.recordId))
        ? null
        : shown;
    case 'encounter_note':
    case 'note_signoff':
    case 'note_addendum':
    case 'note_correction':
      return (await noteChangeShown(tx, scope, r, v, uuid)) ? withoutUnseenHash(scope, r, v, shown) : null;
    case 'problem':
    case 'problem_note': {
      if (scope.can('patients.view_sensitive')) return shown;
      if (r.entity === 'problem' && r.op === 'create') return sensitiveProblem(v) ? null : shown;
      // A set of a problem, or a note on one: the problem as it is, or its create held here.
      const problemId = r.entity === 'problem' ? r.recordId : uuid(v.problemId);
      const problem = problemId ? await RULES.problem.load(tx, problemId, false) : null;
      return problem && !sensitiveHidden(scope.team.permissions, problem) ? shown : null;
    }
    case 'patient_flag_change': {
      if (flagHidden(scope.team.permissions, (r.flagId && flags.get(r.flagId)) || null)) return null;
      // An Entered in error mark's value is the reason the change will be marked with, which the sync
      // read shows only to the change's author and Program Admins (flagChangeShown): a reviewer who is
      // neither is shown nothing of it, and so may not accept it (D87; review finding m-2).
      const seesWhy = r.flagAuthorId === scope.principal.userId || scope.can('team.manage_users');
      return r.op === 'set' && !seesWhy ? null : shown;
    }
    default:
      return shown;
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
  // Asked as of someone who acts as no note's author, when the change creates the note.
  const readerFor = (note: StoredRecord | null) =>
    note === null
      ? noteReader(scope.team.permissions, scope.team.credential, false)
      : readerOf(scope, actingAuthor(note));
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
 * gets `signoff_not_applied` naming that sign-off, a kind of its own so that no phone needs state of
 * its own to word it (review finding SRC-2), once per sign-off whether or not they have read it: a
 * refused accept and the reject that follows tell them once, and a second held Complete of the same
 * note, its own sign-off, is told on its own (SRC-1, SRC-5). The notice also names the note (D104):
 * a held sign-off is in no sync read, so a phone that never held it finds the note by that alone.
 * Only for a sign-off of a note on the chart; anything else tells nobody. The note's ID, or null.
 */
async function signoffNotApplied(
  tx: Tx,
  teamId: string,
  item: Pick<QuarantineRow, 'entity' | 'op' | 'userId' | 'recordId' | 'value'>,
): Promise<string | null> {
  if (item.entity !== 'note_signoff' || item.op !== 'create') return null;
  // Values were never schema-checked, so the note is read only when it is a UUID.
  const noteId = (item.value as { noteId?: unknown } | null)?.noteId;
  if (typeof noteId !== 'string' || !UUID.test(noteId)) return null;
  const [note] = await tx<{ id: string }[]>`
    select id from sineobex.encounter_notes where id = ${noteId} and team_id = ${teamId}`;
  if (!note) return null;
  await tx`
    insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id, note_id)
    select ${teamId}, ${item.userId}, 'signoff_not_applied', 'note_signoff', ${item.recordId}, ${note.id}
    where not exists (
      select 1 from sineobex.user_notices
      where team_id = ${teamId} and user_id = ${item.userId} and kind = 'signoff_not_applied'
        and entity = 'note_signoff' and record_id = ${item.recordId})`;
  return note.id;
}

/**
 * A held correction that will not reach the chart: rejected, or its accept refused (review finding
 * VS-6). Its phone let go of it when it was held, and Complete never makes it again, so its sender
 * gets `correction_not_applied` naming it and its note (D104), once per correction, as
 * signoffNotApplied tells of a sign-off; the notice holds no text of it. Only for a correction of a
 * note on the chart; anything else tells nobody. The note's ID, or null.
 */
async function correctionNotApplied(
  tx: Tx,
  teamId: string,
  item: Pick<QuarantineRow, 'entity' | 'op' | 'userId' | 'recordId' | 'value'>,
): Promise<string | null> {
  if (item.entity !== 'note_correction' || item.op !== 'create') return null;
  const noteId = (item.value as { noteId?: unknown } | null)?.noteId;
  if (typeof noteId !== 'string' || !UUID.test(noteId)) return null;
  const [note] = await tx<{ id: string }[]>`
    select id from sineobex.encounter_notes where id = ${noteId} and team_id = ${teamId}`;
  if (!note) return null;
  await tx`
    insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id, note_id)
    select ${teamId}, ${item.userId}, 'correction_not_applied', 'note_correction', ${item.recordId}, ${note.id}
    where not exists (
      select 1 from sineobex.user_notices
      where team_id = ${teamId} and user_id = ${item.userId} and kind = 'correction_not_applied'
        and entity = 'note_correction' and record_id = ${item.recordId})`;
  return note.id;
}

/**
 * A held flag change that will not reach the chart: rejected, or its accept refused (phase 5 design
 * 6.2). Its phone let go of it when it was held, so its sender gets `flag_change_not_applied` naming
 * the flag change, its create's record or the one its mark was for, and its patient, as the queue
 * names it (patient_of_change: the change's row, else what its value or its held create names), so a
 * phone that never held it opens the chart by it. Once per flag change, as signoffNotApplied tells of
 * a sign-off; the notice holds no text of it. Only for a patient on the chart, selected first: a
 * patient whose create was itself held and rejected tells nobody, since the notice's key would abort
 * the reject (intake's risk level). The patient's ID, or null.
 */
async function flagChangeNotApplied(
  tx: Tx,
  teamId: string,
  item: Pick<QuarantineRow, 'id' | 'entity' | 'userId' | 'recordId'>,
): Promise<string | null> {
  if (item.entity !== 'patient_flag_change') return null;
  const named = await patientOfItem(tx, item.id);
  if (!named) return null;
  const [patient] = await tx<{ id: string }[]>`
    select id from sineobex.patients where id = ${named} and team_id = ${teamId}`;
  if (!patient) return null;
  await tx`
    insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id, patient_id)
    select ${teamId}, ${item.userId}, 'flag_change_not_applied', 'patient_flag_change', ${item.recordId}, ${patient.id}
    where not exists (
      select 1 from sineobex.user_notices
      where team_id = ${teamId} and user_id = ${item.userId} and kind = 'flag_change_not_applied'
        and entity = 'patient_flag_change' and record_id = ${item.recordId})`;
  return patient.id;
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
 * Only a reviewer who may read the change accepts it (403 `change_hidden`), and one the queue leaves
 * a change out for (leftOut) neither accepts nor rejects it. Reject keeps the item, with the reason,
 * forever.
 *
 * PLAN-OPEN: may a Program Admin's accept put a held change over a value its sender never saw
 * (lifecycle 12.1 #36; plan section 6)? No: it is applied as it was made, at the version it named,
 * by the rule a push of it meets, so over a field that holds another value since it is refused
 * (cannot_apply). A Medical visit's summary set by a sender who may not read it, and a conflict its
 * sender may not see into, are always held (apply.ts); a reviewer who may read both writes the
 * value themselves.
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
    const flags = await teamFlags(tx, scope.team.teamId);
    const rows = await tx<QuarantineRow[]>`
      select q.*, null as user_name, null as decided_by_name, null as patient_id, nf.flag_id, nf.flag_author_id
      from sineobex.quarantine_items q ${heldFlagOf(tx, scope.team.teamId)}
      where q.id = ${itemId} for update of q`;
    const item = rows[0];
    if (!item) throw notFound('quarantined record');
    // What the queue leaves out for this reviewer, they decide nothing of, and learn nothing of: not
    // even whether it was decided already.
    if (leftOut(scope.team.permissions, flags, item)) return 'left_out' as const;
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
      if ((await shownChange(tx, scope, flags, item)) === null) {
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
        // PLAN-OPEN (TM-9): is an admin's refused accept of a held change logged? Only for a held
        // correction, a held flag change, or a held sign-off its note no longer matches, whose
        // sender is told to act again; any other refusal rolls back and writes nothing.
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
        // A held correction refused now (the draft moved since, a teammate's correction got there
        // first): its phone let go of it when it was held, so its sender is told, naming the note,
        // to correct it again, and the refusal is logged with it (review finding VS-6). The item
        // stays pending, for the reviewer to reject.
        if (item.entity === 'note_correction') {
          const noteId = await correctionNotApplied(tx, scope.team.teamId, item);
          if (!noteId) throw refused;
          await audit({
            action: 'quarantine.accept_refused',
            entity: 'encounter_note',
            entityId: noteId,
            patientId: await patientOfItem(tx, itemId),
            details: { itemId, changeId: item.changeId, problem },
          });
          return refused;
        }
        // A held flag change refused now (a reason the rule refuses, never read while it was held):
        // its phone let go of it when it was held, so its sender is told, naming its patient, and the
        // refusal is logged on the patient (phase 5 design 6.2). The item stays pending, for the
        // reviewer to reject.
        if (item.entity === 'patient_flag_change') {
          const patientId = await flagChangeNotApplied(tx, scope.team.teamId, item);
          if (!patientId) throw refused;
          await audit({
            action: 'quarantine.accept_refused',
            entity: 'patient_flag_change',
            entityId: item.recordId,
            patientId,
            details: { itemId, changeId: item.changeId, problem },
          });
          return refused;
        }
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
    // A held sign-off rejected tells its sender the note needs completing again (NOT-12), a held
    // correction that it needs correcting again (VS-6), and a held flag change that it was not made
    // (design 6.2).
    if (decision === 'reject') {
      await signoffNotApplied(tx, scope.team.teamId, item);
      await correctionNotApplied(tx, scope.team.teamId, item);
      await flagChangeNotApplied(tx, scope.team.teamId, item);
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
  if (outcome instanceof ApiError) throw outcome;
  if (outcome === 'own') {
    await scope.tx((_, audit) =>
      audit({ action: 'access.denied', details: { reason: 'own_quarantined_change', itemId } }),
    );
    throw forbidden('Someone else on the team must review your own records.', 'own_change');
  }
  if (outcome === 'hidden' || outcome === 'left_out') {
    await scope.tx((_, audit) =>
      audit({ action: 'access.denied', details: { reason: 'change_hidden', itemId } }),
    );
    throw forbidden(
      outcome === 'hidden'
        ? 'Your role can’t read this record, so you can’t accept it onto the chart. You can reject it, or leave it for someone who can read it.'
        : 'Your role can’t read this record, so you can’t decide on it. Leave it for someone who can read it.',
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
    // The team's window for a problem's status check, read once, the first time a problem is read.
    let checkDays: number | undefined;
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
        action: viewedAction(ref.entity),
        entity: ref.entity,
        entityId: ref.id,
        patientId: shown.patientId,
        details: { source: 'sync' },
      });
    }
    return { records, missing };

    /**
     * The record as this reader may see it, or null when they may not see it at all, by the visit
     * read's rules (encounters/read.ts), which this calls rather than copies. Sensitive problems
     * need patients.view_sensitive (Oct 19), and a problem's note goes with it. A note leaves out
     * the answers the reader may not see (lifecycle 6.4), and what hangs off a note goes with it:
     * its sign-offs, its addenda, and a correction, which is also missing when one of the answers
     * it changes is hidden from the reader, now or in any state the note has held, since its old or
     * new value would give it away (hiddenCorrections). A sign-off's content hash goes only to
     * whoever acts as the author, its signer, and a reader who sees every answer of any note, and
     * never over a visit's summary withheld from the reader (signoffHashShown). A visit's summary
     * goes with its notes (medicalHidden), and its status, and whether it holds a finished note, are
     * worked out from the notes the reader may read (statusShown). A flag change is read by the flag
     * rule, and once entered in error without its reasons for whoever neither made it nor is a
     * Program Admin (read-rules.ts flagChangeShown, phase 5 design 6.2).
     */
    async function asRead(record: StoredRecord): Promise<StoredRecord | null> {
      switch (record.entity) {
        case 'problem':
          return (await readsRecord(tx, scope.team.permissions, record)) ? withStatusCheck(record) : null;
        case 'problem_note':
          return (await readsRecord(tx, scope.team.permissions, record)) ? record : null;
        case 'encounter_note':
          return (await noteShown(record))?.note ?? null;
        case 'note_signoff': {
          const note = await noteOf(record);
          const read = await noteRead(note);
          if (!read) return null;
          const visit = await RULES.encounter.load(tx, note!.attributes.encounterId as string, false);
          return signoffHashShown(
            read,
            record.authorUserId,
            scope.principal.userId,
            !visit || summaryHidden(visit),
          )
            ? record
            : withoutHash(record);
        }
        case 'encounter': {
          const shown = await notesShown(record);
          const visit = summaryHidden(record) ? withoutSummary(record) : record;
          return {
            ...visit,
            status: statusShown(shown),
            // The patient, the place and the summary are locked from the first finished note on
            // (lifecycle 3.1): a visit whose status is a draft may hold one (review finding SLK-1).
            attributes: { ...visit.attributes, hasFinishedNote: shown.some((n) => n.status !== 'draft') },
          };
        }
        case 'note_addendum': {
          // An addendum to the visit itself is read with the visit: with its summary, on a Medical one.
          if (record.attributes.noteId !== null) return (await noteRead(await noteOf(record))) && record;
          const visit = await RULES.encounter.load(tx, record.attributes.encounterId as string, false);
          return visit && !summaryHidden(visit) ? record : null;
        }
        case 'note_correction': {
          const read = await noteRead(await noteOf(record));
          if (!read) return null;
          // Asked with every correction of the note, in the order they were applied: one is hidden
          // when a value it names was hidden in any state the note has held (LRD-1).
          const all = await tx<StoredCorrection[]>`
            select id, outcome, changes from sineobex.note_corrections
            where team_id = ${record.teamId} and note_id = ${record.attributes.noteId as string}
            order by created_at, id`;
          return hiddenCorrections(read, all).has(record.id) ? null : record;
        }
        case 'patient_flag_change':
          return flagChangeShown(
            scope.team.permissions,
            scope.principal.userId,
            record,
            await flagHead(tx, record.teamId, record.attributes.flagId as string),
          );
        default:
          return record;
      }
    }

    /**
     * A problem says whether its status check is due, by the team's window at the server's time,
     * as the chart's copy of it does (charts.ts; phase 5 design 5.3), so the phone holds one record
     * whichever way it came.
     */
    async function withStatusCheck(problem: StoredRecord): Promise<StoredRecord> {
      checkDays ??= await problemCheckDays(tx, scope.team.teamId);
      const statusCheckDue = problemCheckDue(
        {
          status: problem.status as 'new' | 'ongoing' | 'resolved',
          statusCheckedAt: new Date(problem.attributes.statusCheckedAt as string),
          enteredInError: problem.values.enteredInError !== null,
        },
        scope.deps.now(),
        checkDays,
      );
      return { ...problem, attributes: { ...problem.attributes, statusCheckDue } };
    }

    /** A Medical visit's summary is Medical content (encounters/read.ts medicalHidden). */
    function summaryHidden(visit: StoredRecord): boolean {
      return medicalHidden(scope.team.permissions, visit.values.kind);
    }

    /**
     * The visit's notes the reader may read, as the visit's status (encounters/read.ts statusShown)
     * and whether it holds a finished note are worked out from them.
     */
    async function notesShown(visit: StoredRecord): Promise<StatusNote[]> {
      const rows = await tx<{ id: string }[]>`
        select id from sineobex.encounter_notes where team_id = ${visit.teamId} and encounter_id = ${visit.id}`;
      const shown = [];
      for (const { id } of rows) {
        const read = await noteRead(await noteRules.load(tx, id, false));
        if (read) shown.push(statusNote(read));
      }
      return shown;
    }

    function noteOf(record: StoredRecord) {
      return noteRules.load(tx, record.attributes.noteId as string, false);
    }

    /**
     * A note as this reader may read it (encounters/read.ts noteAsRead), or null. Whoever acts as
     * the author of a draft is given every answer it holds, hidden ones included, so they come back
     * when their field shows again.
     */
    function noteRead(note: StoredRecord | null) {
      return noteAsRead(tx, scope, note, { authorsDraftAsStored: true });
    }

    /**
     * A note as the sync read sends it (noteRead): the author's draft as stored; everyone else, and
     * every finished note, the answers that count that the reader may see. A hidden answer leaves
     * no key behind: no value, no version, no mark of who changed it. A phase 2 note with no version
     * has no definition and is read whole.
     */
    async function noteShown(note: StoredRecord) {
      const read = await noteRead(note);
      if (!read) return null;
      if (read.type === undefined || (read.reader.actsAsAuthor && read.note.status === 'draft')) return read;
      return { ...read, note: onlyAnswers(read.note, read.seen) };
    }
  });
}

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
        noteId: string | null;
        patientId: string | null;
        createdAt: Date;
        readAt: Date | null;
      }[]
    >`
      select id, kind, entity, record_id, note_id, patient_id, created_at, read_at from sineobex.user_notices
      where user_id = ${scope.principal.userId}
      order by created_at desc limit 100`,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    entity: r.entity,
    recordId: r.recordId,
    noteId: r.noteId,
    patientId: r.patientId,
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
