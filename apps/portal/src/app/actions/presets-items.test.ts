import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import { addItemAction } from './presets-items';

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
      name: 'Name: This is too short or too small.',
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
      error: 'Another item already has this name.',
      fieldErrors: { name: 'Another item already has this name.' },
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
    expect(r.state?.error).toBe('Give a reason of 3 to 300 characters.');
    expect(r.state?.fieldErrors).toEqual({ reason: 'Give a reason of 3 to 300 characters.' });
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(addItemAction, fields)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fitems');
    expect(revalidated).toEqual([]);
  });
});
