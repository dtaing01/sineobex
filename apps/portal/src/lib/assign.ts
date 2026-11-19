import type { Schemas } from '@sineobex/contract';
import { CREDENTIAL_LABELS } from './labels';
import { refusalRedirect } from './refusals';

/**
 * Assign on the visit page (phase 4 design, lifecycle 3.8, 5.5, 9.12): a clinician to act as the
 * author of a note whose author has left. Who may take a note the API decides, through the route
 * that lists them (`GET /v1/notes/{noteId}/assignees`), so the picker holds no copy of the ranks.
 */

/** "Jordan Lee (demo), Attending physician", in the order the API lists them (by name). */
export function assigneeOptions(assignees: Schemas['NoteAssignee'][]): { value: string; label: string }[] {
  return assignees.map((a) => {
    const credential = a.credential === 'none' ? undefined : CREDENTIAL_LABELS[a.credential];
    return { value: a.userId, label: credential ? `${a.displayName}, ${credential}` : a.displayName };
  });
}

// The API's AssignInput.
const REASON_MIN = 3;
export const REASON_MAX = 500;

/** What the form says before it sends anything: a person from the list, and a reason. */
export function assignProblems(
  values: { toUserId: string; reason: string },
  offered: readonly string[],
): Partial<Record<'toUserId' | 'reason', string>> {
  const problems: Partial<Record<'toUserId' | 'reason', string>> = {};
  if (!offered.includes(values.toUserId)) problems.toUserId = 'Choose who will act as the note’s author.';
  const reason = values.reason.trim();
  if (reason.length < REASON_MIN) problems.reason = 'Give a reason of at least 3 characters.';
  else if (reason.length > REASON_MAX) problems.reason = 'A reason is at most 500 characters.';
  return problems;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the visit page posts to its route handler. */
export function assignRequest(body: unknown): { noteId: string; toUserId: string; reason: string } | null {
  const b = body as { noteId?: unknown; toUserId?: unknown; reason?: unknown } | null;
  if (typeof b !== 'object' || b === null) return null;
  if (typeof b.noteId !== 'string' || !UUID.test(b.noteId)) return null;
  if (typeof b.toUserId !== 'string' || !UUID.test(b.toUserId)) return null;
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return null;
  return { noteId: b.noteId, toUserId: b.toUserId, reason };
}

/** What the visit page says when it is loaded again after an assignment (`?assign=`). */
export const ASSIGNED_STATES = {
  done: {
    tone: 'ok',
    text: 'Assigned. The note names who acts as its author now, and they can finish or correct it.',
  },
  reauthed: { tone: 'ok', text: 'You confirmed it’s you. Assign the note again.' },
  author_active: {
    tone: 'info',
    text: 'Someone on the team acts as this note’s author now, so it can’t be assigned.',
  },
  changed: { tone: 'info', text: 'Who may take this note changed. Choose again from the list.' },
} as const;

export type AssignedState = keyof typeof ASSIGNED_STATES;

export function assignedState(value: unknown): AssignedState | null {
  return typeof value === 'string' && Object.hasOwn(ASSIGNED_STATES, value) ? (value as AssignedState) : null;
}

/**
 * The visit, loaded again at the note's own form with what to say there: a visit can have several
 * notes to assign, and the person picks up where they were (review finding PAX-3).
 */
const atForm = (visit: string, state: AssignedState, noteId: string) =>
  `${visit}?assign=${state}&note=${noteId}#assign-${noteId}`;

/**
 * Where the API's answer sends the person. Like every `team.manage_users` act, an assignment asks
 * for a recent sign-in: /reauth, then back to the note's form. A refusal that names the person
 * chosen is one the picker would not have offered had it been loaded now, so the visit is loaded
 * again, at the note's form.
 */
export function assignAnswer(
  encounterId: string,
  noteId: string,
  status: number,
  code: string,
): { go: string } | { problem: string } {
  const visit = `/encounters/${encounterId}`;
  if (status >= 200 && status < 300) return { go: `${visit}?assign=done` };
  const to = refusalRedirect(code, atForm(visit, 'reauthed', noteId));
  if (to) return { go: to };
  if (code === 'author_active') return { go: `${visit}?assign=author_active` };
  if (['assignee_not_member', 'assignee_cannot_chart', 'credential_too_low', 'cannot_see_all'].includes(code))
    return { go: atForm(visit, 'changed', noteId) };
  if (status === 404) return { go: visit };
  if (status === 400 || status === 422)
    return { problem: 'Something about this request was wrong. Load the visit again.' };
  return { problem: 'Something went wrong. Try again.' };
}
