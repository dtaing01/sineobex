'use client';

import type { Schemas } from '@sineobex/contract';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { decideReversal, mergeProblemEntries } from '@/app/actions/problems';
import { ActionForm, ChoiceField, SubmitButton, TextField } from '@/components/ActionForm';
import type { ActionState } from '@/lib/forms';
import { formatDateTime, PROBLEM_STATUS } from '@/lib/labels';

type Reversed = Schemas['ReverseResolvedResult'];
type Problem = Schemas['ProblemView'];

/** "Cellulitis of left lower limb (L03.116), New, added Oct 16, 2026 by Jordan Lee" */
function describeProblem(p: Problem): string {
  return `${p.title}${p.code ? ` (${p.code})` : ''}, ${PROBLEM_STATUS[p.status]}, added ${formatDateTime(p.createdAt)} by ${p.author.displayName}`;
}

/**
 * Reverse or Decline, each with a reason (design 9.4). After Reverse, the same place offers to
 * merge the new entry into the original, which is Ongoing again.
 */
export function ReversalDecision({
  requestId,
  originalId,
  originalTitle,
  label,
}: {
  requestId: string;
  originalId: string;
  originalTitle: string;
  /** Names the request, so each form on the page has a name of its own. */
  label: string;
}) {
  const [reversed, setReversed] = useState<Reversed | null>(null);
  if (reversed) return <MergeOffer reversed={reversed} requestId={requestId} />;
  const decide = async (state: ActionState, form: FormData) => {
    const next = await decideReversal(state, form);
    if (next.reversed) setReversed(next.reversed);
    return next;
  };
  return (
    <ActionForm id={`reversal-${requestId}`} action={decide} label={`Decide on ${label}`}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="originalId" value={originalId} />
      <ChoiceField
        name="decision"
        legend="Decision"
        options={[
          {
            value: 'reverse',
            label: `Reverse: ${originalTitle} never went away`,
            hint: 'The original goes back to Ongoing. Its history keeps the Resolved entry, and the worker who asked is told.',
          },
          {
            value: 'decline',
            label: 'Decline: it was resolved',
            hint: 'The new entry stays a separate problem, and the worker who asked is told.',
          },
        ]}
      />
      <TextField
        name="reason"
        label="Reason"
        hint="Logged with your decision"
        required
        autoComplete="off"
        maxLength={500}
      />
      <div className="px-actions">
        <SubmitButton>Record decision</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** "Merge the new entry into the original?" (design 9.4 step 3), with focus on the outcome first. */
function MergeOffer({ reversed, requestId }: { reversed: Reversed; requestId: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const { problem, mergeCandidates } = reversed;
  const only = mergeCandidates.length === 1 ? mergeCandidates[0] : undefined;
  return (
    <div className="px-doc">
      <div className="px-alert px-alert--ok">
        <h3 id={`reversed-${requestId}`} ref={heading} tabIndex={-1} className="px-h3">
          Reversed: {problem.title} is Ongoing again
        </h3>
        <p>Its history keeps both entries, and the worker who asked is told.</p>
      </div>
      {mergeCandidates.length === 0 ? (
        <p>
          No other entry stands in for it, so there is nothing to merge.{' '}
          <Link href="/team/problem-reversals?done=reversed">Back to the list</Link>
        </p>
      ) : (
        <ActionForm
          id={`merge-${requestId}`}
          action={mergeProblemEntries}
          label="Merge the new entry into the original"
        >
          <h3 className="px-h3">Merge the new entry into the original?</h3>
          <p>
            The entry’s history and notes then show in the original’s timeline, and it leaves the problem list
            and the bag check. A problem merge can’t be undone yet.
          </p>
          <input type="hidden" name="intoProblemId" value={problem.id} />
          {only ? (
            <>
              <input type="hidden" name="problemId" value={only.id} />
              <p>Entry: {describeProblem(only)}</p>
            </>
          ) : (
            <ChoiceField
              name="problemId"
              legend="Which entry goes into the original?"
              options={mergeCandidates.map((c) => ({
                value: c.id,
                label: describeProblem(c),
                ...(c.resolvedInErrorOf === problem.id
                  ? { hint: 'The entry that asked for this reversal' }
                  : {}),
              }))}
            />
          )}
          <TextField
            name="comment"
            label="Comment"
            hint="Logged with the merge"
            required
            autoComplete="off"
            maxLength={500}
          />
          <div className="px-actions">
            <SubmitButton>Merge entries</SubmitButton>
            <Link href="/team/problem-reversals?done=reversed">Keep them separate</Link>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
