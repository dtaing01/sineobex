'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { formatDayOf } from '@/app/(app)/patients/format';
import styles from '@/app/(app)/patients/patients.module.css';
import { issueIdCard, showIdLinks, type IssueState, type ShownLink } from '@/app/actions/patients';
import { ActionForm, ChoiceField, useFormState } from '@/components/ActionForm';
import { ID_LINK_REASON } from '@/lib/labels';

/** An active card as the panel lists it. Its link isn't here: Show link asks for it, and that read is logged. */
export interface CardView {
  id: string;
  effectiveAt: string;
  madeOffline: boolean;
  /** Issued on a record that was merged into this chart (design D39). */
  fromMergedRecord: boolean;
}

interface StepState extends IssueState {
  /** The reason is chosen: the form asks the person to confirm which cards stop working. */
  confirm?: boolean;
}

// Every reason but "First card", which only a first card has (design 10.4).
const REASONS = (['lost', 'damaged', 'stolen', 'patient_request', 'other'] as const).map((value) => ({
  value,
  label: ID_LINK_REASON[value],
}));

function StepButton({
  step,
  variant = 'primary',
  children,
}: {
  step: 'choose' | 'confirm' | 'back';
  variant?: 'primary' | 'secondary';
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="step"
      value={step}
      className={`sx-btn sx-btn--${variant}`}
      disabled={pending}
      aria-disabled={pending}
    >
      {pending && step === 'confirm' ? 'Working…' : children}
    </button>
  );
}

function stopsWorking(cards: CardView[]): string {
  if (cards.length === 1)
    return `The card made on ${formatDayOf(cards[0]!.effectiveAt)} stops working: scanning it will no longer open this chart.`;
  const dates = cards.map((c) => formatDayOf(c.effectiveAt)).join(' and ');
  return `All ${cards.length} cards (made ${dates}) stop working: scanning them will no longer open this chart.`;
}

/** The steps inside the form: a reason, then a confirmation that says which cards stop working. */
function NewCardSteps({
  cards,
  declined,
  onCancel,
}: {
  cards: CardView[];
  declined: boolean;
  onCancel: () => void;
}) {
  const state = useFormState() as StepState;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.confirm) heading.current?.focus();
  }, [state]);
  const cancel = (
    <button type="button" className="sx-btn sx-btn--secondary" onClick={onCancel}>
      Cancel
    </button>
  );
  if (cards.length === 0) {
    return (
      <>
        <input type="hidden" name="reason" value="first_card" />
        <p>
          {declined
            ? 'They declined a card. Make one anyway?'
            : 'The card works as soon as it’s made. You can copy its link to print it right after.'}
        </p>
        <div className="px-actions">
          <StepButton step="confirm">Make the card</StepButton>
          {cancel}
        </div>
      </>
    );
  }
  if (state.confirm) {
    return (
      <>
        <input type="hidden" name="reason" value={state.values?.reason ?? ''} />
        <h4 ref={heading} tabIndex={-1} className="px-h3">
          Check before making the card
        </h4>
        <p>{stopsWorking(cards)} The new card works as soon as it’s made.</p>
        <div className="px-actions">
          <StepButton step="confirm">Make the new card</StepButton>
          <StepButton step="back" variant="secondary">
            Go back
          </StepButton>
        </div>
      </>
    );
  }
  return (
    <>
      <ChoiceField name="reason" legend="Why is a new card needed?" options={REASONS} />
      <div className="px-actions">
        <StepButton step="choose">Continue</StepButton>
        {cancel}
      </div>
    </>
  );
}

/**
 * The ID card panel (design 10.3, 10.4, 12.2): every active card of the chart (two after a merge,
 * until the next new card). With patients.edit, Show link reads the links through the logged
 * route; Copy puts one on the clipboard; Make a new card, with a reason and a confirmation, stops
 * every active card. Links live only in this component's memory: never in a form's state (which
 * React would send back to the server), the address or browser storage.
 */
export function IdCardPanel({
  patientId,
  cards,
  canEdit,
  declined,
  linkId,
}: {
  /** The chart's canonical record: cards are made there. */
  patientId: string;
  /** Newest first. */
  cards: CardView[];
  canEdit: boolean;
  /** The patient declined a card when asked. */
  declined: boolean;
  /** Made for this page load, so a repeated submit issues nothing twice. */
  linkId: string;
}) {
  const [links, setLinks] = useState<ShownLink[]>([]);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [making, setMaking] = useState(false);
  const [showing, startShowing] = useTransition();
  const linksHeading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const makeButton = useRef<HTMLButtonElement>(null);
  const focusLinks = useRef(false);
  // Links of cards that are no longer active (another card was made) drop out on the next read.
  const visible = links.filter((l) => cards.some((c) => c.id === l.id));
  const shownIds = visible.map((l) => l.id).join();

  // A new card's link can arrive a moment before the re-read list of cards that includes it.
  useEffect(() => {
    if (focusLinks.current && shownIds) {
      focusLinks.current = false;
      linksHeading.current?.focus();
    }
  }, [shownIds]);
  useEffect(() => {
    if (making) formHeading.current?.focus();
  }, [making]);

  function show() {
    startShowing(async () => {
      const result = await showIdLinks(patientId);
      setProblem(result.error ?? '');
      if (result.links) {
        focusLinks.current = true;
        setLinks(result.links);
      }
    });
  }

  async function copy(link: ShownLink) {
    const made = formatDayOf(link.effectiveAt);
    try {
      await navigator.clipboard.writeText(link.url);
      setNotice(`Link copied for the card made ${made}.`);
    } catch {
      setNotice('Couldn’t copy the link. Select it and copy it with the keyboard.');
    }
  }

  function cancel() {
    setMaking(false);
    makeButton.current?.focus();
  }

  // Runs in the browser and sends the server only the form, never the panel's links.
  async function issue(_: StepState, form: FormData): Promise<StepState> {
    const step = form.get('step');
    const values = { reason: String(form.get('reason') ?? '') };
    if (step === 'back') return { values };
    if (step === 'choose') {
      if (!values.reason)
        return {
          error: 'Choose why a new card is needed.',
          fieldErrors: { reason: 'Choose a reason.' },
          values,
        };
      return { values, confirm: true };
    }
    const result = await issueIdCard(form);
    if (!result.state.ok) return { ...result.state, values };
    focusLinks.current = true;
    setLinks(result.links ?? []);
    setNotice(result.state.message ?? '');
    setMaking(false);
    return {};
  }

  return (
    <div className="px-form">
      {cards.length === 0 ? (
        <p>No card yet.{declined ? ' They declined a card when asked.' : ''}</p>
      ) : cards.length === 1 ? (
        <p>
          Active since {formatDayOf(cards[0]!.effectiveAt)}
          {cards[0]!.madeOffline ? ', made on a phone' : ''}.
        </p>
      ) : (
        <>
          <p>
            {cards.length} cards open this chart, because records were merged. Each keeps working until a new
            card is made.
          </p>
          <ul className="px-list">
            {cards.map((c) => (
              <li key={c.id}>
                Card made {formatDayOf(c.effectiveAt)}
                {c.fromMergedRecord ? ', for a record merged into this chart' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      <p role="status">{notice}</p>
      {problem && (
        <p role="alert" className="px-alert px-alert--error">
          {problem}
        </p>
      )}
      {visible.length > 0 && (
        <section aria-labelledby={`${patientId}-links`} className="px-form">
          <h3 id={`${patientId}-links`} ref={linksHeading} tabIndex={-1} className="px-h3">
            {visible.length === 1 ? 'Card link' : 'Card links'}
          </h3>
          <ul className="px-list">
            {visible.map((l) => (
              <li key={l.id} className="px-form">
                <span>Card made {formatDayOf(l.effectiveAt)}</span>
                <code className={`px-value ${styles.link}`}>{l.url}</code>
                <span>
                  <button type="button" className="sx-btn sx-btn--secondary" onClick={() => copy(l)}>
                    Copy link<span className="sr-only"> for the card made {formatDayOf(l.effectiveAt)}</span>
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="sx-help">
            Print only the code and your team’s contact line. Don’t print the person’s name, birth date or
            health details on the card.
          </p>
        </section>
      )}
      {canEdit && !making && (
        <div className="px-actions">
          {cards.length > 0 && visible.length < cards.length && (
            <button
              type="button"
              className="sx-btn sx-btn--secondary"
              onClick={show}
              disabled={showing}
              aria-disabled={showing}
            >
              {showing ? 'Working…' : cards.length === 1 ? 'Show link' : 'Show links'}
            </button>
          )}
          <button
            ref={makeButton}
            type="button"
            className="sx-btn sx-btn--secondary"
            onClick={() => setMaking(true)}
          >
            {cards.length === 0 ? 'Make a card' : 'Make a new card'}
          </button>
        </div>
      )}
      {canEdit && making && (
        <ActionForm
          id="new-card"
          action={issue}
          label={cards.length === 0 ? 'Make a card' : 'Make a new card'}
        >
          <h3 ref={formHeading} tabIndex={-1} className="px-h3">
            {cards.length === 0 ? 'Make a card' : 'Make a new card'}
          </h3>
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="linkId" value={linkId} />
          {/* The newest card this page showed: if another was made since, the API refuses. */}
          <input type="hidden" name="replacesLinkId" value={cards[0]?.id ?? ''} />
          <NewCardSteps cards={cards} declined={declined} onCancel={cancel} />
        </ActionForm>
      )}
    </div>
  );
}
