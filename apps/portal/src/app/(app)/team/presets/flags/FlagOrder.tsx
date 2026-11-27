'use client';

import Link from 'next/link';
import { useEffect, useState, type MouseEvent } from 'react';
import { useFormStatus } from 'react-dom';
import { moveFlagAction } from '@/app/actions/presets-flags';
import { ActionForm, useFieldId, useFormState } from '@/components/ActionForm';
import { answerKey } from '@/components/presets/answer';
import { FlagPill } from '@/components/presets/FlagPill';
import { ReasonBox } from '@/components/presets/ReasonBox';
import styles from '@/components/presets/presets.module.css';
import type { ActionState } from '@/lib/forms';
import { movedSentence, parseMove, TIERS, type ListedFlag, type Tier } from './flags';

/** A flag as its list shows it: its pill, which opens its page, and what else is true of it. */
function FlagEntry({ flag }: { flag: ListedFlag }) {
  return (
    <span className={styles.entryName}>
      <Link href={`/team/presets/flags/${flag.id}`}>
        <FlagPill color={flag.color} colorName={flag.colorName} name={flag.name} />
      </Link>
      {flag.sensitive && <span className="sx-pill sx-pill--neutral">Sensitive</span>}
      {flag.updateOnOffer && <span className="sx-pill sx-pill--info">Update available</span>}
    </span>
  );
}

/** The flag a done move names, or none: a refused move, or an answer of another form's, names none. */
const movedBy = (state: ActionState) => (state.ok ? parseMove(state.values?.move) : null);

/**
 * Where the last move left its flag, worked out once, when its answer comes, from the list as it is
 * read again: a later change to the list (a flag added below) doesn't say it again.
 */
function MovedSentence({
  state,
  flags,
  tier,
}: {
  state: ActionState;
  flags: readonly ListedFlag[];
  tier: Tier;
}) {
  const [said] = useState(() => {
    const moved = movedBy(state);
    return moved ? movedSentence(moved, flags, tier) : '';
  });
  return said;
}

/** A move's button: pressed again while the move before it is still on its way, it does nothing. */
function MoveButton({ flag, way, id }: { flag: ListedFlag; way: 'up' | 'down'; id: string }) {
  const { pending } = useFormStatus();
  // Not disabled while a move is on its way: a disabled button loses focus, and focus stays here.
  const wait = (e: MouseEvent) => {
    if (pending) e.preventDefault();
  };
  return (
    <button
      type="submit"
      id={id}
      name="move"
      value={`${way}:${flag.id}`}
      className="sx-btn sx-btn--secondary"
      aria-disabled={pending || undefined}
      onClick={wait}
    >
      {way === 'up' ? 'Move up' : 'Move down'}
      <span className="sr-only"> {flag.name}</span>
    </button>
  );
}

/**
 * The list's order, in its form: every flag the list shows, each with the version shown, sent
 * whole with each move (design 7). After a move the page is read again, and focus stays on the
 * moved flag's button that is still there, so a keyboard or screen reader user keeps their place,
 * while the line above the list says where the flag went.
 */
function OrderFields({ tier, flags }: { tier: Tier; flags: readonly ListedFlag[] }) {
  const state = useFormState();
  const moveId = useFieldId('move');
  const moved = movedBy(state);
  useEffect(() => {
    const done = movedBy(state);
    if (!done) return;
    const button = (way: string) => document.getElementById(`${moveId}-${way}-${done.id}`);
    (button(done.way) ?? button(done.way === 'up' ? 'down' : 'up'))?.focus();
  }, [state, moveId]);
  return (
    <>
      <input type="hidden" name="tier" value={tier} />
      {/* Enter in the Reason box presses a form's first submit button: this one, disabled, so a
          flag only ever moves by its own button. */}
      <button type="submit" disabled hidden>
        Choose a flag to move
      </button>
      <ReasonBox label="Reason for moving" />
      {/* Always on the page, so a screen reader reads each move's line as it comes. */}
      <p role="status" className={moved ? 'px-alert px-alert--ok' : 'sr-only'}>
        <MovedSentence key={answerKey(state)} state={state} flags={flags} tier={tier} />
      </p>
      <ol className={styles.order}>
        {flags.map((flag, i) => (
          <li key={flag.id}>
            <input type="hidden" name={`flags.${i}.id`} value={flag.id} />
            <input type="hidden" name={`flags.${i}.baseVersion`} value={flag.version} />
            <FlagEntry flag={flag} />
            <span className={styles.moves}>
              {i > 0 && <MoveButton flag={flag} way="up" id={`${moveId}-up-${flag.id}`} />}
              {i < flags.length - 1 && <MoveButton flag={flag} way="down" id={`${moveId}-down-${flag.id}`} />}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * One of the Flags page's two lists (phase 5 design 8.1): Risk level or Conditions, by rank. With
 * two flags or more it is a form that moves one up or down, with a reason kept for each move and
 * the version the list showed each flag at (7); the API refuses an order made from a list another
 * write has changed since, and the page reads it again.
 */
export function FlagOrder({ tier, flags }: { tier: Tier; flags: readonly ListedFlag[] }) {
  if (flags.length < 2)
    return (
      <ol className={styles.order}>
        {flags.map((flag) => (
          <li key={flag.id}>
            <FlagEntry flag={flag} />
          </li>
        ))}
      </ol>
    );
  return (
    <ActionForm id={`order-${tier}`} action={moveFlagAction} label={`Order of the ${TIERS[tier].many}`}>
      <p className="sx-help">
        To change the order, give a reason, then move a flag up or down. Each move keeps the reason in the
        history of the flags it moves.
      </p>
      <OrderFields tier={tier} flags={flags} />
    </ActionForm>
  );
}
