import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import { addFlagAction, moveFlagAction, saveFlagAction } from './presets-flags';

// Adding a flag and moving one up or down its list (phase 5 design 4.4, 5.1, 7, 8.1), as the Flags
// page's forms send them. The API is a stand-in that records each request and answers it by its
// method: the list for a GET, `answer` for a write. Every value is made up but the platform's names.
const requests: { method: string; path: string; init: { params?: unknown; body?: unknown } }[] = [];
let answer: { status: number; body: unknown };
let listed: unknown[];
const revalidated: string[] = [];

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-pathname': '/team/presets/flags' }),
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

const HIGH = '30f00000-0000-4000-8000-000000000001';
const MEDIUM = '30f00000-0000-4000-8000-000000000002';
const LOW = '30f00000-0000-4000-8000-000000000003';
const FROST = '30f00000-0000-4000-8000-000000000011';
const HEAT = '30f00000-0000-4000-8000-000000000012';
const PREGNANCY = '30f00000-0000-4000-8000-000000000013';

const flag = (
  id: string,
  name: string,
  tier: 'primary' | 'secondary',
  rank: number,
  over: { version?: number; state?: 'active' | 'archived'; sensitive?: boolean } = {},
) => ({
  id,
  name,
  state: over.state ?? 'active',
  version: over.version ?? 1,
  customized: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  body: { name, tier, criteria: '', color: 'blue', rank, sensitive: over.sensitive ?? false },
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
const sentBody = () => (writes()[0]!.init.body as { body: Record<string, unknown> }).body;

beforeEach(() => {
  requests.length = 0;
  revalidated.length = 0;
  listed = [
    flag(HIGH, 'High', 'primary', 10),
    flag(MEDIUM, 'Medium', 'primary', 20),
    flag(LOW, 'Low', 'primary', 30),
    flag(FROST, 'Frost risk', 'secondary', 10),
    flag(HEAT, 'Demo: Heat risk', 'secondary', 45, { state: 'archived', version: 2 }),
    flag(PREGNANCY, 'Pregnancy', 'secondary', 30, { sensitive: true }),
  ];
  answer = { status: 201, body: { id: '30f00000-0000-4000-8000-000000000020', version: 1, revision: 9 } };
});

describe('adding a flag', () => {
  const fields = {
    name: ' Demo: Wet feet  ',
    tier: 'secondary',
    color: 'teal',
    criteria: '  Demo: slept out in the rain. ',
    reason: 'Demo: the rainy season',
  };

  it('sends what was typed and chosen, after every flag of its list, removed ones too, with the reason', async () => {
    const r = await run(addFlagAction, fields);
    expect(writes()).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}',
        init: {
          params: { path: { kind: 'flag' } },
          body: {
            body: {
              name: 'Demo: Wet feet',
              tier: 'secondary',
              criteria: 'Demo: slept out in the rain.',
              color: 'teal',
              // After the removed Demo: Heat risk at 45, so a restore brings it back where it was.
              rank: 55,
              sensitive: false,
            },
            reason: 'Demo: the rainy season',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Added: Demo: Wet feet. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual(['/team/presets/flags']);
  });

  it('puts a risk level after the risk levels, and sends Sensitive as ticked', async () => {
    await run(addFlagAction, { ...fields, tier: 'primary', sensitive: 'on' });
    expect(sentBody()).toMatchObject({ tier: 'primary', rank: 40, sensitive: true });
  });

  it('puts a flag at the end even when its list ends at the highest rank, where the name settles it', async () => {
    listed = [flag(FROST, 'Frost risk', 'secondary', 999_995)];
    await run(addFlagAction, fields);
    expect(sentBody().rank).toBe(1_000_000);
  });

  it('sends nothing for a list or a colour nobody chose, so the API answers at each, and says each beside it', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'name', code: 'too_small' },
        { path: 'tier', code: 'invalid_value' },
        { path: 'color', code: 'invalid_value' },
      ],
    });
    const sent = { name: '', criteria: '', reason: 'Demo: the rainy season' };
    const r = await run(addFlagAction, sent);
    // As the client sends it: JSON, which holds no field for a value never given.
    expect(JSON.parse(JSON.stringify(sentBody()))).toEqual({
      name: '',
      criteria: '',
      rank: 10,
      sensitive: false,
    });
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: {
        name: 'Name: Enter a name of 1 to 80 characters.',
        tier: 'List: Choose Risk level or Conditions.',
        color: 'Colour: Choose a colour.',
      },
      values: sent,
    });
    expect(revalidated).toEqual([]);
  });

  it('says a risk level can’t be sensitive beside Sensitive, keeping what was ticked', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'sensitive', code: 'primary_sensitive' }] });
    const sent = { ...fields, tier: 'primary', sensitive: 'on' };
    const r = await run(addFlagAction, sent);
    expect(r.state).toEqual({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { sensitive: 'Sensitive: A risk level can’t be sensitive.' },
      values: sent,
    });
  });

  it('says criteria too long beside them', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'criteria', code: 'too_big' }] });
    const r = await run(addFlagAction, fields);
    expect(r.state?.fieldErrors).toEqual({ criteria: 'Criteria: Keep it to 500 characters.' });
  });

  it('says a name another flag holds beside the name', async () => {
    answer = refusal(409, 'name_taken');
    const r = await run(addFlagAction, { ...fields, name: 'frost risk' });
    expect(r.state).toMatchObject({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { name: 'Name: Another flag already has this name.' },
    });
  });

  it('says a refused reason beside the Reason box', async () => {
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] });
    const r = await run(addFlagAction, { ...fields, reason: 'no' });
    expect(r.state?.error).toBe('Some fields need changing. Check each one below.');
    expect(r.state?.fieldErrors).toEqual({ reason: 'Reason: Give a reason of 3 to 300 characters.' });
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(addFlagAction, fields)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fflags');
    expect(revalidated).toEqual([]);
  });
});

describe('editing a flag', () => {
  const fields = {
    id: PREGNANCY,
    baseVersion: '1',
    name: ' Pregnancy ',
    color: 'teal',
    criteria: ' Demo: says so, or a test says so. ',
    reason: 'Demo: our own words',
  };

  beforeEach(() => {
    answer = { status: 200, body: { version: 2, revision: 10 } };
  });

  it('sends the flag as the API holds it with the form’s name, colour and criteria, at the version shown', async () => {
    const r = await run(saveFlagAction, fields);
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'flag', id: PREGNANCY } },
          body: {
            baseVersion: 1,
            // Its list, Sensitive and its rank are the API's, never the form's (4.4).
            body: {
              name: 'Pregnancy',
              tier: 'secondary',
              criteria: 'Demo: says so, or a test says so.',
              color: 'teal',
              rank: 30,
              sensitive: true,
            },
            reason: 'Demo: our own words',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: Pregnancy. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([`/team/presets/flags/${PREGNANCY}`, '/team/presets/flags']);
  });

  it('never sends a list, Sensitive or a rank a form sends, and keeps every field it doesn’t show', async () => {
    listed = [
      {
        ...flag(PREGNANCY, 'Pregnancy', 'secondary', 30, { sensitive: true }),
        body: { ...flag(PREGNANCY, 'Pregnancy', 'secondary', 30, { sensitive: true }).body, icon: 'demo' },
      },
    ];
    await run(saveFlagAction, { ...fields, tier: 'primary', sensitive: '', rank: '5' });
    expect(sentBody()).toMatchObject({ tier: 'secondary', sensitive: true, rank: 30, icon: 'demo' });
  });

  it('says someone else changed it, keeps what was typed, and leaves the page as it is', async () => {
    answer = refusal(409, 'stale', { currentVersion: 2 });
    const r = await run(saveFlagAction, fields);
    expect(r.state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: fields,
    });
    expect(revalidated).toEqual([]);
  });

  it('says nothing was changed, and a name another flag holds beside the name', async () => {
    answer = refusal(422, 'no_change');
    expect((await run(saveFlagAction, fields)).state?.error).toBe('You haven’t changed anything.');
    answer = refusal(409, 'name_taken');
    expect((await run(saveFlagAction, { ...fields, name: 'high' })).state?.fieldErrors).toEqual({
      name: 'Name: Another flag already has this name.',
    });
  });

  it('says each problem with a field beside it', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'criteria', code: 'too_big' },
        { path: 'color', code: 'invalid_value' },
      ],
    });
    expect((await run(saveFlagAction, fields)).state?.fieldErrors).toEqual({
      criteria: 'Criteria: Keep it to 500 characters.',
      color: 'Colour: Choose a colour.',
    });
  });

  it('says a flag no longer on the list isn’t, and asks nothing more', async () => {
    listed = [flag(HIGH, 'High', 'primary', 10)];
    const r = await run(saveFlagAction, fields);
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
      expect((await run(saveFlagAction, bad)).state?.error).toBe('This can’t be found. Reload the page.');
    expect(requests).toEqual([]);
  });

  it('goes through /reauth and back to the page the form was sent from when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(saveFlagAction, fields)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fflags');
  });
});

describe('moving a flag up or down its list', () => {
  /** The Risk level list as the page drew it: High, Medium, Low, at the versions shown. */
  const primary = {
    tier: 'primary',
    'flags.0.id': HIGH,
    'flags.0.baseVersion': '1',
    'flags.1.id': MEDIUM,
    'flags.1.baseVersion': '3',
    'flags.2.id': LOW,
    'flags.2.baseVersion': '2',
    reason: 'Demo: our order for the winter',
  };
  const order = () => writes()[0]!.init.body;

  beforeEach(() => {
    answer = { status: 200, body: { changed: 2 } };
  });

  it('sends every flag of the list with the version shown, the one moved down swapped with the next', async () => {
    const r = await run(moveFlagAction, { ...primary, move: `down:${HIGH}` });
    expect(writes()).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/preset-order/flag',
        init: {
          body: {
            tier: 'primary',
            flags: [
              { id: MEDIUM, baseVersion: 3 },
              { id: HIGH, baseVersion: 1 },
              { id: LOW, baseVersion: 2 },
            ],
            reason: 'Demo: our order for the winter',
          },
        },
      },
    ]);
    // The list is read again for the next move; the reason stays for it, and the flag is named so
    // the list keeps the person's place on it.
    expect(r.state).toEqual({
      ok: true,
      values: { reason: 'Demo: our order for the winter', move: `down:${HIGH}` },
    });
    expect(revalidated).toEqual(['/team/presets/flags']);
  });

  it('swaps the one moved up with the one before it', async () => {
    await run(moveFlagAction, { ...primary, move: `up:${LOW}` });
    expect((order() as { flags: { id: string }[] }).flags.map((f) => f.id)).toEqual([HIGH, LOW, MEDIUM]);
  });

  it('moves a condition in its own list', async () => {
    const secondary = {
      tier: 'secondary',
      'flags.0.id': FROST,
      'flags.0.baseVersion': '1',
      'flags.1.id': PREGNANCY,
      'flags.1.baseVersion': '1',
      reason: 'Demo: pregnancy first',
      move: `up:${PREGNANCY}`,
    };
    await run(moveFlagAction, secondary);
    expect(order()).toEqual({
      tier: 'secondary',
      flags: [
        { id: PREGNANCY, baseVersion: 1 },
        { id: FROST, baseVersion: 1 },
      ],
      reason: 'Demo: pregnancy first',
    });
  });

  it('reads the list again when another write changed it since, and says to check it and move again', async () => {
    // The list is read again before the sentence is heard, so it asks for no reload (item 6).
    answer = refusal(409, 'stale', { flags: [{ id: LOW, currentVersion: 3 }] });
    const sent = { ...primary, move: `down:${HIGH}` };
    const r = await run(moveFlagAction, sent);
    expect(r.state).toEqual({
      error: 'Someone changed these flags meanwhile. Check the list below and move again.',
      values: sent,
    });
    expect(revalidated).toEqual(['/team/presets/flags']);
  });

  it('reads the list again when a flag joined or left it since, and says to check it and move again', async () => {
    answer = refusal(422, 'ids_mismatch');
    const r = await run(moveFlagAction, { ...primary, move: `down:${HIGH}` });
    expect(r.state?.error).toBe(
      'Someone changed these flags meanwhile. Check the list below and move again.',
    );
    expect(revalidated).toEqual(['/team/presets/flags']);
  });

  it('says a refused reason beside the Reason box, and leaves the list as it is', async () => {
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] });
    const r = await run(moveFlagAction, { ...primary, reason: '', move: `down:${HIGH}` });
    expect(r.state).toMatchObject({
      error: 'Some fields need changing. Check each one below.',
      fieldErrors: { reason: 'Reason for moving: Give a reason of 3 to 300 characters.' },
    });
    expect(revalidated).toEqual([]);
  });

  it('asks nothing of the API for a move the page doesn’t offer or a form it doesn’t write', async () => {
    const alone = { tier: 'primary', 'flags.0.id': HIGH, 'flags.0.baseVersion': '1', reason: 'Demo: alone' };
    for (const bad of [
      { ...primary, move: `up:${HIGH}` },
      { ...primary, move: `down:${LOW}` },
      { ...primary, move: `down:${FROST}` },
      { ...primary, move: `sideways:${HIGH}` },
      { ...primary },
      { ...primary, tier: 'tertiary', move: `down:${HIGH}` },
      { ...primary, tier: '', move: `down:${HIGH}` },
      { ...primary, 'flags.1.id': 'not-an-id', move: `down:${HIGH}` },
      { ...primary, 'flags.1.baseVersion': '0', move: `down:${HIGH}` },
      { ...primary, 'flags.1.baseVersion': '', move: `down:${HIGH}` },
      { ...alone, move: `down:${HIGH}` },
    ])
      expect((await run(moveFlagAction, bad)).state?.error).toBe('This can’t be found. Reload the page.');
    expect(requests).toEqual([]);
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(moveFlagAction, { ...primary, move: `down:${HIGH}` })).to).toBe(
      '/reauth?next=%2Fteam%2Fpresets%2Fflags',
    );
    expect(revalidated).toEqual([]);
  });
});
