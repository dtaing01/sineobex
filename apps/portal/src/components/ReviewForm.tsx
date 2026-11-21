import type { Schemas } from '@sineobex/contract';
import { fieldValueText } from '@/app/(app)/patients/format';
import { decideReview } from '@/app/actions/reviews';
import { ActionForm, ChoiceField, SubmitButton, TextField } from '@/components/ActionForm';
import { formatDateTime, syncFieldLabel } from '@/lib/labels';

const quoted = (text: string) => `“${text}”`;

/**
 * One field review's decision (design 3.2, 12.2): the chart's value or one recorded alongside it,
 * as radios with nothing chosen, and a comment (required for a legal name or birth date).
 */
export function ReviewForm({
  review,
  today,
  back,
  name,
}: {
  review: Schemas['FieldReviewView'];
  today: string;
  /** The page the decision returns to: the queue, or the chart. */
  back: string;
  /** Tells this form apart from the others on the page: "1. Usually found". */
  name: string;
}) {
  const identity = review.needs === 'patients.correct_identity';
  const label = syncFieldLabel(review.field);
  return (
    <ActionForm id={`review-${review.id}`} action={decideReview} label={`Decide: ${name}`}>
      <input type="hidden" name="reviewId" value={review.id} />
      {/* The version this page showed: a change since then is refused, never overwritten. */}
      <input type="hidden" name="baseVersion" value={review.current.version} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="identity" value={identity ? '1' : ''} />
      <ChoiceField
        name="keep"
        legend={`Which ${label.toLowerCase()} should the chart keep?`}
        options={[
          {
            value: 'current',
            label: `Keep the chart’s value: ${quoted(fieldValueText(review.field, review.current.value, today))}`,
            ...(review.current.changedAt
              ? { hint: `On the chart since ${formatDateTime(review.current.changedAt)}` }
              : {}),
          },
          ...review.alternates.map((a) => ({
            value: `alternate:${a.historyId}`,
            label: `Use ${quoted(fieldValueText(review.field, a.value, today))}`,
            hint: `Recorded by ${a.by.displayName}${a.deviceTime ? `, ${formatDateTime(a.deviceTime)}` : ''}`,
          })),
        ]}
      />
      <TextField
        name="comment"
        label="Comment"
        hint={
          identity
            ? 'Required for a legal name or birth date. Logged with your decision.'
            : 'Logged with your decision.'
        }
        required={identity}
        autoComplete="off"
        maxLength={500}
      />
      <div className="px-actions">
        <SubmitButton>Record decision</SubmitButton>
      </div>
    </ActionForm>
  );
}
