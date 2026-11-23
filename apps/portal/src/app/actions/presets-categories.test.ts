import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import { addCategoryAction, saveCategoryAction } from './presets-categories';

// Adding a category and editing one (phase 5 design 4.4, 5.1, 7, 8.1), as the page's forms send
// them. The API is a stand-in that records each request and answers it by its method: the list
// for a GET, `answer` for a write. Every value is made up.
const requests: { method: string; path: string; init: { params?: unknown; body?: unknown } }[] = [];
let answer: { status: number; body: unknown };
let listed: unknown[];
const revalidated: string[] = [];

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-pathname': '/team/presets/categories' }),
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

const OTC = '30c00000-0000-4000-8000-000000000001';
const OWN = '30c00000-0000-4000-8000-000000000002';

const row = (id: string, body: Record<string, unknown>, version = 1) => ({
  id,
  name: body.name,
  state: 'active',
  version,
  customized: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  body,
});

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

const writes = () => requests.filter((r) => r.method !== 'GET');

beforeEach(() => {
  requests.length = 0;
  revalidated.length = 0;
  listed = [
    row(OTC, { name: 'OTC', behaviour: 'medication', sort: 10 }, 1),
    row(OWN, { name: 'Demo: Hygiene kits', behaviour: 'supply', sort: 50 }, 2),
  ];
  answer = { status: 200, body: {} };
});

describe('adding a category', () => {
  const fields = {
    name: '  Demo: Foot care ',
    behaviour: 'supply',
    sort: '60',
    reason: 'Demo: kits for feet',
  };

  it('sends the name without the spaces around it, what it holds and its place, with the reason', async () => {
    answer = { status: 201, body: { id: OWN, version: 1, revision: 8 } };
    const r = await run(addCategoryAction, fields);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}',
        init: {
          params: { path: { kind: 'order_category' } },
          body: {
            body: { name: 'Demo: Foot care', behaviour: 'supply', sort: 60 },
            reason: 'Demo: kits for feet',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Added: Demo: Foot care. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual(['/team/presets/categories']);
  });

  it('sends nothing for what it holds when nothing was chosen, so the API answers there', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'name', code: 'too_small' },
        { path: 'behaviour', code: 'invalid_value' },
      ],
    });
    const sent = { name: '', sort: '60', reason: 'Demo: kits for feet' };
    const r = await run(addCategoryAction, sent);
    // As the client sends it: JSON, which holds no field for a value never given.
    const body = (requests[0]!.init.body as { body: Record<string, unknown> }).body;
    expect(JSON.parse(JSON.stringify(body))).toEqual({ name: '', sort: 60 });
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { name: 'Name: This is too short or too small.', behaviour: 'Choose what it holds.' },
      values: sent,
    });
    expect(revalidated).toEqual([]);
  });

  it('says a name another category holds beside the name, keeping what was typed', async () => {
    answer = refusal(409, 'name_taken');
    const r = await run(addCategoryAction, { ...fields, name: 'otc' });
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { name: 'Name: Another category already has this name.' },
      values: { ...fields, name: 'otc' },
    });
  });

  it('says a refused reason beside the Reason box', async () => {
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] });
    const r = await run(addCategoryAction, { ...fields, reason: 'no' });
    expect(r.state?.error).toBe('Some fields need changing. Check each one below.');
    expect(r.state?.fieldErrors).toEqual({ reason: 'Reason: Give a reason of 3 to 300 characters.' });
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(addCategoryAction, fields)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fcategories');
    expect(revalidated).toEqual([]);
  });
});

describe('editing a category', () => {
  const fields = {
    id: OWN,
    baseVersion: '2',
    name: 'Demo: Hygiene ',
    sort: '15',
    reason: 'Demo: first on the list',
  };

  it('sends the category as the API holds it with the form’s name and place, at the version shown', async () => {
    answer = { status: 200, body: { version: 3, revision: 9 } };
    const r = await run(saveCategoryAction, fields);
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'order_category', id: OWN } },
          body: {
            baseVersion: 2,
            // What it holds is the API's, never the form's: it can't be changed (4.4).
            body: { name: 'Demo: Hygiene', behaviour: 'supply', sort: 15 },
            reason: 'Demo: first on the list',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: Demo: Hygiene. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual(['/team/presets/categories']);
  });

  it('keeps every field of the body the form doesn’t show', async () => {
    listed = [row(OWN, { name: 'Demo: Hygiene kits', behaviour: 'supply', sort: 50, icon: 'kit' }, 2)];
    await run(saveCategoryAction, fields);
    expect((writes()[0]!.init.body as { body: unknown }).body).toEqual({
      name: 'Demo: Hygiene',
      behaviour: 'supply',
      sort: 15,
      icon: 'kit',
    });
  });

  it('sends a place that isn’t a whole number as typed, and says what the place must be', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'sort', code: 'invalid_type' }] });
    const r = await run(saveCategoryAction, { ...fields, sort: 'first' });
    expect((writes()[0]!.init.body as { body: { sort: unknown } }).body.sort).toBe('first');
    expect(r.state?.fieldErrors).toEqual({
      sort: 'Place in the list: Enter a whole number from 0 to 1,000,000.',
    });
  });

  it('says someone else changed it, keeps what was typed, and leaves the page as it is', async () => {
    answer = refusal(409, 'stale', { currentVersion: 3 });
    const r = await run(saveCategoryAction, fields);
    expect(r.state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: fields,
    });
    expect(revalidated).toEqual([]);
  });

  it('says nothing was changed', async () => {
    answer = refusal(422, 'no_change');
    expect((await run(saveCategoryAction, fields)).state?.error).toBe('You haven’t changed anything.');
  });

  it('says a category no longer on the list isn’t, and asks nothing more', async () => {
    listed = [row(OTC, { name: 'OTC', behaviour: 'medication', sort: 10 })];
    const r = await run(saveCategoryAction, fields);
    expect(r.state?.error).toBe(
      'This isn’t on your team’s list. Reload the page to see the list as it is now.',
    );
    expect(writes()).toEqual([]);
  });

  it('asks nothing of the API for a form the page doesn’t write', async () => {
    for (const bad of [
      { ...fields, id: 'not-an-id' },
      { ...fields, baseVersion: '' },
      { ...fields, baseVersion: '0' },
    ])
      expect((await run(saveCategoryAction, bad)).state?.error).toBe('This can’t be found. Reload the page.');
    expect(requests).toEqual([]);
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(saveCategoryAction, fields)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fcategories');
  });
});
