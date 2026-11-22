import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import { addBundleAction, saveBundleAction } from './presets-bundles';

// Adding a bundle and editing one (phase 5 design 4.4, 5.1, 7, 8.1), as the Bundles pages' forms
// send them. The API is a stand-in that records each request and answers it by its method: the
// list for a GET, `answer` for a write. Every value is made up.
const requests: { method: string; path: string; init: { params?: unknown; body?: unknown } }[] = [];
let answer: { status: number; body: unknown };
let listed: unknown[];
let pathname: string;
const revalidated: string[] = [];

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-pathname': pathname }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => void revalidated.push(path) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  api: async () => {
    const call = (method: string) => async (path: string, init: { params?: unknown; body?: unknown }) => {
      requests.push({ method, path, init });
      const { status, body } = method === 'GET' ? { status: 200, body: listed } : answer;
      const response = new Response(JSON.stringify(body), { status });
      return status < 300 ? { data: body, response } : { error: body, response };
    };
    return { GET: call('GET'), POST: call('POST'), PUT: call('PUT') };
  },
}));

const GAUZE = '30f10000-0000-4000-8000-000000000001';
const DOXY = '30f10000-0000-4000-8000-000000000002';
const WOUND = '30f10000-0000-4000-8000-000000000003';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const refusal = (status: number, code: string, details?: Record<string, unknown>) => ({
  status,
  body: { error: { code, message: 'The API’s words.', ...(details ? { details } : {}) } },
});

/** What the action answered its form, or where it sent the browser. */
async function run(
  action: (state: ActionState, form: FormData) => Promise<ActionState>,
  fields: Record<string, string>,
): Promise<{ state?: ActionState; to?: string }> {
  try {
    return { state: await action({}, form(fields)) };
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    if (!digest.startsWith('NEXT_REDIRECT')) throw err;
    return { to: digest.split(';')[2] };
  }
}

/** The body a write sent, as the client sends it: JSON, which holds no field for a value never given. */
const sentBody = (i = 0) =>
  JSON.parse(
    JSON.stringify((requests.filter((r) => r.method !== 'GET')[i]!.init.body as { body: unknown }).body),
  );

beforeEach(() => {
  requests.length = 0;
  revalidated.length = 0;
  listed = [];
  pathname = '/team/presets/bundles';
  answer = { status: 201, body: { id: WOUND, version: 1, revision: 8 } };
});

describe('adding a bundle', () => {
  const fields = {
    name: ' Demo: Wound care ',
    medical: 'true',
    'lines.count': '2',
    'lines.0.itemId': GAUZE,
    'lines.0.qty': '2',
    'lines.0.core': 'on',
    'lines.1.itemId': DOXY,
    'lines.1.qty': '1',
    prompt: ' Demo: Ask about allergies first. ',
    reason: 'Demo: what we give for a wound',
  };

  it('sends its name, tag, lines and prompt as typed, less the spaces around them, with the reason', async () => {
    const r = await run(addBundleAction, fields);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}',
        init: {
          params: { path: { kind: 'bundle' } },
          body: {
            body: {
              name: 'Demo: Wound care',
              medical: true,
              lines: [
                { itemId: GAUZE, qty: 2, core: true },
                { itemId: DOXY, qty: 1, core: false },
              ],
              prompt: 'Demo: Ask about allergies first.',
            },
            reason: 'Demo: what we give for a wound',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Added: Demo: Wound care. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual(['/team/presets/bundles']);
  });

  it('sends Non-Medical as false, and nothing for a tag none was chosen for, so the API answers there', async () => {
    await run(addBundleAction, { ...fields, medical: 'false' });
    expect(sentBody(0).medical).toBe(false);
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'medical', code: 'invalid_type' },
        { path: 'lines', code: 'too_small' },
      ],
    });
    const sent = { name: 'Demo: Wound care', 'lines.count': '0', reason: 'Demo: what we give for a wound' };
    const r = await run(addBundleAction, sent);
    expect(sentBody(1)).toEqual({ name: 'Demo: Wound care', lines: [], prompt: '' });
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: {
        medical: 'Medical or Non-Medical: Choose Medical or Non-Medical.',
        lines: 'Items: Give the bundle 1 to 40 items.',
      },
      values: sent,
    });
  });

  it('says each line’s problem beside it, a quantity as typed', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'lines.0.itemId', code: 'invalid_format' },
        { path: 'lines.0.qty', code: 'invalid_type' },
        { path: 'lines.1.itemId', code: 'item_twice' },
        { path: 'lines.1.qty', code: 'too_big' },
        { path: 'prompt', code: 'too_big' },
      ],
    });
    const r = await run(addBundleAction, {
      ...fields,
      'lines.0.itemId': '',
      'lines.0.qty': 'two',
      'lines.1.itemId': '',
      'lines.1.qty': '100',
    });
    expect(sentBody().lines).toEqual([
      { itemId: '', qty: 'two', core: true },
      { itemId: '', qty: 100, core: false },
    ]);
    expect(r.state?.fieldErrors).toEqual({
      'lines.0.itemId': 'Item on line 1: Choose one from the list.',
      'lines.0.qty': 'Quantity on line 1: Enter a whole number from 1 to 99.',
      'lines.1.itemId': 'Item on line 2: This item is on the list twice.',
      'lines.1.qty': 'Quantity on line 2: Enter a whole number from 1 to 99.',
      prompt: 'Ask before applying: Keep it to 300 characters.',
    });
  });

  it('says in 8.1’s words that a bundle holding a medication must be Medical, beside its tag', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'medical', code: 'bundle_not_medical' }] });
    const r = await run(addBundleAction, { ...fields, medical: 'false' });
    expect(r.state).toEqual({
      error: 'This bundle holds a medication, so it must be Medical.',
      fieldErrors: {
        medical: 'Medical or Non-Medical: This bundle holds a medication, so it must be Medical.',
      },
      values: { ...fields, medical: 'false' },
    });
  });

  it('says a name another bundle holds, and a removed item a line names', async () => {
    answer = refusal(409, 'name_taken');
    expect((await run(addBundleAction, fields)).state).toMatchObject({
      error: 'Another bundle already has this name.',
      fieldErrors: { name: 'Another bundle already has this name.' },
    });
    answer = refusal(409, 'reference_archived', {
      problems: [{ path: 'lines.1.itemId', code: 'reference_archived' }],
    });
    expect((await run(addBundleAction, fields)).state).toMatchObject({
      error: 'It names something that was removed. Choose another, or restore that one first.',
      fieldErrors: {
        'lines.1.itemId': 'Item on line 2: This was removed. Choose another, or restore it first.',
      },
    });
  });

  it('says a refused reason beside the Reason box', async () => {
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] });
    const r = await run(addBundleAction, { ...fields, reason: 'no' });
    expect(r.state?.fieldErrors).toEqual({ reason: 'Give a reason of 3 to 300 characters.' });
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(addBundleAction, fields)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fbundles');
    expect(revalidated).toEqual([]);
  });
});

describe('editing a bundle', () => {
  const now = {
    name: 'Demo: Wound care',
    medical: true,
    prompt: '',
    lines: [{ itemId: GAUZE, qty: 1, core: true }],
  };
  const row = (body: Record<string, unknown>, version = 2) => ({
    id: WOUND,
    name: body.name,
    state: 'active',
    version,
    customized: true,
    updateOnOffer: false,
    updateChangesFixed: false,
    update: null,
    referencedBy: {},
    body,
  });
  const fields = {
    id: WOUND,
    baseVersion: '2',
    name: 'Demo: Wound care ',
    medical: 'true',
    'lines.count': '2',
    'lines.0.itemId': GAUZE,
    'lines.0.qty': '3',
    'lines.0.core': 'on',
    'lines.1.itemId': DOXY,
    'lines.1.qty': '1',
    prompt: 'Demo: Ask how it happened.',
    reason: 'Demo: an antibiotic, if needed',
  };
  const writes = () => requests.filter((r) => r.method !== 'GET');

  beforeEach(() => {
    pathname = `/team/presets/bundles/${WOUND}`;
    listed = [row(now)];
    answer = { status: 200, body: { version: 3, revision: 9 } };
  });

  it('sends the bundle as the API holds it with the form’s fields over it, at the version shown', async () => {
    const r = await run(saveBundleAction, fields);
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'bundle', id: WOUND } },
          body: {
            baseVersion: 2,
            body: {
              name: 'Demo: Wound care',
              medical: true,
              prompt: 'Demo: Ask how it happened.',
              lines: [
                { itemId: GAUZE, qty: 3, core: true },
                { itemId: DOXY, qty: 1, core: false },
              ],
            },
            reason: 'Demo: an antibiotic, if needed',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: Demo: Wound care. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([`/team/presets/bundles/${WOUND}`, '/team/presets/bundles']);
  });

  it('keeps every field of the body the form doesn’t show', async () => {
    listed = [row({ ...now, icon: 'kit' })];
    await run(saveBundleAction, fields);
    expect(sentBody()).toMatchObject({ icon: 'kit', name: 'Demo: Wound care' });
  });

  it('says in 8.1’s words that a bundle holding a medication must be Medical, beside its tag', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'medical', code: 'bundle_not_medical' }] });
    const r = await run(saveBundleAction, { ...fields, medical: 'false' });
    expect(r.state?.error).toBe('This bundle holds a medication, so it must be Medical.');
    expect(r.state?.fieldErrors).toEqual({
      medical: 'Medical or Non-Medical: This bundle holds a medication, so it must be Medical.',
    });
    expect(revalidated).toEqual([]);
  });

  it('says someone else changed it, nothing was changed, or it was removed', async () => {
    answer = refusal(409, 'stale', { currentVersion: 3 });
    expect((await run(saveBundleAction, fields)).state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: fields,
    });
    answer = refusal(422, 'no_change');
    expect((await run(saveBundleAction, fields)).state?.error).toBe('You haven’t changed anything.');
    answer = refusal(409, 'archived');
    expect((await run(saveBundleAction, fields)).state?.error).toBe('This was removed. Restore it first.');
    expect(revalidated).toEqual([]);
  });

  it('says a bundle no longer on the list isn’t, and asks nothing more', async () => {
    listed = [];
    const r = await run(saveBundleAction, fields);
    expect(r.state?.error).toBe(
      'This isn’t on your team’s list. Reload the page to see the list as it is now.',
    );
    expect(writes()).toEqual([]);
  });

  it('asks nothing of the API for a form the page doesn’t write', async () => {
    for (const bad of [
      { ...fields, id: 'not-an-id' },
      { ...fields, baseVersion: '' },
      { ...fields, baseVersion: '-2' },
    ])
      expect((await run(saveBundleAction, bad)).state?.error).toBe('This can’t be found. Reload the page.');
    expect(requests).toEqual([]);
  });

  it('goes through /reauth and back to the bundle’s page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(saveBundleAction, fields)).to).toBe(
      `/reauth?next=${encodeURIComponent(`/team/presets/bundles/${WOUND}`)}`,
    );
  });
});
