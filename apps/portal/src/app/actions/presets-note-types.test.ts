import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import {
  addNoteTypeAction,
  removeNoteTypeAction,
  restoreNoteTypeAction,
  takeNoteTypeUpdateAction,
} from './presets-note-types';

// Note types' own acts (phase 5 design 5.4, 7, 8.1), as the list page's forms send them, written
// ahead of their code (card P4-tests): each fails until card P4-list-page builds the actions and
// their calls in lib/presets.ts. The API is a stand-in that records each request and answers it:
// the list for a GET, `answer` for a write. Every value is made up.
//
// The forms, as the page writes them, each field named as the API's body names it:
//   Add:         title, copyOf (a key to copy, or empty for a blank one), kinds (each of medical
//                and non_medical ticked, one entry each), group, reason
//   Remove:      key, baseVersion, reason
//   Restore:     key, reason
//   Take update: key, baseVersion, platformVersion, asNew ('true' or 'false'), reason
// A done act sends the browser back to /team/presets/note-types?done=<act>&noteType=<key>; a
// refusal another admin's Remove or Restore caused meanwhile (archived, not_archived) comes back as
// ?refused=<code>&noteType=<key>; anything else stays on the form with its sentence.
const requests: { method: string; path: string; init?: { params?: unknown; body?: unknown } }[] = [];
let answer: { status: number; body: unknown };
let listed: unknown[];
const revalidated: string[] = [];

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-pathname': '/team/presets/note-types' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => void revalidated.push(path) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  api: async () => {
    const call = (method: string) => async (path: string, init?: { params?: unknown; body?: unknown }) => {
      requests.push({ method, path, ...(init === undefined ? {} : { init }) });
      const { status, body } = method === 'GET' ? { status: 200, body: listed } : answer;
      const response = new Response(JSON.stringify(body), { status });
      return status < 300 ? { data: body, response } : { error: body, response };
    };
    return { GET: call('GET'), POST: call('POST'), PUT: call('PUT') };
  },
}));

const OWN = 't_00000000000a';
const PAGE = '/team/presets/note-types';

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) f.append(k, one);
  return f;
};

const refusal = (status: number, code: string, details?: Record<string, unknown>) => ({
  status,
  body: { error: { code, message: 'The API’s words.', ...(details ? { details } : {}) } },
});

/** What the action answered its form, or where it sent the browser. */
async function run(
  action: (state: ActionState, form: FormData) => Promise<ActionState>,
  fields: Record<string, string | string[]>,
): Promise<{ state?: ActionState; to?: string }> {
  try {
    return { state: await action({}, form(fields)) };
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    if (!digest.startsWith('NEXT_REDIRECT')) throw err;
    return { to: digest.split(';')[2] };
  }
}

const writes = () => requests.filter((r) => r.method !== 'GET');

beforeEach(() => {
  requests.length = 0;
  revalidated.length = 0;
  listed = [];
  answer = { status: 200, body: {} };
});

describe('adding a note type', () => {
  const blank = {
    title: '  Demo: Night outreach ',
    copyOf: '',
    kinds: ['non_medical'],
    group: 'outreach',
    reason: 'Demo: the night team asked',
  };

  it('sends a blank one with its title, kinds, timeline group and reason', async () => {
    answer = { status: 201, body: { key: OWN, version: 1 } };
    const r = await run(addNoteTypeAction, blank);
    expect(writes()).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/note-types',
        init: {
          body: {
            title: 'Demo: Night outreach',
            kinds: ['non_medical'],
            group: 'outreach',
            reason: 'Demo: the night team asked',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Added: Demo: Night outreach. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([PAGE]);
  });

  it('sends both kinds when both are ticked, Medical first', async () => {
    answer = { status: 201, body: { key: OWN, version: 1 } };
    await run(addNoteTypeAction, { ...blank, kinds: ['non_medical', 'medical'], group: 'clinical' });
    expect((writes()[0]!.init!.body as { kinds: string[] }).kinds).toEqual(['medical', 'non_medical']);
  });

  it('sends a copy with the note type it copies, and neither kinds nor a group: those are the copied one’s', async () => {
    answer = { status: 201, body: { key: OWN, version: 1 } };
    await run(addNoteTypeAction, { ...blank, copyOf: 'outreach' });
    expect(writes()[0]!.init!.body).toEqual({
      title: 'Demo: Night outreach',
      copyOf: 'outreach',
      reason: 'Demo: the night team asked',
    });
  });

  it('says a title another note type holds beside the title, keeping what was typed', async () => {
    answer = refusal(409, 'name_taken');
    const r = await run(addNoteTypeAction, blank);
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { title: 'Title: Another note type already has this name.' },
      values: {
        title: blank.title,
        copyOf: '',
        kinds: 'non_medical',
        group: 'outreach',
        reason: blank.reason,
      },
    });
    expect(revalidated).toEqual([]);
  });

  it('says why the quick encounter or the Red flags note can’t be copied, beside Copy of', async () => {
    answer = refusal(422, 'not_copyable');
    const r = await run(addNoteTypeAction, { ...blank, copyOf: 'quick_encounter' });
    expect(r.state?.fieldErrors).toEqual({
      copyOf:
        'Copy of: The quick encounter and the Red flags note can’t be copied. Choose another, or start a blank one.',
    });
  });

  it('says a note type no longer on the list isn’t', async () => {
    answer = refusal(404, 'not_found');
    expect((await run(addNoteTypeAction, { ...blank, copyOf: 'outreach' })).state?.error).toBe(
      'This isn’t on your team’s list. Reload the page to see the list as it is now.',
    );
  });

  it('says a refused reason beside the Reason box', async () => {
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] });
    const r = await run(addNoteTypeAction, { ...blank, reason: 'no' });
    expect(r.state?.fieldErrors).toEqual({ reason: 'Reason: Give a reason of 3 to 300 characters.' });
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(addNoteTypeAction, blank)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fnote-types');
  });
});

describe('removing and restoring a note type', () => {
  const remove = { key: OWN, baseVersion: '3', reason: 'Demo: no longer used' };

  it('removes it at the version shown and comes back to the page, saying so', async () => {
    answer = { status: 200, body: { revision: 12 } };
    const r = await run(removeNoteTypeAction, remove);
    expect(writes()).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/note-types/{key}/archive',
        init: { params: { path: { key: OWN } }, body: { baseVersion: 3, reason: 'Demo: no longer used' } },
      },
    ]);
    expect(r.to).toBe(`${PAGE}?done=removed&noteType=${OWN}`);
    expect(revalidated).toEqual([PAGE]);
  });

  it('says what still uses it, with the count, and keeps what was typed', async () => {
    answer = refusal(409, 'referenced', { referencedBy: { field_supply_map: 2 } });
    const r = await run(removeNoteTypeAction, remove);
    expect(r.state).toEqual({
      error: 'Still used by 2 mappings. Take it out of those first.',
      values: remove,
    });
  });

  it('says the Red flags note can’t be removed', async () => {
    answer = refusal(409, 'not_removable');
    expect((await run(removeNoteTypeAction, remove)).state?.error).toBe(
      'The Red flags note can’t be removed: a Medical note can’t be finished without it.',
    );
  });

  it('says someone else changed it, keeping what was typed', async () => {
    answer = refusal(409, 'stale', { currentVersion: 4 });
    expect((await run(removeNoteTypeAction, remove)).state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: remove,
    });
  });

  it('comes back to the page, saying so, when another admin removed it meanwhile', async () => {
    answer = refusal(409, 'archived');
    expect((await run(removeNoteTypeAction, remove)).to).toBe(`${PAGE}?refused=archived&noteType=${OWN}`);
  });

  it('restores it and comes back to the page, saying so', async () => {
    answer = { status: 200, body: { revision: 13 } };
    const r = await run(restoreNoteTypeAction, { key: OWN, reason: 'Demo: wanted back' });
    expect(writes()).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/note-types/{key}/restore',
        init: { params: { path: { key: OWN } }, body: { reason: 'Demo: wanted back' } },
      },
    ]);
    expect(r.to).toBe(`${PAGE}?done=restored&noteType=${OWN}`);
  });

  it('says a title another note type took meanwhile', async () => {
    answer = refusal(409, 'name_taken');
    expect((await run(restoreNoteTypeAction, { key: OWN, reason: 'Demo: wanted back' })).state?.error).toBe(
      'Another note type has this name now. Rename that one first.',
    );
  });

  it('asks nothing of the API for a form the page doesn’t write', async () => {
    for (const bad of [
      { ...remove, key: 'Not A Key' },
      { ...remove, key: '' },
      { ...remove, baseVersion: '' },
      { ...remove, baseVersion: '0' },
    ])
      expect((await run(removeNoteTypeAction, bad)).state?.error).toBe(
        'This can’t be found. Reload the page.',
      );
    expect((await run(restoreNoteTypeAction, { key: '../x', reason: 'Demo: x' })).state?.error).toBe(
      'This can’t be found. Reload the page.',
    );
    expect(requests).toEqual([]);
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(removeNoteTypeAction, remove)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fnote-types');
  });
});

describe('taking Sineobex’s update to a note type', () => {
  const take = {
    key: 'psychological',
    baseVersion: '2',
    platformVersion: '2',
    asNew: 'false',
    reason: 'Demo: take it',
  };

  it('takes it in place, sending back the version shown and the platform version reviewed', async () => {
    answer = { status: 200, body: { key: 'psychological', version: 3, revision: 14 } };
    const r = await run(takeNoteTypeUpdateAction, take);
    expect(writes()).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/note-types/{key}/take-update',
        init: {
          params: { path: { key: 'psychological' } },
          body: { baseVersion: 2, platformVersion: 2, asNew: false, reason: 'Demo: take it' },
        },
      },
    ]);
    expect(r.to).toBe(`${PAGE}?done=updated&noteType=psychological`);
  });

  it('takes it as a new note type, and says so of the new one', async () => {
    answer = { status: 200, body: { key: OWN, version: 1, revision: 15 } };
    const r = await run(takeNoteTypeUpdateAction, { ...take, asNew: 'true' });
    expect((writes()[0]!.init!.body as { asNew: boolean }).asNew).toBe(true);
    expect(r.to).toBe(`${PAGE}?done=added&noteType=${OWN}`);
  });

  it('says an update that changes what can’t be changed in place is taken only as a new one', async () => {
    answer = refusal(409, 'fixed_field', { fields: ['group'] });
    expect((await run(takeNoteTypeUpdateAction, take)).state?.error).toBe(
      'This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.',
    );
  });

  it('says a newer version came on offer since the review, and reads the page again so the review shows it', async () => {
    answer = refusal(409, 'stale', { currentVersion: 2, platformVersion: 3 });
    const r = await run(takeNoteTypeUpdateAction, take);
    expect(r.state?.error).toBe(
      'Sineobex offered a newer version while you were reviewing this one. Review it below before you take it.',
    );
    expect(revalidated).toEqual([PAGE]);
    // Its next take sends the versions the review now shows, not the ones it sent.
    expect(r.state?.values).toEqual({ key: 'psychological', asNew: 'false', reason: 'Demo: take it' });
  });

  it('asks nothing of the API for a take the page doesn’t write', async () => {
    for (const bad of [
      { ...take, asNew: 'maybe' },
      { ...take, platformVersion: 'x' },
      { ...take, key: 'Bad Key' },
    ])
      expect((await run(takeNoteTypeUpdateAction, bad)).state?.error).toBe(
        'This can’t be found. Reload the page.',
      );
    expect(requests).toEqual([]);
  });
});
