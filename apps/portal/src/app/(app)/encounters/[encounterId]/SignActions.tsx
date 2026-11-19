'use client';

import { useState, useTransition } from 'react';
import { samePlan, SIGN_ACTS, visitAfter, type SignAct, type SignAnswer, type SignPlan } from '@/lib/sign';
import styles from '../encounters.module.css';

/**
 * Co-sign or Attest (lifecycle 3.5, 3.7, 5.3, 5.4, 9.11): one press acts on every note of the visit
 * the API marked for this person, each with the hash of the note as they read it, and the sentence
 * of 3.5 above the button. The browser then loads the visit again, whole, to show what the API
 * holds now.
 *
 * The plan sent is the one the person read: the notes and hashes of the first render. A server
 * action anywhere on the page (Stay signed in, say) renders it again from a fresh read of the
 * visit, so a later render can carry the hashes of notes changed since, which nobody here read. Then
 * the press sends nothing and the visit is loaded again, saying it changed (the review of unit L6's
 * earlier build).
 */
export function SignActions({
  encounterId,
  act,
  plan,
}: {
  encounterId: string;
  act: SignAct;
  /** The notes of this render's read the API marks for the act (`signPlan`). */
  plan: SignPlan;
}) {
  // Kept from the first render: later props are never sent.
  const [read] = useState(plan);
  const [problem, setProblem] = useState('');
  const [sending, startSending] = useTransition();
  const words = SIGN_ACTS[act];
  const heading = `${act}-heading`;

  function press() {
    if (!samePlan(read.notes, plan.notes)) {
      window.location.assign(visitAfter(encounterId, 'changed'));
      return;
    }
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
          window.location.reload();
          return;
        }
        answer = (await response.json()) as SignAnswer;
      } catch {
        setProblem('Nothing was sent. Check the connection and try again.');
        return;
      }
      if ('go' in answer) {
        window.location.assign(answer.go);
        return;
      }
      setProblem(answer.problem);
    });
  }

  return (
    <section aria-labelledby={heading} className="px-panel">
      <h2 id={heading} className="px-h2">
        {words.heading}
      </h2>
      <p>{words.lead(read.titles.length)}</p>
      <ul className="px-list">
        {read.titles.map((title, i) => (
          <li key={read.notes[i]!.noteId}>{title}</li>
        ))}
      </ul>
      <p className={styles.statement}>{words.statement}</p>
      {problem && (
        <p role="alert" className="px-alert px-alert--error">
          {problem}
        </p>
      )}
      <div className="px-actions">
        <button
          type="button"
          className="sx-btn sx-btn--primary"
          onClick={press}
          disabled={sending}
          aria-disabled={sending}
        >
          {sending ? 'Working…' : words.heading}
        </button>
      </div>
    </section>
  );
}
