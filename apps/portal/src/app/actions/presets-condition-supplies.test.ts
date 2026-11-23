import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import {
  addConditionSupplyAction,
  saveConditionSupplyAction,
  saveProblemCheckAction,
} from './presets-condition-supplies';

// Condition supplies' own forms (phase 5 design 4.4, 5.1, 7, 8.1) as the page sends them: a
// mapping added or edited, and the team's status check window, an edit of the team's settings. The
// API is a stand-in that records each request and answers it by its method: the list for a GET,
// `answer` for a write. Every value is made up.
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

const CREAM = '30d10000-0000-4000-8000-000000000001';
const GAUZE = '30d10000-0000-4000-8000-000000000002';
const RASH = '30d10000-0000-4000-8000-000000000003';
const SETTINGS = '30d10000-0000-4000-8000-000000000004';
const PAGE = '/team/presets/condition-supplies';

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

beforeEach(() => {
  requests.length = 0;
  revalidated.length = 0;
  listed = [];
  pathname = PAGE;
  answer = { status: 201, body: { id: RASH, version: 1, revision: 8 } };
});

describe('adding a mapping', () => {
  const fields = {
    name: ' Demo: Rash ',
    'codes.count': '2',
    'codes.0': ' R21',
    'codes.1': 'L30.9 ',
    'lines.count': '2',
    'lines.0.itemId': CREAM,
    'lines.0.qtyPerPatient': '1',
    'lines.1.itemId': GAUZE,
    'lines.1.qtyPerPatient': '2',
    reason: 'Demo: what a rash needs',
  };

  it('sends its name, its codes and its lines as typed, less the spaces around them, with the reason', async () => {
    const r = await run(addConditionSupplyAction, fields);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}',
        init: {
          params: { path: { kind: 'condition_supply_map' } },
          body: {
            body: {
              name: 'Demo: Rash',
              codes: ['R21', 'L30.9'],
              lines: [
                { itemId: CREAM, qtyPerPatient: 1 },
                { itemId: GAUZE, qtyPerPatient: 2 },
              ],
            },
            reason: 'Demo: what a rash needs',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Added: Demo: Rash. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([PAGE]);
  });

  it('sends a code as typed, so the API answers it, and says each code’s and each line’s problem beside it', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'codes.1', code: 'invalid_format' },
        { path: 'lines.0.itemId', code: 'invalid_format' },
        { path: 'lines.0.qtyPerPatient', code: 'invalid_type' },
        { path: 'lines.1.qtyPerPatient', code: 'too_big' },
      ],
    });
    const sent = {
      ...fields,
      'codes.1': 'l30.9',
      'lines.0.itemId': '',
      'lines.0.qtyPerPatient': 'one',
      'lines.1.qtyPerPatient': '100',
    };
    const r = await run(addConditionSupplyAction, sent);
    expect(sentBody()).toMatchObject({
      codes: ['R21', 'l30.9'],
      lines: [
        { itemId: '', qtyPerPatient: 'one' },
        { itemId: GAUZE, qtyPerPatient: 100 },
      ],
    });
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: {
        'codes.1': 'Condition code 2: Enter a code as a problem records it, such as R21 or L30.9.',
        'lines.0.itemId': 'Item on line 1: Choose one from the list.',
        'lines.0.qtyPerPatient': 'Quantity per patient on line 1: Enter a whole number from 1 to 99.',
        'lines.1.qtyPerPatient': 'Quantity per patient on line 2: Enter a whole number from 1 to 99.',
      },
      values: sent,
    });
    expect(revalidated).toEqual([]);
  });

  it('sends no codes and no lines when every box was taken out, and says how many each takes', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'name', code: 'too_small' },
        { path: 'codes', code: 'too_small' },
        { path: 'lines', code: 'too_small' },
      ],
    });
    const sent = { name: '', 'codes.count': '0', 'lines.count': '0', reason: 'Demo: a reason' };
    const r = await run(addConditionSupplyAction, sent);
    expect(sentBody()).toEqual({ name: '', codes: [], lines: [] });
    expect(r.state?.fieldErrors).toEqual({
      name: 'Name: Enter a name of 1 to 80 characters.',
      codes: 'Condition codes: Give 1 to 20 condition codes.',
      lines: 'Items: Give the mapping 1 to 10 items.',
    });
  });

  it('says a name another mapping holds, and a removed item a line names', async () => {
    answer = refusal(409, 'name_taken');
    expect((await run(addConditionSupplyAction, fields)).state).toMatchObject({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { name: 'Name: Another condition mapping already has this name.' },
    });
    answer = refusal(409, 'reference_archived', {
      problems: [{ path: 'lines.1.itemId', code: 'reference_archived' }],
    });
    expect((await run(addConditionSupplyAction, fields)).state).toMatchObject({
      error: 'It names something that was removed. Choose another, or restore that one first.',
      fieldErrors: {
        'lines.1.itemId': 'Item on line 2: This was removed. Choose another, or restore it first.',
      },
    });
  });

  it('says a refused reason beside the Reason box', async () => {
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] });
    const r = await run(addConditionSupplyAction, { ...fields, reason: 'no' });
    expect(r.state?.fieldErrors).toEqual({ reason: 'Reason: Give a reason of 3 to 300 characters.' });
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(addConditionSupplyAction, fields)).to).toBe(
      '/reauth?next=%2Fteam%2Fpresets%2Fcondition-supplies',
    );
    expect(revalidated).toEqual([]);
  });
});

describe('editing a mapping', () => {
  const now = { name: 'Demo: Rash', codes: ['R21'], lines: [{ itemId: CREAM, qtyPerPatient: 1 }] };
  const fields = {
    id: RASH,
    baseVersion: '2',
    name: 'Demo: Rash or dermatitis',
    'codes.count': '2',
    'codes.0': 'R21',
    'codes.1': 'L30.9',
    'lines.count': '1',
    'lines.0.itemId': CREAM,
    'lines.0.qtyPerPatient': '2',
    reason: 'Demo: dermatitis too',
  };

  beforeEach(() => {
    listed = [row(RASH, now)];
    answer = { status: 200, body: { version: 3, revision: 9 } };
  });

  it('sends the mapping as the API holds it with the form’s fields over it, at the version shown', async () => {
    const r = await run(saveConditionSupplyAction, fields);
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'condition_supply_map', id: RASH } },
          body: {
            baseVersion: 2,
            body: {
              name: 'Demo: Rash or dermatitis',
              codes: ['R21', 'L30.9'],
              lines: [{ itemId: CREAM, qtyPerPatient: 2 }],
            },
            reason: 'Demo: dermatitis too',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: Demo: Rash or dermatitis. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([PAGE]);
  });

  it('keeps every field of the body the form doesn’t show', async () => {
    listed = [row(RASH, { ...now, season: 'summer' })];
    await run(saveConditionSupplyAction, fields);
    expect(sentBody()).toMatchObject({ season: 'summer', name: 'Demo: Rash or dermatitis' });
  });

  it('says someone else changed it, nothing was changed, or it was removed, and reads nothing again', async () => {
    answer = refusal(409, 'stale', { currentVersion: 3 });
    expect((await run(saveConditionSupplyAction, fields)).state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: fields,
    });
    answer = refusal(422, 'no_change');
    expect((await run(saveConditionSupplyAction, fields)).state?.error).toBe('You haven’t changed anything.');
    expect(revalidated).toEqual([]);
    // Removed by another admin meanwhile: the page, read again, draws it removed, so the save
    // comes back to the page, which says so.
    answer = refusal(409, 'archived');
    expect((await run(saveConditionSupplyAction, fields)).to).toBe(`${PAGE}?refused=archived&preset=${RASH}`);
    expect(revalidated).toEqual([PAGE]);
  });

  it('says a mapping no longer on the list isn’t, and asks nothing more', async () => {
    listed = [];
    const r = await run(saveConditionSupplyAction, fields);
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
      expect((await run(saveConditionSupplyAction, bad)).state?.error).toBe(
        'This can’t be found. Reload the page.',
      );
    expect(requests).toEqual([]);
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(saveConditionSupplyAction, fields)).to).toBe(
      '/reauth?next=%2Fteam%2Fpresets%2Fcondition-supplies',
    );
  });
});

describe('the status check window', () => {
  const now = {
    name: 'Team settings',
    bagMinimumsOn: true,
    newBagMinimums: [{ itemId: GAUZE, min: 10 }],
    problemCheckDays: 90,
  };
  const fields = { id: SETTINGS, baseVersion: '4', problemCheckDays: ' 60 ', reason: 'Demo: check sooner' };

  beforeEach(() => {
    listed = [row(SETTINGS, now, 4)];
    answer = { status: 200, body: { version: 5, revision: 10 } };
  });

  it('sends the team’s settings as the API holds them with the number of days over them, at the version shown', async () => {
    const r = await run(saveProblemCheckAction, fields);
    expect(requests[0]).toMatchObject({ method: 'GET', init: { params: { path: { kind: 'settings' } } } });
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'settings', id: SETTINGS } },
          body: {
            baseVersion: 4,
            body: { ...now, problemCheckDays: 60 },
            reason: 'Demo: check sooner',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: Check problems not updated in 60 days. It’s on the phones after their next sync.',
    });
    // Bag minimums shows the same settings: its switch and its template.
    expect(revalidated).toEqual([PAGE, '/team/presets/bag-minimums']);
  });

  it('sends a number of days that isn’t one as typed, and says its range beside it', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'problemCheckDays', code: 'invalid_type' }] });
    const sent = { ...fields, problemCheckDays: 'ninety' };
    const r = await run(saveProblemCheckAction, sent);
    expect(sentBody().problemCheckDays).toBe('ninety');
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: {
        problemCheckDays: 'Check problems not updated in: Enter a whole number of days from 7 to 365.',
      },
      values: sent,
    });
    answer = refusal(422, 'invalid', { problems: [{ path: 'problemCheckDays', code: 'too_big' }] });
    await run(saveProblemCheckAction, { ...fields, problemCheckDays: '400' });
    expect(sentBody(1).problemCheckDays).toBe(400);
  });

  it('says someone else changed the settings, or nothing was changed', async () => {
    answer = refusal(409, 'stale', { currentVersion: 5 });
    expect((await run(saveProblemCheckAction, fields)).state?.error).toBe(
      'Someone else changed this while you were editing. Reload to see their version.',
    );
    answer = refusal(422, 'no_change');
    expect((await run(saveProblemCheckAction, fields)).state?.error).toBe('You haven’t changed anything.');
    expect(revalidated).toEqual([]);
  });

  it('asks nothing of the API for a form the page doesn’t write, nor a PUT for settings it can’t find', async () => {
    expect((await run(saveProblemCheckAction, { ...fields, baseVersion: 'x' })).state?.error).toBe(
      'This can’t be found. Reload the page.',
    );
    expect(requests).toEqual([]);
    listed = [];
    expect((await run(saveProblemCheckAction, fields)).state?.error).toBe(
      'This isn’t on your team’s list. Reload the page to see the list as it is now.',
    );
    expect(writes()).toEqual([]);
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(saveProblemCheckAction, fields)).to).toBe(
      '/reauth?next=%2Fteam%2Fpresets%2Fcondition-supplies',
    );
  });
});
