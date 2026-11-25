'use client';

import type { Schemas } from '@sineobex/contract';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import styles from '@/app/(app)/patients/patients.module.css';
import type { FlagAnswer, FlagChoice } from '@/lib/flags';
import local from './FlagsPanel.module.css';
import { formatDateTime } from '@/lib/labels';
import { flagRefusalSentence } from '@/lib/refusals';

/**
 * A patient's Flags panel (phase 5 design 8.1): the history (the flag, set or cleared, who, when, why;
 * a change entered in error says so, with who and when, its reasons only where the API sent them,
 * to the change's author and Program Admins), Entered in error on the changes the person may mark,
 * and the form: the flag (its choices from `GET /v1/presets/flags`, an archived flag the patient
 * carries only to clear), set or clear, a reason (required, `autoComplete="off"`) and Save, posted to
 * the route handler `flags/route.ts` with the change's ID the page made once for the form (D115).
 *
 * Everything shown is what the API sent this reader (D114): a flag hidden from them is in neither
 * the chart nor the list, and a reason kept from them is absent, never blanked here. The one rule
 * the panel keeps itself is the design's: a flag no longer on the team's list is offered only to
 * clear, so a Set of it is said beside the field before anything is sent (the API refuses it too).
 */
export interface FlagsPanelProps {
  patientId: string;
  /** The chart's flags as the API worked them out for this reader. */
  flags: Schemas['ChartFlags'];
  /** The flag field's choices (lib/flags.ts flagChoices). */
  choices: readonly FlagChoice[];
  /** The changes the person may mark entered in error (lib/flags.ts markableChanges). */
  markable: readonly string[];
  /** `patients.edit`: the form and Entered in error are offered. */
  canEdit: boolean;
  /** The ID of the change the form makes, made once by the page for the form's life (D115). */
  changeId: string;
  /** What the page came back to say after a save or a mark (`?flag=`): said here, and it takes focus. */
  notice?: string;
}

type Row = Schemas['FlagHistoryRow'];
type Field = 'flagId' | 'action' | 'reason';

/** No answer the panel could read came back: only a second press can tell whether the first went through. */
const DROPPED =
  'The connection dropped, so we can’t tell whether the flag was saved. Press Save again: if it was, it isn’t saved twice.';
const DROPPED_MARK =
  'The connection dropped, so we can’t tell whether the change was marked. Press Mark entered in error again: if it was, nothing changes.';

/** Whether [text] holds nothing once trimmed as the API trims a reason (lib/flags.ts trimReason). */
const blank = (text: string) => text.replace(/[\s\u0085]+/g, '') === '';

/** "Set Demo: High, Oct 20, 2026, 11:00 AM": a change in words, for a button's name or a heading. */
const changeWords = (row: Row) =>
  `${row.action === 'set' ? 'Set' : 'Cleared'} ${row.name}, ${formatDateTime(row.effectiveAt)}`;

/** A choice as the field offers it: its pill's words, and whether the patient has it or it may only be cleared. */
function choiceWords(c: FlagChoice): string {
  const pill = `${c.colorName} · ${c.name}`;
  if (c.clearOnly) return `${pill} · No longer on the team’s list (clear only)`;
  return c.carried ? `${pill} (on this patient)` : pill;
}

/**
 * [json] as the route handler answers (lib/flags.ts FlagAnswer): done, or not done with its words and
 * the field they are about, or a page of the portal's own to go to. Null for any other shape: JSON
 * from a gateway or a platform in front of the portal says nothing of whether the act went through,
 * so it is read as a dropped connection, never drawn.
 */
export function flagAnswerOf(json: unknown): FlagAnswer | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const answer = json as Record<string, unknown>;
  if (answer.ok === true) return { ok: true };
  if (answer.ok !== false) return null;
  const { redirect, error, field, code } = answer;
  // Only a path of the portal's own: never another site.
  if (typeof redirect === 'string') {
    return redirect.startsWith('/') && !redirect.startsWith('//') ? { ok: false, redirect } : null;
  }
  if (typeof error !== 'string' || error === '') return null;
  return {
    ok: false,
    error,
    ...(field === 'flagId' || field === 'reason' ? { field } : {}),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

/**
 * Posts [body] to a flag route handler and reads its answer: the handler's own ([flagAnswerOf]),
 * `session_ended` for a redirect the browser was not let follow (the session ended on the way), or
 * null for anything else (a dropped connection, a gateway's page or its JSON), which can't say
 * whether the act went through.
 */
async function post(path: string, body: unknown): Promise<FlagAnswer | 'session_ended' | null> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'manual',
    });
    if (response.type === 'opaqueredirect') return 'session_ended';
    if (!response.headers.get('content-type')?.includes('json')) return null;
    return flagAnswerOf(await response.json());
  } catch {
    return null;
  }
}

export function FlagsPanel({
  patientId,
  flags,
  choices,
  markable,
  canEdit,
  changeId,
  notice,
}: FlagsPanelProps) {
  // The ID of the first render, for the life of the form: a later render's is never sent (D115), so
  // a press after a dropped answer, or a second press, is the same change.
  const [formId] = useState(changeId);
  const [problem, setProblem] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [tries, setTries] = useState(0);
  // The change whose Entered in error is open, its problem and its reason's own refusal.
  const [marking, setMarking] = useState<string | null>(null);
  const [markProblem, setMarkProblem] = useState('');
  const [markError, setMarkError] = useState('');
  const [markTries, setMarkTries] = useState(0);
  const [sending, startSending] = useTransition();
  // Set once an answer says where to go, so nothing is pressed again while the next page loads.
  const [leaving, setLeaving] = useState(false);
  const busy = sending || leaving;
  const summary = useRef<HTMLDivElement>(null);
  const said = useRef<HTMLParagraphElement>(null);
  const markHeading = useRef<HTMLHeadingElement>(null);
  const markSummary = useRef<HTMLDivElement>(null);
  const markButtons = useRef(new Map<string, HTMLButtonElement>());
  // Where focus goes once Entered in error closes: back to the button that opened it.
  const returnTo = useRef<string | null>(null);

  useEffect(() => {
    if (notice) said.current?.focus();
    // On the page's first render only: a later one keeps focus where the person is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (problem) summary.current?.focus();
  }, [problem, fieldErrors, tries]);
  useEffect(() => {
    if (markProblem) markSummary.current?.focus();
  }, [markProblem, markError, markTries]);
  // Entered in error takes focus at its heading as it opens, and gives it back to its button as it closes.
  useEffect(() => {
    if (marking) {
      markHeading.current?.focus();
      return;
    }
    if (!returnTo.current) return;
    markButtons.current.get(returnTo.current)?.focus();
    returnTo.current = null;
  }, [marking]);

  /**
   * A full load of the patient, not a client navigation: the chart is read again, whole, and the
   * notice takes focus at the panel. No fragment: from an address that already says the same, a
   * fragment would only scroll, and the page would never be read again.
   */
  function leave(to: string) {
    setLeaving(true);
    window.location.assign(to);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const flagId = String(form.get('flagId') ?? '');
    const action = String(form.get('action') ?? '');
    const reason = String(form.get('reason') ?? '');
    const choice = choices.find((c) => c.flagId === flagId);
    const problems: Partial<Record<Field, string>> = {};
    if (!choice) problems.flagId = 'Choose a flag.';
    // 5.1: a flag no longer on the team's list stays on the patient until cleared, and is never set again.
    else if (choice.clearOnly && action === 'set')
      problems.flagId = flagRefusalSentence('change', 409, 'archived');
    if (action !== 'set' && action !== 'clear') problems.action = 'Choose Set or Clear.';
    if (blank(reason)) problems.reason = 'Give a reason.';
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      setProblem('The flag wasn’t changed. Check each field below.');
      setTries((n) => n + 1);
      return;
    }
    setFieldErrors({});
    startSending(async () => {
      const answer = await post(`/patients/${patientId}/flags`, { id: formId, flagId, action, reason });
      if (answer === 'session_ended') {
        setLeaving(true);
        window.location.reload();
        return;
      }
      if (answer === null) {
        setProblem(DROPPED);
      } else if (answer.ok) {
        leave(`/patients/${patientId}?flag=saved`);
        return;
      } else if ('redirect' in answer) {
        leave(answer.redirect);
        return;
      } else if (answer.field) {
        setFieldErrors({ [answer.field]: answer.error });
        setProblem('The flag wasn’t changed. Check each field below.');
      } else {
        setProblem(answer.error);
      }
      setTries((n) => n + 1);
    });
  }

  function openMark(row: Row) {
    setMarking(row.changeId);
    setMarkProblem('');
    setMarkError('');
  }

  function closeMark() {
    returnTo.current = marking;
    setMarking(null);
    setMarkProblem('');
    setMarkError('');
  }

  function mark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !marking) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    if (blank(reason)) {
      setMarkError('Give a reason.');
      setMarkProblem('The change wasn’t marked. Check its reason.');
      setMarkTries((n) => n + 1);
      return;
    }
    const target = marking;
    startSending(async () => {
      const answer = await post(`/patients/${patientId}/flag-changes/${target}/entered-in-error`, { reason });
      if (answer === 'session_ended') {
        setLeaving(true);
        window.location.reload();
        return;
      }
      if (answer === null) {
        setMarkError('');
        setMarkProblem(DROPPED_MARK);
      } else if (answer.ok) {
        leave(`/patients/${patientId}?flag=marked`);
        return;
      } else if ('redirect' in answer) {
        leave(answer.redirect);
        return;
      } else if (answer.field === 'reason') {
        setMarkError(answer.error);
        setMarkProblem('The change wasn’t marked. Check its reason.');
      } else {
        setMarkError('');
        setMarkProblem(answer.error);
      }
      setMarkTries((n) => n + 1);
    });
  }

  const described = (field: Field, ...ids: string[]) =>
    [...ids, fieldErrors[field] ? `flags-${field}-error` : null].filter(Boolean).join(' ') || undefined;
  const errors = Object.entries(fieldErrors) as [Field, string][];
  const history = flags.history;
  const marked = history.find((r) => r.changeId === marking);
  const canMark = history.some((r) => markable.includes(r.changeId));
  const tiers = [
    { tier: 'primary', label: 'Risk level' },
    { tier: 'secondary', label: 'Conditions' },
  ] as const;

  return (
    <div className="px-form">
      {notice && (
        <p ref={said} tabIndex={-1} role="status" className="px-alert px-alert--ok">
          {notice}
        </p>
      )}
      <h3 className="px-h3">History</h3>
      {history.length === 0 ? (
        <p>No flag has been set or cleared.</p>
      ) : (
        <table className={`px-table ${styles.stack}`}>
          <caption className="sr-only">Each flag set or cleared, oldest first</caption>
          <thead>
            <tr>
              <th scope="col">Flag</th>
              <th scope="col">Change</th>
              <th scope="col">By</th>
              <th scope="col">When</th>
              <th scope="col">Why</th>
              {canMark && (
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {history.map((row) => {
              const error = row.enteredInError;
              return (
                <tr key={row.changeId}>
                  <th scope="row">
                    {row.name}
                    <span className={styles.meta}>{row.tier === 'primary' ? 'Risk level' : 'Condition'}</span>
                  </th>
                  <td data-label="Change">
                    {row.action === 'set' ? 'Set' : 'Cleared'}
                    {error && (
                      <span className={styles.meta}>
                        Entered in error by {error.byName}, {formatDateTime(error.at)}
                      </span>
                    )}
                  </td>
                  <td data-label="By">{row.authorName}</td>
                  <td data-label="When">{formatDateTime(row.effectiveAt)}</td>
                  <td data-label="Why">
                    {row.reason ?? 'Only the person who made it and Program Admins see why.'}
                    {error?.reason && (
                      <span className={styles.meta}>Entered in error because: {error.reason}</span>
                    )}
                  </td>
                  {canMark && (
                    <td>
                      {markable.includes(row.changeId) && (
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) markButtons.current.set(row.changeId, el);
                            else markButtons.current.delete(row.changeId);
                          }}
                          className="sx-btn sx-btn--secondary"
                          aria-expanded={marking === row.changeId}
                          aria-controls={marking === row.changeId ? 'flags-mark' : undefined}
                          onClick={() => openMark(row)}
                          disabled={busy}
                          aria-disabled={busy}
                          // Its words first, then which change: every row's button reads the same.
                          aria-label={`Entered in error: ${changeWords(row)}`}
                        >
                          Entered in error
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {marked && (
        <div id="flags-mark" className="px-form">
          <h3 ref={markHeading} tabIndex={-1} className="px-h3">
            Mark entered in error: {changeWords(marked)}
          </h3>
          <p>
            {marked.action === 'set'
              ? 'This set no longer counts among the patient’s flags.'
              : 'This clear no longer counts, so the flag it cleared can come back on the patient.'}{' '}
            It stays in the history, marked. Only the person who made the change and Program Admins see the
            reasons.
          </p>
          <form className="px-form" onSubmit={mark} noValidate aria-label="Mark entered in error">
            {markProblem && (
              <div ref={markSummary} tabIndex={-1} role="alert" className="px-alert px-alert--error">
                <p className="px-alert__title">{markProblem}</p>
                {markError && (
                  <ul>
                    <li>
                      <a href="#flags-mark-reason">{markError}</a>
                    </li>
                  </ul>
                )}
              </div>
            )}
            <div className="px-field">
              <label htmlFor="flags-mark-reason">Why it was entered in error</label>
              {markError && (
                <p id="flags-mark-reason-error" className="sx-help sx-help--error">
                  {markError}
                </p>
              )}
              <div className={`sx-input${markError ? ' sx-input--error' : ''}`}>
                <textarea
                  id="flags-mark-reason"
                  name="reason"
                  rows={2}
                  // As wide as its box lets it be, so it fits at 320 px.
                  cols={10}
                  required
                  aria-required
                  autoComplete="off"
                  aria-invalid={markError ? true : undefined}
                  aria-describedby={[
                    markError ? 'flags-mark-reason-error' : null,
                    'flags-mark-reason-warning',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              </div>
              <p id="flags-mark-reason-warning" className="sx-help">
                Don’t put patient names here.
              </p>
            </div>
            <div className="px-actions">
              <button type="submit" className="sx-btn sx-btn--primary" disabled={busy} aria-disabled={busy}>
                {busy ? 'Working…' : 'Mark entered in error'}
              </button>
              <button type="button" className="sx-btn sx-btn--secondary" onClick={closeMark} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {canEdit &&
        (choices.length === 0 ? (
          <p>Your team has no flags you can set.</p>
        ) : (
          <>
            <h3 id="flags-form-heading" className="px-h3">
              Set or clear a flag
            </h3>
            <form className="px-form" onSubmit={save} noValidate aria-labelledby="flags-form-heading">
              {problem && (
                <div ref={summary} tabIndex={-1} role="alert" className="px-alert px-alert--error">
                  <p className="px-alert__title">{problem}</p>
                  {errors.length > 0 && (
                    <ul>
                      {errors.map(([field, message]) => (
                        <li key={field}>
                          <a href={`#flags-${field}`}>{message}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="px-field">
                <label htmlFor="flags-flagId">Flag</label>
                <p id="flags-flagId-hint" className="sx-help">
                  A new risk level takes the place of the one they have. A flag no longer on the team’s list
                  can only be cleared.
                </p>
                {fieldErrors.flagId && (
                  <p id="flags-flagId-error" className="sx-help sx-help--error">
                    {fieldErrors.flagId}
                  </p>
                )}
                <select
                  id="flags-flagId"
                  name="flagId"
                  className={`px-select ${local.choice}`}
                  defaultValue=""
                  required
                  aria-invalid={fieldErrors.flagId ? true : undefined}
                  aria-describedby={described('flagId', 'flags-flagId-hint')}
                >
                  <option value="">Choose a flag</option>
                  {tiers.map(({ tier, label }) => {
                    const offered = choices.filter((c) => c.tier === tier);
                    return offered.length === 0 ? null : (
                      <optgroup key={tier} label={label}>
                        {offered.map((c) => (
                          <option key={c.flagId} value={c.flagId}>
                            {choiceWords(c)}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
              <fieldset
                id="flags-action"
                className="px-fieldset"
                tabIndex={-1}
                aria-describedby={described('action')}
              >
                <legend>Set or clear</legend>
                {fieldErrors.action && (
                  <p id="flags-action-error" className="sx-help sx-help--error">
                    {fieldErrors.action}
                  </p>
                )}
                {(['set', 'clear'] as const).map((value) => (
                  <div key={value} className="px-check">
                    <input id={`flags-action-${value}`} type="radio" name="action" value={value} required />
                    <label htmlFor={`flags-action-${value}`}>{value === 'set' ? 'Set' : 'Clear'}</label>
                  </div>
                ))}
              </fieldset>
              <div className="px-field">
                <label htmlFor="flags-reason">Reason</label>
                {fieldErrors.reason && (
                  <p id="flags-reason-error" className="sx-help sx-help--error">
                    {fieldErrors.reason}
                  </p>
                )}
                <div className={`sx-input${fieldErrors.reason ? ' sx-input--error' : ''}`}>
                  <textarea
                    id="flags-reason"
                    name="reason"
                    rows={3}
                    // As wide as its box lets it be, so it fits at 320 px.
                    cols={10}
                    required
                    aria-required
                    autoComplete="off"
                    aria-invalid={fieldErrors.reason ? true : undefined}
                    aria-describedby={described('reason', 'flags-reason-warning')}
                  />
                </div>
                <p id="flags-reason-warning" className="sx-help">
                  Don’t put patient names here.
                </p>
              </div>
              <div className="px-actions">
                <button type="submit" className="sx-btn sx-btn--primary" disabled={busy} aria-disabled={busy}>
                  {busy ? 'Working…' : 'Save'}
                </button>
              </div>
            </form>
          </>
        ))}
    </div>
  );
}
