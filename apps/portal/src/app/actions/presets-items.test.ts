import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import { addItemAction, saveItemAction } from './presets-items';

// Adding an item and editing one (phase 5 design 4.4, 5.1, 7, 8.1), as the Items pages' forms send
// them. The API is a stand-in that records each request and answers it by its method: the list
// for a GET, `answer` for a write. Every value is made up.
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

const LABS = '30f00000-0000-4000-8000-000000000001';
const SUPPLIES = '30f00000-0000-4000-8000-000000000002';
const STREP = '30f00000-0000-4000-8000-000000000003';

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
  pathname = '/team/presets/items';
  answer = { status: 201, body: { id: STREP, version: 1, revision: 8 } };
});

describe('adding an item', () => {
  const fields = {
    name: ' Demo: Rain poncho ',
    categoryId: SUPPLIES,
    unit: ' each ',
    'result.type': 'none',
    reason: 'Demo: ponchos for the rain',
  };

  it('sends what was typed, less the spaces around it, ticks as true or false, and no result', async () => {
    const r = await run(addItemAction, { ...fields, captureLot: 'on' });
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}',
        init: {
          params: { path: { kind: 'item' } },
          body: {
            body: {
              name: 'Demo: Rain poncho',
              categoryId: SUPPLIES,
              medical: false,
              captureLot: true,
              unit: 'each',
              result: null,
            },
            reason: 'Demo: ponchos for the rain',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Added: Demo: Rain poncho. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual(['/team/presets/items']);
  });

  it('sends a test’s result: a choice from the options typed, in order, or a number in its unit', async () => {
    const test = { ...fields, name: 'Demo: Strep test', categoryId: LABS, unit: 'test', medical: 'on' };
    await run(addItemAction, {
      ...test,
      'result.type': 'choice',
      'result.options.count': '2',
      'result.options.0': ' Positive',
      'result.options.1': 'Negative ',
    });
    expect(sentBody(0)).toMatchObject({
      medical: true,
      result: { type: 'choice', options: ['Positive', 'Negative'] },
    });
    await run(addItemAction, { ...test, 'result.type': 'number', 'result.unit': ' mg/dL ' });
    expect(sentBody(1)).toMatchObject({ result: { type: 'number', unit: 'mg/dL' } });
  });

  it('sends nothing for a result when none was chosen, and nothing for a category, so the API answers there', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'categoryId', code: 'invalid_format' },
        { path: 'result', code: 'invalid_type' },
      ],
    });
    const sent = { name: 'Demo: Rain poncho', unit: 'each', reason: 'Demo: ponchos for the rain' };
    const r = await run(addItemAction, sent);
    expect(sentBody()).toEqual({
      name: 'Demo: Rain poncho',
      categoryId: '',
      medical: false,
      captureLot: false,
      unit: 'each',
    });
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { categoryId: 'Category: Choose one from the list.', result: 'Result: Check this.' },
      values: sent,
    });
    expect(revalidated).toEqual([]);
  });

  it('says each problem beside its field, an option’s by its place, keeping what was typed', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'name', code: 'too_small' },
        { path: 'unit', code: 'too_big' },
        { path: 'result.options', code: 'too_small' },
        { path: 'result.options.1', code: 'option_twice' },
        { path: 'result.options.2', code: 'too_big' },
        { path: 'result.unit', code: 'too_small' },
      ],
    });
    const r = await run(addItemAction, { ...fields, name: '' });
    expect(r.state?.fieldErrors).toEqual({
      name: 'Name: Enter a name of 1 to 80 characters.',
      unit: 'Counted in: Enter 1 to 20 characters, such as tablet or packet.',
      'result.options': 'Options: Give 2 to 12 options.',
      'result.options.1': 'Option 2: This option is on the list twice.',
      'result.options.2': 'Option 3: Enter 1 to 40 characters.',
      'result.unit': 'Unit of the result: Enter 1 to 20 characters, such as mg/dL.',
    });
    expect(r.state?.values).toEqual({ ...fields, name: '' });
  });

  it('says what validatePreset refuses: a result on what isn’t a test, a medication that isn’t Medical', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'result', code: 'result_mismatch' },
        { path: 'medical', code: 'medical_mismatch' },
      ],
    });
    expect((await run(addItemAction, fields)).state?.fieldErrors).toEqual({
      result: 'Result: An item records a result exactly when its category holds tests.',
      medical: 'Medical: An item in a category that holds medications or tests is always Medical.',
    });
  });

  it('says a name another item holds beside the name, and a removed category', async () => {
    answer = refusal(409, 'name_taken');
    const taken = await run(addItemAction, { ...fields, name: 'gauze' });
    expect(taken.state).toMatchObject({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { name: 'Name: Another item already has this name.' },
    });
    answer = refusal(409, 'reference_archived', {
      problems: [{ path: 'categoryId', code: 'reference_archived' }],
    });
    expect((await run(addItemAction, fields)).state).toMatchObject({
      error: 'It names something that was removed. Choose another, or restore that one first.',
      fieldErrors: { categoryId: 'Category: This was removed. Choose another, or restore it first.' },
    });
  });

  it('says a refused reason beside the Reason box', async () => {
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] });
    const r = await run(addItemAction, { ...fields, reason: 'no' });
    expect(r.state?.error).toBe('Some fields need changing. Check each one below.');
    expect(r.state?.fieldErrors).toEqual({ reason: 'Reason: Give a reason of 3 to 300 characters.' });
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(addItemAction, fields)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fitems');
    expect(revalidated).toEqual([]);
  });
});

describe('editing an item', () => {
  const SOCKS = '30f00000-0000-4000-8000-000000000004';
  const row = (body: Record<string, unknown>, version = 2) => ({
    id: SOCKS,
    name: body.name,
    state: 'active',
    version,
    customized: true,
    updateOnOffer: false,
    updateChangesFixed: false,
    update: null,
    referencedBy: { bundle: 1 },
    body,
  });
  const socks = {
    name: 'Demo: Wool socks',
    categoryId: SUPPLIES,
    unit: 'pair',
    medical: false,
    captureLot: false,
    result: null,
  };
  const fields = {
    id: SOCKS,
    baseVersion: '2',
    name: 'Demo: Warm socks ',
    categoryId: SUPPLIES,
    captureLot: 'on',
    reason: 'Demo: we record the lot now',
  };
  const writes = () => requests.filter((r) => r.method !== 'GET');

  beforeEach(() => {
    pathname = `/team/presets/items/${SOCKS}`;
    listed = [row(socks)];
    answer = { status: 200, body: { version: 3, revision: 9 } };
  });

  it('sends the item as the API holds it with the form’s fields over it, at the version shown', async () => {
    const r = await run(saveItemAction, fields);
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'item', id: SOCKS } },
          body: {
            baseVersion: 2,
            // What it is counted in, and that it records no result, are the API's: fixed (4.4).
            body: { ...socks, name: 'Demo: Warm socks', captureLot: true },
            reason: 'Demo: we record the lot now',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: Demo: Warm socks. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([`/team/presets/items/${SOCKS}`, '/team/presets/items']);
  });

  it('keeps every field of the body the form doesn’t show, and never what it is counted in from the form', async () => {
    listed = [row({ ...socks, icon: 'sock' })];
    await run(saveItemAction, { ...fields, unit: 'dozen' });
    expect(sentBody()).toEqual({ ...socks, name: 'Demo: Warm socks', captureLot: true, icon: 'sock' });
  });

  it('sends a test’s options or a number’s unit as typed, the kind of result the API’s', async () => {
    listed = [
      row({
        ...socks,
        categoryId: LABS,
        medical: true,
        result: { type: 'choice', options: ['Positive', 'Negative'] },
      }),
    ];
    await run(saveItemAction, {
      ...fields,
      categoryId: LABS,
      medical: 'on',
      'result.type': 'number',
      'result.options.count': '3',
      'result.options.0': 'Positive',
      'result.options.1': ' Negative',
      'result.options.2': 'Unclear ',
    });
    expect(sentBody(0).result).toEqual({ type: 'choice', options: ['Positive', 'Negative', 'Unclear'] });
    listed = [row({ ...socks, categoryId: LABS, medical: true, result: { type: 'number', unit: 'mg/dL' } })];
    await run(saveItemAction, { ...fields, categoryId: LABS, medical: 'on', 'result.unit': ' mmol/L ' });
    expect(sentBody(1).result).toEqual({ type: 'number', unit: 'mmol/L' });
    // A form that sent none of them leaves the result as it is.
    await run(saveItemAction, { ...fields, categoryId: LABS, medical: 'on' });
    expect(sentBody(2).result).toEqual({ type: 'number', unit: 'mg/dL' });
  });

  it('says in 8.1’s words that Non-Medical bundles hold an item moved into a medication category', async () => {
    answer = refusal(409, 'bundle_not_medical', { bundles: 1 });
    const r = await run(saveItemAction, { ...fields, categoryId: LABS, medical: 'on' });
    expect(r.state).toEqual({
      error:
        'Non-Medical bundles hold this item, and a bundle that holds a medication must be Medical. Make them Medical first.',
      values: { ...fields, categoryId: LABS, medical: 'on' },
    });
    expect(revalidated).toEqual([]);
  });

  it('says a move into or out of Labs beside the result it would change', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'result', code: 'result_mismatch' }] });
    expect((await run(saveItemAction, { ...fields, categoryId: LABS })).state?.fieldErrors).toEqual({
      result: 'Result: An item records a result exactly when its category holds tests.',
    });
  });

  it('says someone else changed it, keeps what was typed, and leaves the page as it is', async () => {
    answer = refusal(409, 'stale', { currentVersion: 3 });
    const r = await run(saveItemAction, fields);
    expect(r.state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: fields,
    });
    expect(revalidated).toEqual([]);
  });

  it('says nothing was changed, and a removed item was removed', async () => {
    answer = refusal(422, 'no_change');
    expect((await run(saveItemAction, fields)).state?.error).toBe('You haven’t changed anything.');
    // Removed by another admin meanwhile: its page, read again, draws it removed, so the save comes
    // back to its page, which says so.
    answer = refusal(409, 'archived');
    expect((await run(saveItemAction, fields)).to).toBe(
      `/team/presets/items/${SOCKS}?refused=archived&preset=${SOCKS}`,
    );
  });

  it('says an item no longer on the list isn’t, and asks nothing more', async () => {
    listed = [];
    const r = await run(saveItemAction, fields);
    expect(r.state?.error).toBe(
      'This isn’t on your team’s list. Reload the page to see the list as it is now.',
    );
    expect(writes()).toEqual([]);
  });

  it('asks nothing of the API for a form the page doesn’t write', async () => {
    for (const bad of [
      { ...fields, id: 'not-an-id' },
      { ...fields, baseVersion: '' },
      { ...fields, baseVersion: '1.5' },
    ])
      expect((await run(saveItemAction, bad)).state?.error).toBe('This can’t be found. Reload the page.');
    expect(requests).toEqual([]);
  });

  it('goes through /reauth and back to the item’s page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(saveItemAction, fields)).to).toBe(
      `/reauth?next=${encodeURIComponent(`/team/presets/items/${SOCKS}`)}`,
    );
  });
});
