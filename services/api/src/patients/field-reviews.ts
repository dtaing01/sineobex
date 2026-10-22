import type { TeamScope } from '../auth/context.ts';
import { notImplemented } from './pending.ts';
import type {
  DecideFieldReviewInput,
  FieldReviewPageValue,
  FieldReviewQueryValue,
  FieldReviewViewValue,
} from './schemas.ts';

/**
 * GET /v1/team/field-reviews (phase 3 design 3.2): reviews the caller may decide (their `needs`
 * is a permission the caller holds). Audited as `field_review.viewed {count}` and
 * `patient.viewed {source: 'field_review'}` per patient on the page.
 */
export async function listFieldReviews(
  _scope: TeamScope,
  _query: FieldReviewQueryValue,
): Promise<FieldReviewPageValue> {
  throw notImplemented();
}

/**
 * POST /v1/team/field-reviews/{reviewId}/decision: needs the review's `needs`, and a recent sign-in
 * when that is patients.correct_identity (scope.requireRecentAuth()). Keeping an alternate writes it
 * after the recognisability check (409 nothing_to_recognise); a stale baseVersion is 409
 * field_changed. Audited as `field_review.decided {reviewId, kept, historyId, version}`.
 */
export async function decideFieldReview(
  _scope: TeamScope,
  _reviewId: string,
  _input: DecideFieldReviewInput,
): Promise<FieldReviewViewValue> {
  throw notImplemented();
}
