'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { assignProblems, REASON_MAX } from '@/lib/assign';
import styles from '../encounters.module.css';

type Field = 'toUserId' | 'reason';

/**
 * Assign (lifecycle 3.8, 5.5, 9.12), on a note whose author has left the team: a clinician to act
 * as its author, and a reason. The picker lists exactly who the API's assignees route answers, so it
 * holds no rule of its own; the API checks the choice again, asks for a recent sign-in and logs the
 * assignment. Posted to the visit's route handler, never a server action, so the visit is not read
 * again behind the person's back; after the act the browser loads it again, whole. Problems appear
 * in a summary that takes focus and links to each field (WCAG 3.3.1, 3.3.3), as ActionForm's do.
 */
export function AssignForm({
  encounterId,
  noteId,
  options,
  notice,
}: {
  encounterId: string;
  noteId: string;
  /** The assignees route's answer, as the picker words it (`assigneeOptions`). */
  options: { value: string; label: string }[];
  /**
   * What the page came back to say of this note's assignment (`?assign=reauthed` or `changed` with
   * `note=`): said here, and the form takes focus, so the person picks up at the note they were on.
   */
  notice?: { tone: string; text: string };
}) {
  const [problem, setProblem] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [sending, startSending] = useTransition();
  // Set once an answer says where to go, so the button stays off while the next page loads, as
  // SignActions' does (review finding PAC-1).
  const [leaving, setLeaving] = useState(false);
  // The connection dropped on the way: whether the note was assigned only the visit, read again,
  // can say, so no second press is offered (review finding PAC-4).
  const [unsure, setUnsure] = useState(false);
  const busy = sending || leaving;
  const summary = useRef<HTMLDivElement>(null);
  const block = useRef<HTMLDivElement>(null);
  const id = `assign-${noteId}`;

  useEffect(() => {
    if (notice) block.current?.focus();
    // On the page's first render only: a later one keeps focus where the person is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (problem) summary.current?.focus();
  }, [problem, fieldErrors]);

  /** A full load of the next page, not a client navigation: the visit is read again, whole. */
  function leave(to: string) {
    setLeaving(true);
    window.location.assign(to);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = { toUserId: String(form.get('toUserId') ?? ''), reason: String(form.get('reason') ?? '') };
    const problems = assignProblems(
      values,
      options.map((o) => o.value),
    );
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      setProblem('Choose someone and give a reason before assigning the note.');
      return;
    }
    setFieldErrors({});
    startSending(async () => {
      let answer: { go: string } | { problem: string };
      try {
        const response = await fetch(`/encounters/${encounterId}/assign`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ noteId, ...values }),
          cache: 'no-store',
          redirect: 'manual',
        });
        // Sent to sign-in on the way (the session ended): the page itself goes there.
        if (response.type === 'opaqueredirect' || !response.headers.get('content-type')?.includes('json')) {
          setLeaving(true);
          window.location.reload();
          return;
        }
        answer = (await response.json()) as typeof answer;
      } catch {
        setUnsure(true);
        setProblem(
          'The connection dropped, so we can’t tell whether the note was assigned. Read the visit again to see.',
        );
        return;
      }
      if ('go' in answer) {
        leave(answer.go);
        return;
      }
      setProblem(answer.problem);
    });
  }

  const described = (field: Field, hint?: string) =>
    [hint, fieldErrors[field] ? `${id}-${field}-error` : null].filter(Boolean).join(' ') || undefined;
  const errors = Object.entries(fieldErrors) as [Field, string][];

  return (
    // Not a landmark: two notes of one type would give two of the same name. It sits in its note's
    // article, which the note's title names.
    <div ref={block} id={id} tabIndex={-1} className={styles.section}>
      <h3 className="px-h3">Assign this note</h3>
      {notice && (
        <p role="status" className={`px-alert px-alert--${notice.tone}`}>
          {notice.text}
        </p>
      )}
      <p className="sx-help">
        Whoever acts as this note’s author has left the team. Choose a clinician to act as its author: they
        can finish or correct it. Only people who may take this note are listed.
      </p>
      {options.length === 0 ? (
        <p>
          Nobody on the team may take this note now. It needs an active clinician with the same or a higher
          credential, whose role can see everything in it, and any part of this kind of note that you can’t
          see.
          {/* Asked of what the note holds where the reader sees it, and of its type where they could miss
              it, so the list tells them nothing they may not read (review finding PRD-1; lifecycle 5.5). */}
        </p>
      ) : (
        <form className="px-form" onSubmit={submit} noValidate>
          {problem && (
            <div ref={summary} tabIndex={-1} role="alert" className="px-alert px-alert--error">
              <p className="px-alert__title">{problem}</p>
              {errors.length > 0 && (
                <ul>
                  {errors.map(([field, message]) => (
                    <li key={field}>
                      <a href={`#${id}-${field}`}>{message}</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="px-field">
            <label htmlFor={`${id}-toUserId`}>Assign to</label>
            {fieldErrors.toUserId && (
              <p id={`${id}-toUserId-error`} className="sx-help sx-help--error">
                {fieldErrors.toUserId}
              </p>
            )}
            <select
              id={`${id}-toUserId`}
              name="toUserId"
              className={`px-select ${styles.picker}`}
              defaultValue=""
              aria-invalid={fieldErrors.toUserId ? true : undefined}
              aria-describedby={described('toUserId')}
            >
              <option value="">Choose a clinician</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="px-field">
            <label htmlFor={`${id}-reason`}>Reason</label>
            <p id={`${id}-reason-hint`} className="sx-help">
              Logged with the assignment.
            </p>
            {fieldErrors.reason && (
              <p id={`${id}-reason-error`} className="sx-help sx-help--error">
                {fieldErrors.reason}
              </p>
            )}
            <div className={`sx-input${fieldErrors.reason ? ' sx-input--error' : ''}`}>
              <input
                id={`${id}-reason`}
                name="reason"
                type="text"
                required
                aria-required
                autoComplete="off"
                maxLength={REASON_MAX}
                aria-invalid={fieldErrors.reason ? true : undefined}
                aria-describedby={described('reason', `${id}-reason-hint`)}
              />
            </div>
          </div>
          <div className="px-actions">
            {unsure ? (
              <button
                type="button"
                className="sx-btn sx-btn--primary"
                onClick={() => leave(`/encounters/${encounterId}`)}
                disabled={busy}
                aria-disabled={busy}
              >
                {busy ? 'Working…' : 'Read the visit again'}
              </button>
            ) : (
              <button type="submit" className="sx-btn sx-btn--primary" disabled={busy} aria-disabled={busy}>
                {busy ? 'Working…' : 'Assign'}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
