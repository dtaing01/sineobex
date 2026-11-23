import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import { addBagAction, saveBagAction, saveBagTemplateAction, switchBagMinimumsAction } from './presets-bags';

// Bag minimums' own forms (phase 5 design 4.4, 5.1, 7, 8.1) as the page sends them: a bag added or
// edited, and the team's switch and template for new bags, each an edit of the team's settings.
// The API is a stand-in that records each request and answers it by its method: the list for a
// GET, `answer` for a write. Every value is made up.
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

const GAUZE = '30b10000-0000-4000-8000-000000000001';
const SOCKS = '30b10000-0000-4000-8000-000000000002';
const BAG = '30b10000-0000-4000-8000-000000000003';
const OTHER = '30b10000-0000-4000-8000-000000000004';
const SETTINGS = '30b10000-0000-4000-8000-000000000005';
const PAGE = '/team/presets/bag-minimums';

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

/** The body a write sent, as the client sends it: JSON, which holds no field for a value never given. */
const sentBody = (i = 0) => JSON.parse(JSON.stringify((writes()[i]!.init.body as { body: unknown }).body));

const row = (id: string, body: Record<string, unknown>, version = 2) => ({
  id,
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

const SETTINGS_NOW = {
  name: 'Team settings',
  bagMinimumsOn: false,
  newBagMinimums: [{ itemId: GAUZE, min: 10 }],
  problemCheckDays: 60,
};

beforeEach(() => {
  requests.length = 0;
  revalidated.length = 0;
  listed = [];
  pathname = PAGE;
  answer = { status: 201, body: { id: BAG, version: 1, revision: 8 } };
});

describe('adding a bag', () => {
  const fields = {
    name: ' Demo: Foot care bag ',
    copyFrom: OTHER,
    'minimums.count': '2',
    'minimums.0.itemId': GAUZE,
    'minimums.0.min': '20',
    'minimums.1.itemId': SOCKS,
    'minimums.1.min': '12',
    reason: 'Demo: a bag for foot care',
  };

  it('sends its name and the minimums the form holds, whatever filled them, with the reason', async () => {
    const r = await run(addBagAction, fields);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}',
        init: {
          params: { path: { kind: 'bag' } },
          body: {
            body: {
              name: 'Demo: Foot care bag',
              minimums: [
                { itemId: GAUZE, min: 20 },
                { itemId: SOCKS, min: 12 },
              ],
            },
            reason: 'Demo: a bag for foot care',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Added: Demo: Foot care bag. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([PAGE]);
  });

  it('adds a bag with no minimums, as the API allows', async () => {
    await run(addBagAction, { name: 'Demo: Spare bag', 'minimums.count': '0', reason: 'Demo: a spare' });
    expect(sentBody()).toEqual({ name: 'Demo: Spare bag', minimums: [] });
  });

  it('says each line’s problem beside it, a minimum as typed, and an item twice on the later line', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'name', code: 'too_small' },
        { path: 'minimums.0.min', code: 'invalid_type' },
        { path: 'minimums.1.itemId', code: 'item_twice' },
        { path: 'minimums.1.min', code: 'too_big' },
      ],
    });
    const sent = {
      ...fields,
      name: '',
      'minimums.0.min': 'twenty',
      'minimums.1.itemId': GAUZE,
      'minimums.1.min': '1000',
    };
    const r = await run(addBagAction, sent);
    expect(sentBody().minimums).toEqual([
      { itemId: GAUZE, min: 'twenty' },
      { itemId: GAUZE, min: 1000 },
    ]);
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: {
        name: 'Name: Enter a name of 1 to 80 characters.',
        'minimums.0.min': 'Minimum on line 1: Enter a whole number from 1 to 999.',
        'minimums.1.itemId': 'Item on line 2: This item is on the list twice.',
        'minimums.1.min': 'Minimum on line 2: Enter a whole number from 1 to 999.',
      },
      values: sent,
    });
    expect(revalidated).toEqual([]);
  });

  it('says a list of too many minimums, a name another bag holds, and a removed item a line names', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'minimums', code: 'too_big' }] });
    expect((await run(addBagAction, fields)).state?.fieldErrors).toEqual({
      minimums: 'Minimums: Give at most 200 minimums.',
    });
    answer = refusal(409, 'name_taken');
    expect((await run(addBagAction, fields)).state).toMatchObject({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { name: 'Name: Another bag already has this name.' },
    });
    answer = refusal(409, 'reference_archived', {
      problems: [{ path: 'minimums.0.itemId', code: 'reference_archived' }],
    });
    expect((await run(addBagAction, fields)).state).toMatchObject({
      error: 'It names something that was removed. Choose another, or restore that one first.',
      fieldErrors: {
        'minimums.0.itemId': 'Item on line 1: This was removed. Choose another, or restore it first.',
      },
    });
  });

  it('says a refused reason beside the Reason box', async () => {
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] });
    const r = await run(addBagAction, { ...fields, reason: 'no' });
    expect(r.state?.fieldErrors).toEqual({ reason: 'Reason: Give a reason of 3 to 300 characters.' });
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(addBagAction, fields)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fbag-minimums');
    expect(revalidated).toEqual([]);
  });
});

describe('editing a bag', () => {
  const now = { name: 'Demo: Outreach bag', minimums: [{ itemId: GAUZE, min: 20 }] };
  const fields = {
    id: BAG,
    baseVersion: '2',
    name: 'Demo: Outreach backpack ',
    'minimums.count': '2',
    'minimums.0.itemId': GAUZE,
    'minimums.0.min': '25',
    'minimums.1.itemId': SOCKS,
    'minimums.1.min': '10',
    reason: 'Demo: socks for winter',
  };

  beforeEach(() => {
    listed = [row(BAG, now)];
    answer = { status: 200, body: { version: 3, revision: 9 } };
  });

  it('sends the bag as the API holds it with the form’s fields over it, at the version shown', async () => {
    const r = await run(saveBagAction, fields);
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'bag', id: BAG } },
          body: {
            baseVersion: 2,
            body: {
              name: 'Demo: Outreach backpack',
              minimums: [
                { itemId: GAUZE, min: 25 },
                { itemId: SOCKS, min: 10 },
              ],
            },
            reason: 'Demo: socks for winter',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: Demo: Outreach backpack. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([PAGE]);
  });

  it('keeps every field of the body the form doesn’t show', async () => {
    listed = [row(BAG, { ...now, owner: 'Demo: a later phase’s field' })];
    await run(saveBagAction, fields);
    expect(sentBody()).toMatchObject({
      owner: 'Demo: a later phase’s field',
      name: 'Demo: Outreach backpack',
    });
  });

  it('says someone else changed it, nothing was changed, or it was removed, and reads nothing again', async () => {
    answer = refusal(409, 'stale', { currentVersion: 3 });
    expect((await run(saveBagAction, fields)).state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: fields,
    });
    answer = refusal(422, 'no_change');
    expect((await run(saveBagAction, fields)).state?.error).toBe('You haven’t changed anything.');
    expect(revalidated).toEqual([]);
    // Removed by another admin meanwhile: the page, read again, draws it removed, so the save
    // comes back to the page, which says so.
    answer = refusal(409, 'archived');
    expect((await run(saveBagAction, fields)).to).toBe(`${PAGE}?refused=archived&preset=${BAG}`);
    expect(revalidated).toEqual([PAGE]);
  });

  it('says a bag no longer on the list isn’t, and asks nothing more', async () => {
    listed = [];
    const r = await run(saveBagAction, fields);
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
      expect((await run(saveBagAction, bad)).state?.error).toBe('This can’t be found. Reload the page.');
    expect(requests).toEqual([]);
  });
});

describe('the team’s switch', () => {
  const fields = { id: SETTINGS, baseVersion: '5', bagMinimumsOn: 'true', reason: 'Demo: remind us' };

  beforeEach(() => {
    listed = [row(SETTINGS, SETTINGS_NOW, 5)];
    answer = { status: 200, body: { version: 6, revision: 10 } };
  });

  it('turns bag minimums the way the form says, the rest of the settings as the API holds them', async () => {
    const r = await run(switchBagMinimumsAction, fields);
    expect(requests[0]).toMatchObject({ method: 'GET', init: { params: { path: { kind: 'settings' } } } });
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'settings', id: SETTINGS } },
          body: { baseVersion: 5, body: { ...SETTINGS_NOW, bagMinimumsOn: true }, reason: 'Demo: remind us' },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: bag minimums are on. It’s on the phones after their next sync.',
    });
    // Condition supplies shows the same settings: their window, update and history.
    expect(revalidated).toEqual([PAGE, '/team/presets/condition-supplies']);
    await run(switchBagMinimumsAction, { ...fields, bagMinimumsOn: 'false' });
    expect(sentBody(1).bagMinimumsOn).toBe(false);
    expect(revalidated.slice(2)).toEqual([PAGE, '/team/presets/condition-supplies']);
  });

  it('says another admin’s change since, and never turns them back for it', async () => {
    answer = refusal(409, 'stale', { currentVersion: 6 });
    const r = await run(switchBagMinimumsAction, fields);
    expect(r.state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: fields,
    });
    expect(writes()).toHaveLength(1);
    expect(revalidated).toEqual([]);
  });

  it('asks nothing of the API for a form that names no way to turn them, or no version', async () => {
    for (const bad of [
      { ...fields, bagMinimumsOn: 'on' },
      { id: SETTINGS, baseVersion: '5', reason: 'Demo: remind us' },
      { ...fields, baseVersion: '' },
      { ...fields, id: 'settings' },
    ])
      expect((await run(switchBagMinimumsAction, bad)).state?.error).toBe(
        'This can’t be found. Reload the page.',
      );
    expect(requests).toEqual([]);
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(switchBagMinimumsAction, fields)).to).toBe(
      '/reauth?next=%2Fteam%2Fpresets%2Fbag-minimums',
    );
  });
});

describe('the template for new bags', () => {
  const fields = {
    id: SETTINGS,
    baseVersion: '5',
    'newBagMinimums.count': '2',
    'newBagMinimums.0.itemId': GAUZE,
    'newBagMinimums.0.min': '15',
    'newBagMinimums.1.itemId': SOCKS,
    'newBagMinimums.1.min': '6',
    reason: 'Demo: what every bag starts with',
  };

  beforeEach(() => {
    listed = [row(SETTINGS, SETTINGS_NOW, 5)];
    answer = { status: 200, body: { version: 6, revision: 10 } };
  });

  it('sends the template’s lines over the settings as the API holds them, at the version shown', async () => {
    const r = await run(saveBagTemplateAction, fields);
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'settings', id: SETTINGS } },
          body: {
            baseVersion: 5,
            body: {
              ...SETTINGS_NOW,
              newBagMinimums: [
                { itemId: GAUZE, min: 15 },
                { itemId: SOCKS, min: 6 },
              ],
            },
            reason: 'Demo: what every bag starts with',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: Template for new bags. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([PAGE, '/team/presets/condition-supplies']);
  });

  it('empties the template when every line was taken out', async () => {
    await run(saveBagTemplateAction, {
      id: SETTINGS,
      baseVersion: '5',
      'newBagMinimums.count': '0',
      reason: 'x y z',
    });
    expect(sentBody().newBagMinimums).toEqual([]);
  });

  it('says each line’s problem beside it, in the template’s words', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'newBagMinimums.0.min', code: 'too_small' },
        { path: 'newBagMinimums.1.itemId', code: 'item_twice' },
      ],
    });
    const r = await run(saveBagTemplateAction, { ...fields, 'newBagMinimums.0.min': '0' });
    expect(r.state?.fieldErrors).toEqual({
      'newBagMinimums.0.min': 'Minimum on line 1: Enter a whole number from 1 to 999.',
      'newBagMinimums.1.itemId': 'Item on line 2: This item is on the list twice.',
    });
    answer = refusal(409, 'reference_archived', {
      problems: [{ path: 'newBagMinimums.1.itemId', code: 'reference_archived' }],
    });
    expect((await run(saveBagTemplateAction, fields)).state?.fieldErrors).toEqual({
      'newBagMinimums.1.itemId': 'Item on line 2: This was removed. Choose another, or restore it first.',
    });
  });

  it('says nothing was changed, or settings it can’t find, asking for no PUT', async () => {
    answer = refusal(422, 'no_change');
    expect((await run(saveBagTemplateAction, fields)).state?.error).toBe('You haven’t changed anything.');
    requests.length = 0;
    listed = [];
    expect((await run(saveBagTemplateAction, fields)).state?.error).toBe(
      'This isn’t on your team’s list. Reload the page to see the list as it is now.',
    );
    expect(writes()).toEqual([]);
  });
});
