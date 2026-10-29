import type { AuditFn, TeamScope } from '../auth/context.ts';
import type { Permission } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { conflict, invalid, notFound } from '../lib/errors.ts';
import { sha256Hex } from '../sync/canonical.ts';
import { loadPatient, writePatient } from '../sync/entities/patient.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import { fieldState, jsonb, sameValue, type StoredRecord } from '../sync/records.ts';
import { rematchPatient } from './duplicates.ts';
import { recognisableAfter } from './recognisable.ts';
import type {
  DecideFieldReviewInput,
  FieldReviewPageValue,
  FieldReviewQueryValue,
  FieldReviewViewValue,
} from './schemas.ts';

/**
 * Field reviews: the keep-both rule's queue (phase 3 design 2.4, 3.2; D26). When two people record
 * different values for one patient field and the second didn't see the first, the chart keeps its
 * value, the other is a `kept_both` history row carrying the review's ID, and someone who knows the
 * patient picks. Phones and the portal decide online, so a decision never races a push.
 *
 * Patient fields are read and written through the sync patient entity (sync/entities/patient.ts),
 * so a decision stores a value exactly as a phone's change would.
 */

export const IDENTITY_FIELDS: readonly string[] = ['legalName', 'birth'];
/** Fields that identify someone: an accepted change re-runs duplicate matching (design 8.2). */
const MATCHED_FIELDS: readonly string[] = ['preferredName', 'legalName', 'birth'];

/** The canonical patient of a record loadPatient returned: itself, or its survivor when merged. */
export const groupIdOf = (rec: StoredRecord) => rec.internal.canonicalId as string;

/** A field history row of a patient field, written outside the sync apply path; returns its ID. */
export async function appendPatientHistory(
  tx: Tx,
  e: {
    teamId: string;
    recordId: string;
    field: string;
    version: number;
    value: unknown;
    previousValue: unknown;
    kind: 'corrected' | 'review_decided';
    changedBy: string;
    approvedBy: string;
    reviewId?: string | null;
  },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into sineobex.field_history
      (team_id, entity, record_id, field, version, value, previous_value, kind, changed_by, approved_by, review_id)
    values (${e.teamId}, 'patient', ${e.recordId}, ${e.field}, ${e.version}, ${jsonb(tx, e.value)},
            ${jsonb(tx, e.previousValue)}, ${e.kind}, ${e.changedBy}, ${e.approvedBy}, ${e.reviewId ?? null})
    returning id::text as id`;
  return row!.id;
}

/** Re-runs duplicate matching after a decided or corrected field that identifies someone. */
export async function rematchAfter(tx: Tx, audit: AuditFn, rec: StoredRecord, field: string) {
  if (!MATCHED_FIELDS.includes(field)) return;
  await rematchPatient(tx, audit, groupIdOf(rec), IDENTITY_FIELDS.includes(field) ? 'correction' : 'edit');
}

/** Reviews per page. */
export const FIELD_REVIEW_PAGE_SIZE = 50;

interface ReviewRow {
  id: string;
  recordId: string;
  canonicalId: string;
  field: string;
  needs: 'patients.edit' | 'patients.correct_identity';
  status: 'open' | 'decided' | 'obsolete';
  openedAt: Date;
}

/** Reviews as the queue and the review sheet show them: the chart's value beside the alternates. */
async function reviewViews(tx: Tx, rows: ReviewRow[]): Promise<FieldReviewViewValue[]> {
  if (rows.length === 0) return [];
  const alternates = await tx<
    {
      id: string;
      reviewId: string;
      value: unknown;
      changedBy: string;
      displayName: string;
      deviceTime: Date | null;
    }[]
  >`
    select h.id::text as id, h.review_id, h.value, h.changed_by, u.display_name, h.device_time
    from sineobex.field_history h join sineobex.users u on u.id = h.changed_by
    where h.review_id = any(${rows.map((r) => r.id)}::uuid[]) and h.kind = 'kept_both'
    order by h.id`;
  const records = new Map<string, StoredRecord | null>();
  for (const r of rows) {
    if (!records.has(r.recordId)) records.set(r.recordId, await loadPatient(tx, r.recordId, false));
  }
  return rows.map((r) => {
    const rec = records.get(r.recordId);
    return {
      id: r.id,
      patientId: r.canonicalId,
      field: r.field,
      needs: r.needs,
      current: rec ? fieldState(rec, r.field) : { value: null, version: 0, changedBy: null, changedAt: null },
      alternates: alternates
        .filter((a) => a.reviewId === r.id)
        .map((a) => ({
          historyId: a.id,
          value: a.value,
          by: { userId: a.changedBy, displayName: a.displayName },
          deviceTime: a.deviceTime?.toISOString() ?? null,
        })),
      openedAt: r.openedAt.toISOString(),
      status: r.status,
    };
  });
}

const reviewColumns = (tx: Tx) => tx`
  r.id, r.record_id, p.canonical_id, r.field, r.needs, r.status, r.opened_at`;

/**
 * GET /v1/team/field-reviews (phase 3 design 3.2): reviews the caller may decide (their `needs`
 * is a permission the caller holds), oldest first. Audited as `field_review.viewed {count}` and
 * `patient.viewed {source: 'field_review'}` per patient on the page.
 */
export async function listFieldReviews(
  scope: TeamScope,
  query: FieldReviewQueryValue,
): Promise<FieldReviewPageValue> {
  const decides = (['patients.edit', 'patients.correct_identity'] as Permission[]).filter((p) =>
    scope.can(p),
  );
  return scope.tx(async (tx, audit) => {
    const rows = await tx<ReviewRow[]>`
      select ${reviewColumns(tx)}
      from sineobex.field_reviews r
      join sineobex.patients p on p.team_id = r.team_id and p.id = r.patient_id
      where r.team_id = ${scope.team.teamId} and r.status = ${query.status} and r.needs = any(${decides})
        ${
          query.afterId
            ? tx`and (r.opened_at, r.id) > (
                select a.opened_at, a.id from sineobex.field_reviews a where a.id = ${query.afterId})`
            : tx``
        }
      order by r.opened_at, r.id
      limit ${FIELD_REVIEW_PAGE_SIZE + 1}`;
    const page = rows.slice(0, FIELD_REVIEW_PAGE_SIZE);
    // The values are chart content: the page is logged, and each patient on it.
    await audit({ action: 'field_review.viewed', details: { status: query.status, count: page.length } });
    for (const patientId of new Set(page.map((r) => r.canonicalId))) {
      await audit({ action: 'patient.viewed', patientId, details: { source: 'field_review' } });
    }
    return {
      reviews: await reviewViews(tx, page),
      nextAfterId: rows.length > page.length ? page.at(-1)!.id : null,
    };
  });
}

/** What the refusal is logged with: the route, as the access log names it. */
const DECIDE_ROUTE = '/v1/team/field-reviews/:reviewId/decision';

/**
 * POST /v1/team/field-reviews/{reviewId}/decision: needs the review's `needs`, and a recent sign-in
 * when that is patients.correct_identity (scope.requireRecentAuth()). Keeping an alternate writes it
 * after the recognisability check (409 nothing_to_recognise); a stale baseVersion is 409
 * field_changed. Audited as `field_review.decided {reviewId, kept, historyId, version}`.
 */
export async function decideFieldReview(
  scope: TeamScope,
  reviewId: string,
  input: DecideFieldReviewInput,
): Promise<FieldReviewViewValue> {
  // Who may decide depends on the review, so look first; a refusal is logged in its own transaction.
  const [found] = await scope.tx(
    (tx) => tx<{ needs: Permission }[]>`select needs from sineobex.field_reviews where id = ${reviewId}`,
  );
  if (!found) throw notFound('review');
  await scope.require(found.needs, DECIDE_ROUTE);
  const identity = found.needs === 'patients.correct_identity';
  if (identity) scope.requireRecentAuth();

  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, scope.team.teamId);
    const [review] = await tx<ReviewRow[]>`
      select ${reviewColumns(tx)}
      from sineobex.field_reviews r
      join sineobex.patients p on p.team_id = r.team_id and p.id = r.patient_id
      where r.id = ${reviewId} for update of r`;
    if (!review || review.needs !== found.needs) throw notFound('review');
    if (review.status !== 'open') throw conflict('already_decided', 'This review was already decided.');
    if (IDENTITY_FIELDS.includes(review.field) && input.comment === undefined) {
      throw invalid('comment_required', 'Say why: a legal name or birth date is changed with a reason.');
    }
    const rec = await loadPatient(tx, review.recordId, true);
    if (!rec) throw notFound('review');
    const current = fieldState(rec, review.field);
    // Versions only: the reviewer re-reads the chart through the audited GET.
    if (input.baseVersion !== current.version) {
      throw conflict('field_changed', 'This field changed since you opened the review. Look again.', {
        field: review.field,
        version: current.version,
      });
    }

    const decider = scope.principal.userId;
    const now = scope.deps.now();
    let version = current.version;
    let correctionId: string | null = null;
    if (input.keep === 'alternate') {
      const [alternate] = await tx<{ value: unknown; changedBy: string }[]>`
        select value, changed_by from sineobex.field_history
        where id = ${input.historyId!}::bigint and review_id = ${review.id} and kind = 'kept_both'`;
      if (!alternate) throw invalid('not_an_alternate', 'That value isn’t one of this review’s.');
      if (!recognisableAfter(rec, review.field, alternate.value)) {
        throw conflict(
          'nothing_to_recognise',
          'Keeping that value would leave no name or description. Keep the chart’s value.',
        );
      }
      if (!sameValue(current.value, alternate.value)) {
        version = current.version + 1;
        // Recorded as the person who saw that value, approved by the reviewer.
        await writePatient(tx, rec, review.field, alternate.value, version, {
          by: alternate.changedBy,
          at: now.toISOString(),
          changeId: null,
        });
        const historyId = await appendPatientHistory(tx, {
          teamId: rec.teamId,
          recordId: rec.id,
          field: review.field,
          version,
          value: alternate.value,
          previousValue: current.value,
          kind: 'review_decided',
          changedBy: alternate.changedBy,
          approvedBy: decider,
          reviewId: review.id,
        });
        if (IDENTITY_FIELDS.includes(review.field)) {
          const [row] = await tx<{ id: string }[]>`
            insert into sineobex.patient_corrections
              (team_id, patient_id, kind, entity, record_id, field, old_value, new_value, reason, history_id,
               decided_by, decided_at)
            values (${rec.teamId}, ${rec.id}, 'review_decision', 'patient', ${rec.id}, ${review.field},
                    ${jsonb(tx, current.value)}, ${jsonb(tx, alternate.value)}, ${input.comment!}, ${historyId}::bigint,
                    ${decider}, ${now})
            returning id`;
          correctionId = row!.id;
        }
        await rematchAfter(tx, audit, rec, review.field);
      }
    }

    await tx`
      update sineobex.field_reviews
      set status = 'decided', decided_at = ${now}, decided_by = ${decider},
          decision = ${jsonb(tx, { kept: input.keep, historyId: input.historyId ?? null })},
          comment = ${input.comment ?? null}
      where id = ${review.id}`;
    await audit({
      action: 'field_review.decided',
      entity: 'patient',
      entityId: rec.id,
      patientId: groupIdOf(rec),
      details: {
        reviewId: review.id,
        field: review.field,
        kept: input.keep,
        historyId: input.historyId ?? null,
        version,
        ...(correctionId ? { correctionId } : {}),
        ...(input.comment ? { commentSha256: await sha256Hex(input.comment) } : {}),
      },
    });
    const [view] = await reviewViews(tx, [{ ...review, status: 'decided' }]);
    return view!;
  });
}
