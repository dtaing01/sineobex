'use client';

import { useState, type ReactNode } from 'react';
import { takeNoteTypeUpdateAction } from '@/app/actions/presets-note-types';
import { ActionForm, SubmitButton, useFormState } from '@/components/ActionForm';
import { REMOVED_OFFER } from '@/components/presets/OfferForm';
import { ReasonBox } from '@/components/presets/ReasonBox';
import styles from '@/components/presets/presets.module.css';
import type { ActionState } from '@/lib/forms';
import { PRESET_SENTENCES } from '@/lib/refusals';
import { FieldSuppliesLink } from './FieldSuppliesLink';

/** The update on offer, as the list row gave it: the version to send back, and how it is taken. */
export interface NoteTypeOfferProps {
  noteType: { key: string; title: string; version: number; customized: boolean; removed: boolean };
  offer: { platformVersion: number; changesFixed: boolean } | null;
  /** The note type now beside Sineobex's new version (ReviewTable). */
  review: ReactNode;
  /**
   * 2 on a note type's own page, where the offer follows its h1; 3 in the list and the Removed list,
   * under the note type's h2, as a preset's offer is placed (UpdateOffer).
   */
  headingLevel?: 2 | 3;
}

/**
 * Review: the update's definition beside the note type's. A take refused stale reads the list again,
 * and the review opens on what is on offer now, so the person sees it before they take it (8.1), as
 * a preset's offer does (components/presets/OfferForm.tsx).
 */
function Review({ title, children }: { title: string; children: ReactNode }) {
  const state = useFormState();
  const [toggled, setToggled] = useState<{ open: boolean; at: ActionState } | null>(null);
  const open =
    toggled && toggled.at === state ? toggled.open : state.error !== undefined || (toggled?.open ?? false);
  return (
    <details
      className={styles.reviewDetails}
      open={open}
      onToggle={(e) => setToggled({ open: e.currentTarget.open, at: state })}
    >
      <summary>
        Review<span className="sr-only"> Sineobex’s update to {title}</span>
      </summary>
      {children}
    </details>
  );
}

/**
 * What the take sends back of what was reviewed, a version or the note type's state: what a refused
 * take sent, else the list's (OfferForm's reason).
 */
function Sent({ name, value }: { name: 'baseVersion' | 'platformVersion' | 'baseState'; value: string }) {
  const sent = useFormState().values?.[name];
  return <input type="hidden" name={name} value={sent ?? value} />;
}

/**
 * The update offer of 8.1 for one note type, a removed one's too: "Sineobex updated this preset.
 * Your edited copy hasn’t changed." (the second sentence only of a note type the team edited), with
 * Review and Replace with the new version; or, for an update that changes what is fixed at creation
 * (kinds, group, sensitivity, quick or auto), Add as new with its sentence. A removed note type is
 * offered its update as a new one only, as a removed preset is. A take sends back the version shown,
 * the platform version reviewed and the state it was shown in, so only what was reviewed is taken
 * (5.1): a Remove or a Restore meanwhile keeps the version.
 *
 * Placed for every note type the page shows: it draws nothing while nothing is on offer, and a take
 * refused stays to say why, though the offer has gone by the time the list is read again.
 */
export function NoteTypeOffer({ noteType, offer, review, headingLevel = 3 }: NoteTypeOfferProps) {
  const [refused, setRefused] = useState(false);
  if (!offer && !refused) return null;
  const { key, title } = noteType;
  const asNew = noteType.removed || (offer?.changesFixed ?? false);
  const take = async (state: ActionState, form: FormData) => {
    const next = await takeNoteTypeUpdateAction(state, form);
    setRefused(next.error !== undefined);
    return next;
  };
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  // At level 3 the offer sits in its note type's own panel, which leaves a review too little width
  // at 320 px inside a second one, so it is drawn unboxed there (OfferForm's reason).
  return (
    <section aria-labelledby={`offer-${key}`} className={headingLevel === 2 ? 'px-panel' : styles.flat}>
      <Heading id={`offer-${key}`} className={headingLevel === 2 ? 'px-h2' : 'px-h3'}>
        {offer ? 'Update available' : 'Sineobex’s update'}
        <span className="sr-only"> for {title}</span>
      </Heading>
      <ActionForm id={`take-${key}`} action={take} label={`Take Sineobex’s update to ${title}`}>
        <FieldSuppliesLink />
        {offer ? (
          <>
            <p>
              {noteType.customized && !noteType.removed
                ? 'Sineobex updated this preset. Your edited copy hasn’t changed.'
                : 'Sineobex updated this preset.'}
            </p>
            {noteType.removed ? (
              <p>{REMOVED_OFFER}</p>
            ) : (
              asNew && <p>{PRESET_SENTENCES.updateChangesFixed}</p>
            )}
            <Review title={title}>{review}</Review>
            <input type="hidden" name="key" value={key} />
            <Sent name="baseVersion" value={String(noteType.version)} />
            <Sent name="platformVersion" value={String(offer.platformVersion)} />
            <Sent name="baseState" value={noteType.removed ? 'archived' : 'active'} />
            <input type="hidden" name="asNew" value={asNew ? 'true' : 'false'} />
            <ReasonBox />
            <div className="px-actions">
              <SubmitButton>
                {asNew ? (
                  <>
                    Add as new<span className="sr-only"> from Sineobex’s update to {title}</span>
                  </>
                ) : (
                  <>
                    Replace with the new version<span className="sr-only"> of {title}</span>
                  </>
                )}
              </SubmitButton>
            </div>
          </>
        ) : (
          <p>Nothing is on offer for this now.</p>
        )}
      </ActionForm>
    </section>
  );
}
