'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { formValues, type ActionState } from '@/lib/forms';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HISTORY_ID = /^\d{1,19}$/;

/** Where a decision returns to: the review queue, or the chart it was decided on. */
function backTo(back: string | undefined): string {
  const m = /^\/patients\/([^/]+)$/.exec(back ?? '');
  return m && UUID.test(m[1]!) ? back! : '/team/reviews';
}

/**
 * A field review decided (design 3.2): keep the chart's value, or one recorded alongside it. A
 * legal name or birth date needs a comment and, in the API, an admin's recent sign-in.
 */
export async function decideReview(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'reviewId', 'baseVersion', 'keep', 'comment', 'back', 'identity');
  const back = backTo(values.back);
  const keep = values.keep ?? '';
  const historyId = keep.startsWith('alternate:') ? keep.slice('alternate:'.length) : null;
  const comment = (values.comment ?? '').trim();
  const fieldErrors: Record<string, string> = {};
  // Never assumed: keeping the other value changes the chart.
  if (keep !== 'current' && !(historyId && HISTORY_ID.test(historyId)))
    fieldErrors.keep = 'Choose which value the chart keeps.';
  if (values.identity === '1' && comment.length < 3)
    fieldErrors.comment = 'Say why, in at least 3 characters: a legal name or birth date needs a comment.';
  else if (comment && comment.length < 3) fieldErrors.comment = 'A comment is at least 3 characters.';
  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Choose a value before recording the decision.', fieldErrors, values };
  }
  if (!UUID.test(values.reviewId ?? '')) return { error: 'Reload the page and try again.', values };
  try {
    await unwrap(
      (await api()).POST('/v1/team/field-reviews/{reviewId}/decision', {
        params: { path: { reviewId: values.reviewId! } },
        body: {
          keep: historyId ? 'alternate' : 'current',
          ...(historyId ? { historyId } : {}),
          ...(comment ? { comment } : {}),
          baseVersion: Number(values.baseVersion ?? 0),
        },
      }),
    );
  } catch (err) {
    if (!(err instanceof PortalApiError)) throw err;
    if (err.code === 'field_changed' || err.code === 'already_decided') {
      // The page shows the review as it is now (or not at all, once decided).
      revalidatePath(back);
      return {
        error:
          err.code === 'already_decided'
            ? 'Someone else already decided this review.'
            : 'This field changed since you opened the page. Check the values again, then decide.',
        values,
      };
    }
    const fields = (err.details?.fields ?? []) as { path: string }[];
    if (fields.some((f) => f.path === 'comment') || err.code === 'comment_required')
      return {
        error: err.message,
        fieldErrors: { comment: 'Give a comment of at least 3 characters.' },
        values,
      };
    return { error: err.message, values };
  }
  revalidatePath(back);
  redirect(`${back}?decided=${historyId ? 'alternate' : 'current'}`);
}
