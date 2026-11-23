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
});
