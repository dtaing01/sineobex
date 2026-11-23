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
  /**
   * The copy is the team's own edit (the row's `customized`), which the update has left as it is. A
   * copy nobody edited is offered an update only when it changes a field fixed at creation (5.2).
   */
  customized: boolean;
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
 * A version the take sends back: the one a refused take sent, else the page's. The page is read
 * again after every answer, so a take refused for its reason, or for anything but stale, would
 * otherwise send the copy and the offer as they are now, and take what nobody reviewed without
 * being refused stale (5.1). Refused stale, the action sends neither back, so the form follows
 * the page and its review (8.1).
 */
function SentVersion({ name, version }: { name: 'baseVersion' | 'platformVersion'; version: number }) {
  const sent = useFormState().values?.[name];
  return <input type="hidden" name={name} value={sent ?? String(version)} />;
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
        {/* Drawn with no offer only to say why a take was refused: the offer went meanwhile. */}
        {offer ? 'Update available' : 'Sineobex’s update'}
        <span className="sr-only"> for {name}</span>
      </Heading>
      <ActionForm id={`take-${id}`} action={take} label={`Take Sineobex’s update to ${name}`}>
        {offer ? (
          <>
            {/* 8.1's words, of a copy the team edited; a copy nobody edited has no edit to keep. */}
            <p>
              {offer.customized
                ? 'Sineobex updated this preset. Your edited copy hasn’t changed.'
                : 'Sineobex updated this preset.'}
            </p>
            {offer.asNew && <p>{PRESET_SENTENCES.updateChangesFixed}</p>}
            <Review>{review}</Review>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            {/* The version shown and the version offered, as the review was opened. */}
            <SentVersion name="baseVersion" version={version} />
            <SentVersion name="platformVersion" version={offer.platformVersion} />
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
