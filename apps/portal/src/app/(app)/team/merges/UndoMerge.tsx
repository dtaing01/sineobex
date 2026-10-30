'use client';

import type { Schemas } from '@sineobex/contract';
import { useEffect, useRef, useState } from 'react';
import { undoMerge } from '@/app/actions/duplicates';
import { ActionForm, SubmitButton, TextField } from '@/components/ActionForm';
import type { ActionState } from '@/lib/forms';
import { formatDateTime, ID_LINK_REASON, syncFieldLabel } from '@/lib/labels';

type Undone = Schemas['UndoMergeResult'];

/** The two records of a merge, named for the confirmation and the result. */
export interface MergeNames {
  survivorId: string;
  survivor: string;
  mergedId: string;
  merged: string;
}

/**
 * Undo, behind a confirmation with a required comment (design 8.5, 12.2). Only shown when the API
 * says this person may undo it (patients.correct_identity, and nothing merged on top); the API
 * checks again and asks for a recent sign-in. The result stays here after the list reloads.
 */
export function UndoMerge({
  mergeId,
  names,
  undoable,
  describedBy,
}: {
  mergeId: string;
  names: MergeNames;
  undoable: boolean;
  /** The merge's heading, so each Undo button says which merge it undoes. */
  describedBy: string;
}) {
  const [open, setOpen] = useState(false);
  const [undone, setUndone] = useState<Undone | null>(null);
  if (undone) return <UndoResult undone={undone} names={names} />;
  if (!undoable) return null;
  const undo = async (state: ActionState, form: FormData) => {
    const next = await undoMerge(state, form);
    if (next.undone) setUndone(next.undone);
    return next;
  };
  return (
    <div className="px-doc">
      <div className="px-actions">
        <button
          type="button"
          className="sx-btn sx-btn--secondary"
          aria-expanded={open}
          aria-describedby={describedBy}
          onClick={() => setOpen(!open)}
        >
          Undo this merge
        </button>
      </div>
      {open && (
        <ActionForm id={`undo-${mergeId}`} action={undo} label={`Undo the merge of ${names.merged}`}>
          <h3 className="px-h3">Undo this merge?</h3>
          <p>
            {names.merged} gets back its own details, street names, allergies, problems and ID cards, as they
            stood when the merge was made. Changes made on the kept chart since then stay on it; the result
            lists any you need to move by hand.
          </p>
          <input type="hidden" name="mergeId" value={mergeId} />
          <TextField
            name="comment"
            label="Why are you undoing it?"
            hint="Logged with the undo"
            required
            autoComplete="off"
            maxLength={500}
          />
          <div className="px-actions">
            <SubmitButton variant="danger">Undo merge</SubmitButton>
            <button type="button" className="sx-btn sx-btn--secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

/** What went back, and what an admin must check by hand (UndoMergeResult). */
function UndoResult({ undone, names }: { undone: Undone; names: MergeNames }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const record = (patientId: string) =>
    patientId === names.mergedId
      ? names.merged
      : patientId === names.survivorId
        ? names.survivor
        : 'a record merged into it earlier';
  const fields = (xs: string[]) => xs.map(syncFieldLabel).join(', ');
  return (
    <section aria-labelledby={`undone-${undone.merge.id}`} className="px-alert px-alert--ok">
      <h3 id={`undone-${undone.merge.id}`} ref={heading} tabIndex={-1} className="px-h3">
        Merge undone
      </h3>
      <p>{names.merged} is a chart of its own again, and the pair is back in the duplicates queue.</p>
      <ul className="px-list">
        <li>
          {undone.revertedFields.length > 0
            ? `Put back on ${names.survivor} as before the merge: ${fields(undone.revertedFields)}.`
            : `Nothing on ${names.survivor} needed putting back.`}
        </li>
        {undone.keptFields.length > 0 && (
          <li>
            Kept on {names.survivor}, because they changed since or are needed to recognise the person:{' '}
            {fields(undone.keptFields)}.
          </li>
        )}
        {undone.reviewsClosed > 0 && (
          <li>
            {undone.reviewsClosed} {undone.reviewsClosed === 1 ? 'review' : 'reviews'} the merge opened{' '}
            {undone.reviewsClosed === 1 ? 'was' : 'were'} closed.
          </li>
        )}
        {undone.restoredLinks.map((l) => (
          <li key={l.linkId}>
            ID card <code>{l.tokenRef}</code> works again for {record(l.issuedOn)}.
          </li>
        ))}
        {/* PLAN-OPEN: cards at undo (design 14.1, #16): a card made while merged stays with the
            survivor, and the admin checks who carries it. */}
        {undone.linksIssuedWhileMerged.map((l) => (
          <li key={l.linkId}>
            ID card <code>{l.tokenRef}</code> was made while the charts were merged (
            {ID_LINK_REASON[l.reason]}, {formatDateTime(l.effectiveAt)}) and stays on {record(l.issuedOn)}.
            Check which person carries this card.
          </li>
        ))}
      </ul>
      {undone.redirectedEdits.length > 0 && (
        <>
          <p>
            These edits were sent to {names.merged} while it was merged, and went onto {names.survivor}. If
            they belong to {names.merged}, make them again on its chart:
          </p>
          <ul className="px-list">
            {undone.redirectedEdits.map((e) => (
              <li key={e.historyId}>
                {syncFieldLabel(e.field)}, {formatDateTime(e.at)} by {e.by.displayName}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
