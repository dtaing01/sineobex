import { describe, expect, it } from 'vitest';
import { publishAnswer, publishRequest } from './answer';

// What the editor's Publish posts and is told (phase 5 design 8.1; D115), written ahead of its code
// (card P4-tests): both fail until card P4-editor builds them. The route handler posts the request
// to PUT /v1/admin/note-types/{key} and answers the editor what publishAnswer says. Every value is
// made up.

const KEY = 't_00000000000c';

describe('what Publish posts', () => {
  it('takes the version the editor opened, the operations it held and the reason', () => {
    const body = {
      baseVersion: 3,
      ops: [{ op: 'rename_label', path: 'notes.notes', label: 'Demo: What was said' }],
      reason: 'Demo: plainer words',
    };
    expect(publishRequest(body)).toEqual(body);
  });

  it('refuses anything the editor never posts', () => {
    for (const body of [
      null,
      'publish',
      { baseVersion: '3', ops: [], reason: 'Demo: x' },
      { baseVersion: 0, ops: [], reason: 'Demo: x' },
      { baseVersion: 3, ops: 'rename', reason: 'Demo: x' },
      { baseVersion: 3, ops: [{ label: 'no op' }], reason: 'Demo: x' },
      { baseVersion: 3, ops: [] },
    ])
      expect(publishRequest(body), JSON.stringify(body)).toBeNull();
  });
});

describe('what Publish is told', () => {
  it('says the version is live and that notes already started stay on theirs', () => {
    expect(publishAnswer(KEY, { published: { version: 4, alsoPublished: [] } })).toEqual({
      ok: true,
      version: 4,
      alsoPublished: [],
      message: 'Version 4 is live. Notes already started stay on the version they began on.',
    });
  });

  it('says a part that can’t be changed is protected, naming the operation', () => {
    expect(
      publishAnswer(KEY, { refused: { status: 422, code: 'protected', details: { opIndex: 2 } } }),
    ).toEqual({
      ok: false,
      error: 'This part can’t be changed.',
      opIndex: 2,
    });
  });

  it('says a section from a type for other visits or readers can’t be copied', () => {
    expect(
      publishAnswer(KEY, { refused: { status: 422, code: 'not_copyable', details: { opIndex: 0 } } }),
    ).toEqual({
      ok: false,
      error:
        'This section comes from a note type for other visits or other readers, so it can’t be copied here.',
      opIndex: 0,
    });
  });

  it('says someone else changed it, so the editor keeps what it holds', () => {
    expect(
      publishAnswer(KEY, { refused: { status: 409, code: 'stale', details: { currentVersion: 5 } } }),
    ).toEqual({
      ok: false,
      error: 'Someone else changed this while you were editing. Reload to see their version.',
    });
  });

  it('sends a stale sign-in to /reauth and back to the editor', () => {
    expect(publishAnswer(KEY, { refused: { status: 403, code: 'reauth_required' } })).toEqual({
      ok: false,
      redirect: `/reauth?next=${encodeURIComponent(`/team/presets/note-types/${KEY}`)}`,
    });
  });

  it('says a refused reason beside the Reason box', () => {
    expect(
      publishAnswer(KEY, {
        refused: {
          status: 422,
          code: 'validation_failed',
          details: { fields: [{ path: 'reason', problem: 'too_small' }] },
        },
      }),
    ).toEqual({
      ok: false,
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { reason: 'Reason: Give a reason of 3 to 300 characters.' },
    });
  });

  it('names the change a number typed as words is in, by its place', () => {
    expect(
      publishAnswer(KEY, {
        refused: {
          status: 422,
          code: 'validation_failed',
          details: { fields: [{ path: 'ops.2.fields.0.min', problem: 'invalid_type' }] },
        },
      }),
    ).toEqual({ ok: false, error: 'Enter numbers for the lowest and highest it takes.', opIndex: 2 });
  });

  it('says each operation’s refusal beside it, and names another note type a reached field is in', () => {
    const said = (code: string, details: Record<string, unknown> = { opIndex: 1 }) =>
      publishAnswer(KEY, { refused: { status: 422, code, details } });
    for (const code of [
      'in_use',
      'not_found',
      'title_invalid',
      'label_invalid',
      'last_option',
      'last_field',
      'last_section',
      'too_many_fields',
      'too_many_sections',
      'id_taken',
      'invalid',
    ]) {
      const answer = said(code);
      expect(answer, code).toMatchObject({ ok: false, opIndex: 1 });
      expect((answer as { error: string }).error, code).not.toBe('This change can’t be made.');
    }
    expect(said('protected', { opIndex: 0, noteTypeKey: 'wound_care' })).toEqual({
      ok: false,
      error: 'This part can’t be changed.',
      opIndex: 0,
      noteTypeKey: 'wound_care',
    });
  });

  it('says a publish of a removed note type, of nothing, and one its checks refuse, without naming a change', () => {
    const said = (status: number, code: string) => publishAnswer(KEY, { refused: { status, code } });
    expect(said(409, 'archived')).toMatchObject({ ok: false, error: expect.stringContaining('removed') });
    expect(said(422, 'no_change')).toMatchObject({
      ok: false,
      error: expect.stringContaining('nothing to publish'),
    });
    expect(said(422, 'invalid')).toMatchObject({
      ok: false,
      error: expect.stringContaining('wasn’t published'),
    });
    expect(said(401, 'unauthorized')).toEqual({ ok: false, redirect: '/sign-in?ended=expired' });
  });
});
