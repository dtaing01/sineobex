import { describe, expect, it } from 'vitest';
import { assignAnswer, assignedState, assigneeOptions, assignProblems, assignRequest } from './assign';

// Assign on the visit page (lifecycle 3.8, 5.5, 9.12).
const VISIT = '5eed2000-0000-4000-8000-000000000001';
const NOTE = '5eed2100-0000-4000-8000-000000000001';
const USER = '5eed3000-0000-4000-8000-000000000001';

describe('the picker', () => {
  it('lists exactly the people the assignees route answers, in its order, each with their credential', () => {
    expect(
      assigneeOptions([
        { userId: USER, displayName: 'Jordan Lee (demo)', credential: 'attending' },
        { userId: NOTE, displayName: 'Sam Okafor (demo)', credential: 'none' },
      ]),
    ).toEqual([
      { value: USER, label: 'Jordan Lee (demo), Attending physician' },
      { value: NOTE, label: 'Sam Okafor (demo)' },
    ]);
    expect(assigneeOptions([])).toEqual([]);
  });
});

describe('what the form asks before it sends', () => {
  const offered = [USER];

  it('asks for someone from the list and a reason of 3 to 500 characters', () => {
    expect(assignProblems({ toUserId: USER, reason: 'Left the team in October' }, offered)).toEqual({});
    expect(assignProblems({ toUserId: '', reason: '' }, offered)).toEqual({
      toUserId: 'Choose who will act as the note’s author.',
      reason: 'Give a reason of at least 3 characters.',
    });
    expect(assignProblems({ toUserId: NOTE, reason: '  ab  ' }, offered)).toEqual({
      toUserId: 'Choose who will act as the note’s author.',
      reason: 'Give a reason of at least 3 characters.',
    });
    expect(assignProblems({ toUserId: USER, reason: 'x'.repeat(501) }, offered)).toEqual({
      reason: 'A reason is at most 500 characters.',
    });
  });
});

describe('what the route handler takes', () => {
  it('takes a note, a person and a reason, the reason trimmed', () => {
    expect(assignRequest({ noteId: NOTE, toUserId: USER, reason: '  Left in October ' })).toEqual({
      noteId: NOTE,
      toUserId: USER,
      reason: 'Left in October',
    });
  });

  it('refuses anything else', () => {
    for (const body of [
      null,
      { noteId: 'x', toUserId: USER, reason: 'Left' },
      { noteId: NOTE, toUserId: '', reason: 'Left' },
      { noteId: NOTE, toUserId: USER, reason: 'ab' },
      { noteId: NOTE, toUserId: USER, reason: 'x'.repeat(501) },
      { noteId: NOTE, toUserId: USER },
    ])
      expect(assignRequest(body), JSON.stringify(body)).toBeNull();
  });
});

describe('where an answer sends the person', () => {
  it('loads the visit again after the assignment, which names who acts as the author now', () => {
    expect(assignAnswer(VISIT, 201, '')).toEqual({ go: `/encounters/${VISIT}?assign=done` });
    expect(assignAnswer(VISIT, 200, '')).toEqual({ go: `/encounters/${VISIT}?assign=done` });
  });

  it('goes through /reauth when the API asks for a recent sign-in, and back to the visit', () => {
    expect(assignAnswer(VISIT, 403, 'reauth_required')).toEqual({
      go: `/reauth?next=${encodeURIComponent(`/encounters/${VISIT}?assign=reauthed`)}`,
    });
  });

  it('loads the visit again when the note is someone’s again, or the list changed', () => {
    expect(assignAnswer(VISIT, 409, 'author_active')).toEqual({
      go: `/encounters/${VISIT}?assign=author_active`,
    });
    for (const code of [
      'assignee_not_member',
      'assignee_cannot_chart',
      'credential_too_low',
      'cannot_see_all',
    ])
      expect(assignAnswer(VISIT, 422, code)).toEqual({ go: `/encounters/${VISIT}?assign=changed` });
    expect(assignAnswer(VISIT, 404, 'not_found')).toEqual({ go: `/encounters/${VISIT}` });
  });

  it('signs in again, or leaves a screen the role can’t use, as every page does', () => {
    expect(assignAnswer(VISIT, 401, 'unauthorized')).toEqual({ go: '/sign-in?ended=expired' });
    expect(assignAnswer(VISIT, 403, 'forbidden')).toEqual({ go: '/home?denied=1' });
  });

  it('keeps the form, with a sentence, for a request the API couldn’t take or a failure', () => {
    expect(assignAnswer(VISIT, 422, 'validation_failed')).toEqual({
      problem: 'Something about this request was wrong. Load the visit again.',
    });
    expect(assignAnswer(VISIT, 500, 'error')).toEqual({ problem: 'Something went wrong. Try again.' });
  });

  it('shows only the states it knows', () => {
    for (const s of ['done', 'reauthed', 'author_active', 'changed']) expect(assignedState(s)).toBe(s);
    expect(assignedState('constructor')).toBeNull();
    expect(assignedState(['done'])).toBeNull();
  });
});
