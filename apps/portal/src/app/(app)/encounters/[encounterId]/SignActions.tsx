'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { samePlan, SIGN_ACTS, visitAfter, type SignAct, type SignAnswer, type SignPlan } from '@/lib/sign';
import styles from '../encounters.module.css';

/**
 * Co-sign or Attest (lifecycle 3.5, 3.7, 5.3, 5.4, 9.11): one press acts on every note of the visit
 * the API marked for this person, each with the hash of the note as they read it, and the sentence
 * of 3.5 above the button. The browser then loads the visit again, whole, to show what the API
 * holds now.
 *
 * The plan sent is the one the person read: the notes and hashes of the first render, or none. A
 * server action anywhere on the page (Stay signed in, say) renders it again from a fresh read of
 * the visit, so a later render can carry the hashes of notes changed since, which nobody here read,
 * or none where the person read some. The page renders this section for each act on every render,
 * with or without a plan, so the first plan lives as long as the page does (review finding PRD-2).
 * When a later render's plan is not the first one, the section says at once that the visit changed,
 * and a press sends nothing: the visit is loaded again, saying so.
 */
export function SignActions({
  encounterId,
  act,
  plan,
}: {
  encounterId: string;
  act: SignAct;
  /** The notes of this render's read the API marks for the act (`signPlan`), or null for none. */
  plan: SignPlan | null;
}) {
  // Kept from the first render, null included: later props are never sent.
  const [read] = useState(plan);
  const [problem, setProblem] = useState('');
  const [sending, startSending] = useTransition();
  // Set once an answer says where to go: the transition ends as the browser starts to load the next
  // page, and the button must not come back while it loads (review finding PAC-1).
  const [leaving, setLeaving] = useState(false);
  const busy = sending || leaving;
  // A problem takes focus, which fell to the page while the button was off, each time it comes
  // (review finding PAX-1). Cleared at each press, so the same problem again is a new alert.
  const alert = useRef<HTMLParagraphElement>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (problem) alert.current?.focus();
  }, [problem, tries]);
  const words = SIGN_ACTS[act];
  const heading = `${act}-heading`;
  const changed = !samePlan(read?.notes ?? [], plan?.notes ?? []);
  if (!read && !plan) return null;

  function leave(to: string) {
    setLeaving(true);
    window.location.assign(to);
  }

  function fail(text: string) {
    setProblem(text);
    setTries((n) => n + 1);
  }

  function press() {
    if (!read || changed) {
      leave(visitAfter(encounterId, 'changed'));
      return;
    }
    setProblem('');
    startSending(async () => {
      let answer: SignAnswer;
      try {
        const response = await fetch(`/encounters/${encounterId}/sign`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ act, notes: read.notes }),
          cache: 'no-store',
          redirect: 'manual',
        });
        // Sent to sign-in on the way (the session ended): the page itself goes there.
        if (response.type === 'opaqueredirect' || !response.headers.get('content-type')?.includes('json')) {
          setLeaving(true);
          window.location.reload();
          return;
        }
        answer = (await response.json()) as SignAnswer;
      } catch {
        fail('Nothing was sent. Check the connection and try again.');
        return;
      }
      if ('go' in answer) {
        leave(answer.go);
        return;
      }
      fail(answer.problem);
    });
  }

  return (
    <section aria-labelledby={heading} className="px-panel">
      <h2 id={heading} className="px-h2">
        {words.heading}
      </h2>
      {read && (
        <>
          <p>{words.lead(read.titles.length)}</p>
          <ul className="px-list">
            {read.titles.map((title, i) => (
              <li key={read.notes[i]!.noteId}>{title}</li>
            ))}
          </ul>
          <p className={styles.statement}>{words.statement}</p>
        </>
      )}
      {changed && (
        // The design's sentence (lifecycle 9.9). A full load, not a client navigation: this section
        // would keep the plan it holds through one.
        <p role="status" className="px-alert px-alert--info">
          This visit changed. <a href={`/encounters/${encounterId}`}>Read it again</a>.
        </p>
      )}
      {problem && (
        <p ref={alert} tabIndex={-1} role="alert" className="px-alert px-alert--error">
          {problem}
        </p>
      )}
      <div className="px-actions">
        <button
          type="button"
          className="sx-btn sx-btn--primary"
          onClick={press}
          disabled={busy}
          aria-disabled={busy}
        >
          {busy ? 'Working…' : words.heading}
        </button>
      </div>
    </section>
  );
}
