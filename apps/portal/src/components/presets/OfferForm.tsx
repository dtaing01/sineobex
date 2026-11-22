'use client';

import { useState, type ReactNode } from 'react';
import { takePresetUpdateAction } from '@/app/actions/presets';
import { ActionForm, SubmitButton, useFormState } from '@/components/ActionForm';
import type { ActionState } from '@/lib/forms';
import { PRESET_SENTENCES } from '@/lib/refusals';
import { ReasonBox } from './ReasonBox';
import styles from './presets.module.css';

/** The update on offer, as the list row gave it: the version to send back, and how it is taken. */
export interface Offer {
  platformVersion: number;
  /** It changes a field fixed at creation, so it is added as a new preset (5.1). */
  asNew: boolean;
}

/**
 * Review: the update's body beside the copy's. A take refused stale reloads the page, and the review
 * opens on what is on offer now, so the person sees it before they take it (8.1).
 */
function Review({ children }: { children: ReactNode }) {
  const state = useFormState();
  // The person's own toggle holds until the form's next answer; a refusal then opens the review.
  const [toggled, setToggled] = useState<{ open: boolean; at: ActionState } | null>(null);
  const open =
    toggled && toggled.at === state ? toggled.open : state.error !== undefined || (toggled?.open ?? false);
  return (
    <details
      className={styles.reviewDetails}
      open={open}
      onToggle={(e) => setToggled({ open: e.currentTarget.open, at: state })}
    >
      <summary>Review</summary>
      {children}
    </details>
  );
}

/**
 * The update offer's form (phase 5 design 5.1, 8.1). It sends back the version shown and the
 * platform version it offered, so only what was reviewed is taken. A take that is done sends the
 * browser back to the page, which says so (PresetNotice), and the offer has gone. A refused one
 * stays to say why, though the offer has gone by the time the page is read again (another admin
 * took it).
 */
export function OfferForm({
  kind,
  id,
  name,
  version,
  offer,
  review,
  back,
  headingLevel,
}: {
  kind: string;
  id: string;
  name: string;
  version: number;
  offer: Offer | null;
  review: ReactNode;
  back?: string;
  headingLevel: 2 | 3;
}) {
  const [refused, setRefused] = useState(false);
  if (!offer && !refused) return null;
  const take = async (state: ActionState, form: FormData) => {
    const next = await takePresetUpdateAction(state, form);
    setRefused(next.error !== undefined);
    return next;
  };
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const headingClass = headingLevel === 2 ? 'px-h2' : 'px-h3';
  return (
    <section aria-labelledby={`offer-${id}`} className="px-panel">
      <Heading id={`offer-${id}`} className={headingClass}>
        Update available<span className="sr-only"> for {name}</span>
      </Heading>
      <ActionForm id={`take-${id}`} action={take} label={`Take Sineobex’s update to ${name}`}>
        {offer ? (
          <>
            <p>Sineobex updated this preset. Your edited copy hasn’t changed.</p>
            {offer.asNew && <p>{PRESET_SENTENCES.updateChangesFixed}</p>}
            <Review>{review}</Review>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            {/* The version shown and the version offered, from the page as it was read last. */}
            <input type="hidden" name="baseVersion" value={version} />
            <input type="hidden" name="platformVersion" value={offer.platformVersion} />
            <input type="hidden" name="asNew" value={offer.asNew ? 'true' : 'false'} />
            {back && <input type="hidden" name="back" value={back} />}
            <ReasonBox />
            <div className="px-actions">
              <SubmitButton>{offer.asNew ? 'Add as new' : 'Replace with the new version'}</SubmitButton>
            </div>
          </>
        ) : (
          <p>Nothing is on offer for this now.</p>
        )}
      </ActionForm>
    </section>
  );
}
