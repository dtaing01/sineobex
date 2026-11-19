'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import styles from '@/app/(app)/encounters/encounters.module.css';
import type { EarlierAnswer, ReferralRow, VisitRow } from '@/lib/encounters';

/**
 * The chart's timeline (lifecycle 5.2, 7, 9.11): its visits, newest first, each with its notes'
 * titles and states as the API gives them and a link to the visit page; then its referrals. Under a
 * full page of visits, Show earlier visits asks for the next 50 and moves focus to the first new
 * one. Nothing here is a read of its own: the visits came with the chart's logged read, and each
 * further page is logged by the API.
 */
export function Timeline({
  patientId,
  visits: firstPage,
  more: firstMore,
  referrals,
}: {
  /** The chart's canonical record. */
  patientId: string;
  visits: VisitRow[];
  /** A full first page came: there may be earlier visits. */
  more: boolean;
  referrals: ReferralRow[];
}) {
  const [earlier, setEarlier] = useState<VisitRow[]>([]);
  const [more, setMore] = useState(firstMore);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [loading, startLoading] = useTransition();
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const heading = useRef<HTMLHeadingElement>(null);
  const focusOn = useRef<string | null>(null);
  const visits = [
    ...firstPage,
    ...earlier.filter((v) => !firstPage.some((f) => f.encounterId === v.encounterId)),
  ];
  const whenOf = new Map(visits.map((v) => [v.encounterId, v.when]));

  useEffect(() => {
    if (focusOn.current) {
      links.current.get(focusOn.current)?.focus();
      focusOn.current = null;
    }
  }, [earlier]);

  function showEarlier() {
    const before = visits.at(-1)?.encounterId;
    if (!before) return;
    startLoading(async () => {
      let answer: EarlierAnswer;
      try {
        const response = await fetch('/encounters/earlier', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patientId, before }),
          cache: 'no-store',
          redirect: 'manual',
        });
        // Sent to sign-in on the way (the session ended): the page itself goes there.
        if (response.type === 'opaqueredirect' || !response.headers.get('content-type')?.includes('json')) {
          window.location.reload();
          return;
        }
        answer = (await response.json()) as EarlierAnswer;
      } catch {
        setProblem('Earlier visits couldn’t be loaded. Check the connection and try again.');
        return;
      }
      if ('go' in answer) {
        window.location.assign(answer.go);
        return;
      }
      if ('problem' in answer) {
        setProblem(answer.problem);
        return;
      }
      setProblem('');
      setMore(answer.more);
      const shown = new Set(visits.map((v) => v.encounterId));
      const fresh = answer.visits.filter((v) => !shown.has(v.encounterId));
      if (fresh.length === 0) {
        setNotice('No earlier visits.');
        heading.current?.focus();
        return;
      }
      setNotice(`${fresh.length} earlier ${fresh.length === 1 ? 'visit' : 'visits'} shown.`);
      focusOn.current = fresh[0]!.encounterId;
      setEarlier((list) => [...list, ...fresh]);
    });
  }

  return (
    <>
      <h3 ref={heading} tabIndex={-1} className="px-h3">
        Visits
      </h3>
      {visits.length === 0 ? (
        <p>No visits recorded.</p>
      ) : (
        <ol className={styles.plain}>
          {visits.map((v) => (
            <li key={v.encounterId}>
              {/* No prefetch on links to a visit: loading one logs a read nobody made. */}
              <Link
                href={`/encounters/${v.encounterId}`}
                prefetch={false}
                className={styles.visitLink}
                ref={(a) => {
                  if (a) links.current.set(v.encounterId, a);
                  else links.current.delete(v.encounterId);
                }}
              >
                Visit on {v.when}
              </Link>{' '}
              · {v.kind}
              {v.notes.length === 0 ? (
                <span className={styles.meta}>No notes to show</span>
              ) : (
                <ul className={styles.notes}>
                  {v.notes.map((n) => (
                    <li key={n.noteId}>
                      {n.title}: {n.state}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {/* Always there, so a screen reader hears the notice when it comes; out of the panel's column
          while it is empty, so it opens no gap under the visits. */}
      <p role="status" className={notice ? undefined : 'sr-only'}>
        {notice}
      </p>
      {problem && (
        <p role="alert" className="px-alert px-alert--error">
          {problem}
        </p>
      )}
      {more && (
        <div className="px-actions">
          <button
            type="button"
            className="sx-btn sx-btn--secondary"
            onClick={showEarlier}
            disabled={loading}
            aria-disabled={loading}
          >
            {loading ? 'Loading…' : 'Show earlier visits'}
          </button>
        </div>
      )}

      <h3 className="px-h3">Referrals</h3>
      {referrals.length === 0 ? (
        <p>No referrals recorded.</p>
      ) : (
        <ul className={styles.plain}>
          {referrals.map((r) => (
            <li key={r.id}>
              {r.enteredInError === null ? (
                `${r.referredOn}: ${r.details}`
              ) : (
                <del className={styles.struck}>
                  {r.referredOn}: {r.details}
                </del>
              )}
              {r.enteredInError !== null && (
                <span className={styles.meta}>
                  Entered in error{r.enteredInError ? `: ${r.enteredInError}` : ''}
                </span>
              )}
              <span className={styles.meta}>Recorded by {r.recordedBy}</span>
              {/* "At a visit" only for a visit of this chart (lifecycle 8.4): one the timeline lists. */}
              {r.encounterId && whenOf.has(r.encounterId) && (
                <span className={styles.meta}>
                  <Link href={`/encounters/${r.encounterId}`} prefetch={false}>
                    At the visit on {whenOf.get(r.encounterId)}
                  </Link>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
