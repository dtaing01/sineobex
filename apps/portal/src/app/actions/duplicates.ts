'use server';

import type { Schemas } from '@sineobex/contract';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { formValues, type ActionState } from '@/lib/forms';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = ['merge', 'keep_separate', 'not_sure'] as const;
type Decision = (typeof DECISIONS)[number];

const COMMENT_ERROR = 'Write a comment of at least 3 characters.';

/** API field problems as the form's field errors; the rest is the API's own message. */
function fieldErrors(err: PortalApiError, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of (err.details?.fields ?? []) as { path: string }[]) {
    const name = names.find((n) => f.path === n || f.path.endsWith(`.${n}`));
    if (name === 'comment' || name === 'reason') out[name] = COMMENT_ERROR;
    else if (name === 'fieldNote') out.fieldNote = 'Write 3 to 200 characters, or leave the note blank.';
    else if (name) out[name] = 'Check this answer.';
  }
  return out;
}

/**
 * Merge, keep separate or not sure, with a comment, for the versions the reviewer saw (design 8.4).
 * A merge asks once more before it is sent: the first submit only checks the form and returns
 * `step: 'confirm'`, so the page can list what the merge will do.
 */
export async function decidePair(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(
    form,
    'pairId',
    'versionA',
    'versionB',
    'decision',
    'survivorId',
    'comment',
    'fieldNote',
  );
  const pairId = values.pairId ?? '';
  const decision = values.decision as Decision | undefined;
  const comment = (values.comment ?? '').trim();
  const fieldNote = (values.fieldNote ?? '').trim();
  const errors: Record<string, string> = {};
  // Never assumed: nothing is preselected, and a merge changes two charts.
  if (!decision || !DECISIONS.includes(decision))
    errors.decision = 'Choose Merge, Keep separate or Not sure.';
  if (decision === 'merge' && !UUID.test(values.survivorId ?? ''))
    errors.survivorId = 'Choose which chart is kept.';
  if (comment.length < 3) errors.comment = COMMENT_ERROR;
  if (decision === 'not_sure' && fieldNote && fieldNote.length < 3)
    errors.fieldNote = 'Write at least 3 characters, or leave the note blank.';
  if (!UUID.test(pairId)) return { error: 'This pair can’t be found. Go back to the queue.', values };
  if (Object.keys(errors).length > 0) {
    return { error: 'Check your decision.', fieldErrors: errors, values };
  }
  if (decision === 'merge' && form.get('confirmed') !== 'yes')
    return { values: { ...values, step: 'confirm' } };

  try {
    await unwrap(
      (await api()).POST('/v1/team/duplicates/{pairId}/decision', {
        params: { path: { pairId } },
        body: {
          decision: decision!,
          comment,
          versions: { a: Number(values.versionA), b: Number(values.versionB) },
          ...(decision === 'merge' ? { survivorId: values.survivorId } : {}),
          ...(decision === 'not_sure' && fieldNote ? { fieldNote } : {}),
        },
      }),
    );
  } catch (err) {
    if (!(err instanceof PortalApiError)) throw err;
    switch (err.code) {
      // The pair page re-reads the pair, so the next try carries the versions now stored.
      case 'pair_changed':
        revalidatePath(`/team/duplicates/${pairId}`);
        return {
          error: 'One of these records changed since you opened the pair. Check both again, then decide.',
          values,
        };
      case 'already_decided':
        revalidatePath(`/team/duplicates/${pairId}`);
        return { error: 'Someone already decided this pair. Their decision is listed below.', values };
      case 'survivor_not_in_pair':
        return {
          error: 'Check your decision.',
          fieldErrors: { survivorId: 'Choose one of the two records to keep.' },
          values,
        };
      case 'same_patient':
        revalidatePath(`/team/duplicates/${pairId}`);
        return { error: 'These two records are already one chart.', values };
    }
    const fields = fieldErrors(err, ['comment', 'fieldNote', 'survivorId']);
    return { error: err.message, ...(Object.keys(fields).length ? { fieldErrors: fields } : {}), values };
  }
  revalidatePath('/team/duplicates');
  // The queue confirms and offers the next pair; the decided pair's ID only says which to skip.
  redirect(`/team/duplicates?${new URLSearchParams({ decided: decision!, pair: pairId })}`);
}

export type UndoState = ActionState & { undone?: Schemas['UndoMergeResult'] };

/**
 * Undo a merge with a comment (design 8.5): an identity correction, so patients.correct_identity
 * and a recent sign-in. The answer lists what went back and what an admin must check by hand.
 */
export async function undoMerge(_: ActionState, form: FormData): Promise<UndoState> {
  const values = formValues(form, 'mergeId', 'comment');
  const mergeId = values.mergeId ?? '';
  const comment = (values.comment ?? '').trim();
  if (!UUID.test(mergeId)) return { error: 'This merge can’t be found. Reload the page.', values };
  if (comment.length < 3) {
    return { error: 'Say why you are undoing the merge.', fieldErrors: { comment: COMMENT_ERROR }, values };
  }
  let undone: Schemas['UndoMergeResult'];
  try {
    undone = await unwrap(
      (await api()).POST('/v1/team/merges/{mergeId}/undo', {
        params: { path: { mergeId } },
        body: { comment },
      }),
    );
  } catch (err) {
    if (!(err instanceof PortalApiError)) throw err;
    switch (err.code) {
      case 'undo_later_merge_first':
        return {
          error:
            'A later merge includes the kept chart. Undo that merge first (it is higher in this list), then this one.',
          values,
        };
      case 'already_undone':
        revalidatePath('/team/merges');
        return { error: 'This merge was already undone.', values };
    }
    const fields = fieldErrors(err, ['comment']);
    return { error: err.message, ...(Object.keys(fields).length ? { fieldErrors: fields } : {}), values };
  }
  // The list re-renders with the merge marked undone; the form's result stays where it was.
  revalidatePath('/team/merges');
  revalidatePath('/team/duplicates');
  return { ok: true, undone };
}
