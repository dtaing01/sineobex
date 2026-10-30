'use server';

import type { Schemas } from '@sineobex/contract';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { formValues, type ActionState } from '@/lib/forms';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_ERROR = 'Give a reason of at least 3 characters.';

function failure(err: unknown, values: Record<string, string>, field: string): ActionState {
  if (!(err instanceof PortalApiError)) throw err;
  // The list isn't reloaded on a refusal: the form, and the API's message, stay where they are.
  const fieldErrors: Record<string, string> = {};
  for (const f of (err.details?.fields ?? []) as { path: string }[]) {
    if (f.path.endsWith('reason') || f.path.endsWith('comment')) fieldErrors[field] = REASON_ERROR;
  }
  return { error: err.message, ...(Object.keys(fieldErrors).length ? { fieldErrors } : {}), values };
}

/** After Reverse: the original, now Ongoing, and the entries the admin may merge into it. */
export type ReversalState = ActionState & { reversed?: Schemas['ReverseResolvedResult'] };

/**
 * Reverse or decline a "Resolved by mistake" request, with a reason (design 9.4). Reverse sets the
 * original back to Ongoing and returns the merge offer, which the page shows in place: the list is
 * not reloaded, or the request (now answered) would leave the page with its offer. Decline leaves
 * the new entry a separate problem.
 */
export async function decideReversal(_: ActionState, form: FormData): Promise<ReversalState> {
  const values = formValues(form, 'requestId', 'originalId', 'decision', 'reason');
  const decision = values.decision;
  const reason = (values.reason ?? '').trim();
  const errors: Record<string, string> = {};
  // Never assumed: reversing rewrites a problem's status for everyone.
  if (decision !== 'reverse' && decision !== 'decline') errors.decision = 'Choose Reverse or Decline.';
  if (reason.length < 3) errors.reason = REASON_ERROR;
  if (Object.keys(errors).length > 0) return { error: 'Check your decision.', fieldErrors: errors, values };
  const requestId = values.requestId ?? '';
  const originalId = values.originalId ?? '';
  if (!UUID.test(requestId) || !UUID.test(originalId)) {
    return { error: 'This request can’t be found. Reload the page.', values };
  }
  const client = await api();
  if (decision === 'reverse') {
    try {
      const reversed = await unwrap(
        client.POST('/v1/problems/{problemId}/reverse', {
          params: { path: { problemId: originalId } },
          body: { reason, requestProblemId: requestId },
        }),
      );
      return { ok: true, reversed };
    } catch (err) {
      return failure(err, values, 'reason');
    }
  }
  try {
    await unwrap(
      client.POST('/v1/team/problem-reversals/{problemId}/decline', {
        params: { path: { problemId: requestId } },
        body: { reason },
      }),
    );
  } catch (err) {
    return failure(err, values, 'reason');
  }
  revalidatePath('/team/problem-reversals');
  redirect('/team/problem-reversals?done=declined');
}

/**
 * Merge an entry into the problem it stands in for, with a comment (design 9.4 step 3): its history
 * and notes show in the original's timeline and it leaves every list. There is no undo yet.
 */
export async function mergeProblemEntries(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'problemId', 'intoProblemId', 'comment');
  const comment = (values.comment ?? '').trim();
  const errors: Record<string, string> = {};
  if (!UUID.test(values.problemId ?? '')) errors.problemId = 'Choose the entry to merge.';
  if (comment.length < 3) errors.comment = REASON_ERROR;
  if (Object.keys(errors).length > 0) return { error: 'Check the merge.', fieldErrors: errors, values };
  if (!UUID.test(values.intoProblemId ?? ''))
    return { error: 'This problem can’t be found. Reload the page.', values };
  try {
    await unwrap(
      (await api()).POST('/v1/problems/{problemId}/merge', {
        params: { path: { problemId: values.problemId! } },
        body: { intoProblemId: values.intoProblemId!, comment },
      }),
    );
  } catch (err) {
    return failure(err, values, 'comment');
  }
  revalidatePath('/team/problem-reversals');
  redirect('/team/problem-reversals?done=merged');
}
