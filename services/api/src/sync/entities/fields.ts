import type { Tx } from '../../db/database.ts';
import { ESTIMATE_RANGE } from '../../patients/match-constants.ts';
import { recognisableAfter } from '../../patients/recognisable.ts';
import {
  appendHistory,
  historyOf,
  invalid,
  isBlank,
  isLocked,
  MAX_NOTE_FIELDS,
  rejected,
  sameValue,
  when,
  type FieldClass,
  type HistoryKind,
  type Outcome,
  type SetContext,
} from '../records.ts';

/**
 * The reconciliation rules, chosen by field class (phase 3 design 2.4, D26). The caller (apply.ts
 * `set`) has parsed the value, loaded and locked the record, checked the parents the value names
 * and followed a redirect; `s.cur` is the field as the server holds it and `s.saw` whether the
 * person saw that version.
 *
 * - draft (encounters and notes, D9): a different non-blank value is a conflict, shown side by side.
 * - keep-both (patient demographics, module 9): the chart keeps its value, the other is kept in
 *   history, and a field review opens. Accepted either way, so it never waits in Needs attention.
 * - identity (legal name, birth): a fill only from someone who saw the current value, or into a
 *   blank; anything else is an admin's correction, or a kept alternate for one.
 * - set-once (retractions): the first wins, later ones are history.
 * - status (problems): the entity's own rule (problem.ts, design 9.2).
 */

export async function applyField(cls: FieldClass, s: SetContext): Promise<Outcome> {
  switch (cls) {
    case 'draft':
      return draftSet(s);
    case 'keep_both':
      return keepBothSet(s);
    case 'identity':
      return identitySet(s);
    case 'set_once':
      return setOnceSet(s);
    case 'status':
      return s.rules.applyStatus!(s);
  }
}

/**
 * Writes the value to the chart: the field's next version, a history row with the value it
 * replaced, and the audit event. A redirected change is written as `redirected`, so a merge undo
 * can list it (design 2.7).
 */
export async function writeValue(
  s: SetContext,
  kind: HistoryKind,
  approvedBy: string | null = s.actor.approvedBy,
): Promise<Outcome> {
  const written = s.redirect ? 'redirected' : kind;
  const version = s.cur.version + 1;
  await s.rules.write(s.tx, s.rec, s.field, s.value, version, {
    by: s.actor.authorId,
    at: when(s.change).toISOString(),
    changeId: s.change.changeId,
  });
  await appendHistory(s.tx, {
    ...historyOf(s, s.rules.entity, s.rec.id, s.field, version, s.value, s.cur.value, written),
    approvedBy,
  });
  await s.audit({
    action: s.rules.writeAction?.(s.field) ?? `${s.rules.auditPrefix}.updated`,
    entity: s.rules.entity,
    entityId: s.rec.id,
    patientId: s.rec.patientId,
    deviceTime: new Date(s.change.deviceTime),
    details: {
      ...s.actor.auditDetails,
      changeId: s.change.changeId,
      field: s.field,
      kind: written,
      version,
      ...(s.redirect ? { redirectedFrom: s.change.recordId } : {}),
    },
  });
  await s.rules.afterWrite?.(s);
  return { status: 'accepted', serverVersion: version };
}

/**
 * Keeps the value in the field's history without applying it. With `needs`, it is the other value
 * of an open field review (kept both); otherwise history only (a stale observation, a second
 * retraction, a clear that would leave nobody recognisable). Either way the server holds exactly
 * the value the phone hashed, so the change is accepted, at the field's current version, and the
 * receipt carries the chart's value (design 2.5).
 */
export async function keepInHistory(
  s: SetContext,
  opts: { needs?: 'patients.edit' | 'patients.correct_identity'; problem?: string } = {},
): Promise<Outcome> {
  const reviewId = opts.needs ? await openReview(s, opts.needs) : null;
  await appendHistory(s.tx, {
    ...historyOf(s, s.rules.entity, s.rec.id, s.field, s.cur.version, s.value, s.cur.value, 'kept_both'),
    reviewId,
  });
  const audit = {
    entity: s.rules.entity,
    entityId: s.rec.id,
    patientId: s.rec.patientId,
    deviceTime: new Date(s.change.deviceTime),
  };
  const redirected = s.redirect ? { redirectedFrom: s.change.recordId } : {};
  if (reviewId) {
    await s.audit({
      ...audit,
      action: `${s.rules.auditPrefix}.field_contested`,
      details: {
        ...s.actor.auditDetails,
        changeId: s.change.changeId,
        field: s.field,
        reviewId,
        ...redirected,
      },
    });
  } else {
    await s.audit({
      ...audit,
      action: `${s.rules.auditPrefix}.kept_in_history`,
      details: {
        ...s.actor.auditDetails,
        changeId: s.change.changeId,
        field: s.field,
        version: s.cur.version,
        ...(opts.problem ? { problem: opts.problem } : {}),
        ...redirected,
      },
    });
  }
  return {
    status: 'accepted',
    serverVersion: s.cur.version,
    server: s.cur,
    details: reviewId
      ? { outcome: 'kept_both', reviewId }
      : { outcome: 'history_only', ...(opts.problem ? { problem: opts.problem } : {}) },
  };
}

/**
 * "Two edits to the same field keep both values and flag the record for review" (module 9): the
 * field's open review, opened now or the one already open (one per field), on the patient record.
 */
async function openReview(s: SetContext, needs: 'patients.edit' | 'patients.correct_identity') {
  const [opened] = await s.tx<{ id: string }[]>`
    insert into sineobex.field_reviews (team_id, patient_id, entity, record_id, field, needs, opened_by_change)
    values (${s.actor.teamId}, ${s.rec.id}, ${s.rules.entity}, ${s.rec.id}, ${s.field}, ${needs},
            ${s.change.changeId})
    on conflict (team_id, entity, record_id, field) where status = 'open' do nothing
    returning id`;
  if (opened) return opened.id;
  const [open] = await s.tx<{ id: string }[]>`
    select id from sineobex.field_reviews
    where team_id = ${s.actor.teamId} and entity = ${s.rules.entity} and record_id = ${s.rec.id}
      and field = ${s.field} and status = 'open'`;
  return open!.id;
}

/**
 * The person looked at both values and kept the server's. Their own value is kept in history,
 * never lost. Only the value they saw can be kept: if it changed again since, they choose again.
 * On a draft, its author is told when the kept value came from someone else.
 */
export async function keepServer(s: SetContext, notifyAuthor: boolean): Promise<Outcome> {
  const { tx, actor, change: c, rec, field, cur } = s;
  if (!s.saw) return { status: 'conflict', server: cur };
  const decider = actor.approvedBy ?? actor.authorId;
  await appendHistory(tx, {
    ...historyOf(s, s.rules.entity, rec.id, field, cur.version, s.value, cur.value, 'kept_both'),
    approvedBy: decider,
  });
  if (notifyAuthor && cur.changedBy && cur.changedBy !== actor.authorId && rec.authorUserId !== decider) {
    await tx`
      insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
      values (${actor.teamId}, ${rec.authorUserId}, 'conflict_resolved', ${s.rules.entity}, ${rec.id})`;
  }
  await s.audit({
    action: `${s.rules.auditPrefix}.conflict_resolved`,
    entity: s.rules.entity,
    entityId: rec.id,
    patientId: rec.patientId,
    deviceTime: new Date(c.deviceTime),
    details: { ...actor.auditDetails, changeId: c.changeId, field, kept: 'server', version: cur.version },
  });
  return { status: 'accepted', serverVersion: cur.version };
}

/** The draft reconciliation rule (Oct 19 decisions; plan D9). */
async function draftSet(s: SetContext): Promise<Outcome> {
  const { actor, change: c, rec, field, cur } = s;
  if (isLocked(rec)) return rejected('record_locked');
  const dataFields = Object.keys(rec.fieldVersions).filter((f) => f.startsWith('data.'));
  if (field.startsWith('data.') && !(field in rec.fieldVersions) && dataFields.length >= MAX_NOTE_FIELDS) {
    return invalid('too_many_fields');
  }
  if (c.resolution === 'keep_server') return keepServer(s, true);

  // Already the server's value: nothing to write, and the phone now holds the current version.
  if (sameValue(cur.value, s.value)) return { status: 'accepted', serverVersion: cur.version };

  if (c.resolution === 'replace') {
    if (!s.saw) return { status: 'conflict', server: cur };
    return writeValue(s, 'replaced_after_review', actor.approvedBy ?? actor.authorId);
  }
  if (s.saw) return writeValue(s, 'set');
  if (isBlank(cur.value)) return writeValue(s, 'filled_blank');
  // "A field that already holds a different value is never overwritten silently."
  return { status: 'conflict', server: cur };
}

/** Defaults that record nothing yet: an allergy screen or ID card choice "not asked" is blank. */
function blank(field: string, value: unknown): boolean {
  if ((field === 'allergyScreen' || field === 'idCardChoice') && value === 'not_asked') return true;
  return isBlank(value);
}

/** A change that never conflicts was sent as the answer to a conflict. */
const NOTHING_TO_RESOLVE = 'nothing_to_resolve';

/** Whether any record of the patient's group has an active allergy. */
export async function groupHasActiveAllergy(tx: Tx, teamId: string, canonicalId: string): Promise<boolean> {
  const rows = await tx`
    select 1 from sineobex.patient_allergies a
    join sineobex.patients p on p.team_id = a.team_id and p.id = a.patient_id
    where a.team_id = ${teamId} and p.canonical_id = ${canonicalId} and a.status = 'active'
    limit 1`;
  return rows.length > 0;
}

/** Patient demographics (design 2.4, keep-both). */
async function keepBothSet(s: SetContext): Promise<Outcome> {
  if (s.change.resolution) return invalid(NOTHING_TO_RESOLVE);
  if (sameValue(s.cur.value, s.value)) return { status: 'accepted', serverVersion: s.cur.version };
  // An allergy outranks "No known allergies", whichever arrives first (design 2.3; the allergy
  // create handles the other order). Nothing to review: the allergy is the answer.
  if (
    s.field === 'allergyScreen' &&
    s.value === 'none_known' &&
    (await groupHasActiveAllergy(s.tx, s.actor.teamId, s.rec.id))
  ) {
    return keepInHistory(s);
  }
  if (s.saw || blank(s.field, s.cur.value))
    return writeUnlessUnrecognisable(s, s.saw ? 'set' : 'filled_blank');
  return keepInHistory(s, { needs: 'patients.edit' });
}

/**
 * Someone must stay recognisable (design 2.3, D42). Two phones that each clear a different name
 * field, both from the version they saw, each pass the field rule; the second is kept in history
 * with a notice instead, because the worker can't fix a race with another phone.
 */
function writeUnlessUnrecognisable(s: SetContext, kind: HistoryKind): Promise<Outcome> {
  if (!recognisableAfter(s.rec, s.field, s.value)) {
    return keepInHistory(s, { problem: 'nothing_to_recognise' });
  }
  return writeValue(s, kind);
}

// An estimate ("about 46") is refined to a stated year or date only within ESTIMATE_RANGE years of
// it, the matcher's own range (design 2.4, 14.1 #12).
type BirthValue = { precision: 'day'; date: string } | { precision: 'year' | 'estimated'; year: number };
type LegalNameValue = { given: string | null; family: string | null };

const birthYear = (b: BirthValue) => (b.precision === 'day' ? Number(b.date.slice(0, 4)) : b.year);

/** An estimate refined to a stated year or date further away than ESTIMATE_RANGE. */
function refinedOutOfRange(cur: BirthValue, next: BirthValue): boolean {
  return (
    cur.precision === 'estimated' &&
    next.precision !== 'estimated' &&
    Math.abs(birthYear(next) - cur.year) > ESTIMATE_RANGE
  );
}

/**
 * `next` keeps every recorded part of `cur` and only adds to it (design 2.4): a legal name part
 * that was missing; a year made a date in that year; an estimate made a year or a date within
 * ESTIMATE_RANGE of it.
 */
export function fills(field: string, cur: unknown, next: unknown): boolean {
  if (next === null) return false;
  if (field === 'legalName') {
    const c = cur as LegalNameValue;
    const n = next as LegalNameValue;
    return (c.given === null || n.given === c.given) && (c.family === null || n.family === c.family);
  }
  const c = cur as BirthValue;
  const n = next as BirthValue;
  if (c.precision === 'year') return n.precision === 'day' && birthYear(n) === c.year;
  if (c.precision === 'estimated') {
    return n.precision !== 'estimated' && Math.abs(birthYear(n) - c.year) <= ESTIMATE_RANGE;
  }
  return false;
}

/**
 * Legal name and birth (design 2.4, identity). Changing a recorded value is an admin's correction
 * (Oct 19); staff may fill what's missing, but only when they saw the current value, so a fill
 * made before an admin's correction never lands on it (it is kept for an admin instead).
 */
async function identitySet(s: SetContext): Promise<Outcome> {
  if (s.change.resolution) return invalid(NOTHING_TO_RESOLVE);
  if (sameValue(s.cur.value, s.value)) return { status: 'accepted', serverVersion: s.cur.version };
  // A blank holds nothing to overwrite, whoever saw what.
  if (isBlank(s.cur.value)) return writeUnlessUnrecognisable(s, 'filled_blank');
  if (!s.saw) return keepInHistory(s, { needs: 'patients.correct_identity' });
  if (fills(s.field, s.cur.value, s.value)) return writeUnlessUnrecognisable(s, 'filled_blank');
  // "That's more than 3 years from the estimate. A Program Admin will check it." (design 11.5)
  if (
    s.field === 'birth' &&
    s.value !== null &&
    refinedOutOfRange(s.cur.value as BirthValue, s.value as BirthValue)
  ) {
    return keepInHistory(s, { needs: 'patients.correct_identity' });
  }
  // The phone never sends this (a hard stop mirror): a recorded value is corrected in the portal.
  return invalid('identity_admin_only');
}

/** Retractions (design 2.4, set-once): the first is written, a later one kept in history. Never un-set. */
async function setOnceSet(s: SetContext): Promise<Outcome> {
  if (s.change.resolution) return invalid(NOTHING_TO_RESOLVE);
  if (!isBlank(s.cur.value)) return keepInHistory(s);
  return writeValue(s, s.field === 'enteredInError' ? 'entered_in_error' : 'set');
}
