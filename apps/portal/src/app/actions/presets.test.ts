import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import { removePresetAction, restorePresetAction, takePresetUpdateAction } from './presets';

// Remove, Restore and taking an update (phase 5 design 5.1, 7, 8.1), as the forms send them. The
// API is a stand-in that records each request and answers `answer`; the page the form was sent
// from is `pathname`, as the proxy names it in x-pathname. Every value is made up.
const requests: { method: string; path: string; init: { params?: unknown; body?: unknown } }[] = [];
let answer: { status: number; body: unknown };
let pathname: string;
const revalidated: string[] = [];

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-pathname': pathname }) }));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => void revalidated.push(path) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  api: async () => {
    const call = (method: string) => async (path: string, init: { params?: unknown; body?: unknown }) => {
      requests.push({ method, path, init });
      const response = new Response(JSON.stringify(answer.body), { status: answer.status });
      return answer.status < 300 ? { data: answer.body, response } : { error: answer.body, response };
    };
    return { GET: call('GET'), POST: call('POST'), PUT: call('PUT') };
  },
}));

const FLAG = '30f00000-0000-4000-8000-000000000001';
const NEW = '30f00000-0000-4000-8000-000000000002';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const refusal = (status: number, code: string, details?: Record<string, unknown>) => ({
  status,
  body: { error: { code, message: 'The API’s words.', ...(details ? { details } : {}) } },
});

/** Where an action sent the browser, or null when it answered the form. */
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

beforeEach(() => {
  requests.length = 0;
  revalidated.length = 0;
  pathname = '/team/presets/flags';
  answer = { status: 200, body: { revision: 7 } };
});

describe('Remove', () => {
  const fields = { kind: 'flag', id: FLAG, baseVersion: '3', reason: 'Demo: not used any more' };

  it('archives the preset at the version shown, with the reason, and comes back to the page saying so', async () => {
    const r = await run(removePresetAction, fields);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}/{id}/archive',
        init: {
          params: { path: { kind: 'flag', id: FLAG } },
          body: { baseVersion: 3, reason: 'Demo: not used any more' },
        },
      },
    ]);
    expect(r.to).toBe(`/team/presets/flags?done=removed&preset=${FLAG}`);
    expect(revalidated).toEqual(['/team/presets/flags']);
  });

  it('lands on the page the form names, a preset’s list from its own page', async () => {
    pathname = `/team/presets/flags/${FLAG}`;
    expect((await run(removePresetAction, { ...fields, back: '/team/presets/flags' })).to).toBe(
      `/team/presets/flags?done=removed&preset=${FLAG}`,
    );
    // Never anywhere else.
    expect((await run(removePresetAction, { ...fields, back: '/home' })).to).toBe(
      `/team/presets/flags/${FLAG}?done=removed&preset=${FLAG}`,
    );
  });

  it('says why the API refused, keeps what was typed, and leaves the page as it is', async () => {
    answer = refusal(409, 'referenced', { referencedBy: { bundle: 2, field_supply_map: 1 } });
    const r = await run(removePresetAction, fields);
    expect(r.state).toEqual({
      error: 'Still used by 2 bundles and 1 mapping. Take it out of those first.',
      values: fields,
    });
    expect(revalidated).toEqual([]);
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(removePresetAction, fields)).to).toBe('/reauth?next=%2Fteam%2Fpresets%2Fflags');
  });

  it('asks nothing of the API for a form no page writes', async () => {
    for (const bad of [
      { ...fields, kind: 'note_type' },
      { ...fields, id: 'not-an-id' },
      { ...fields, baseVersion: '' },
    ])
      expect((await run(removePresetAction, bad)).state?.error).toBe('This can’t be found. Reload the page.');
    expect(requests).toEqual([]);
  });
});

describe('Restore', () => {
  it('restores the preset with the reason, and comes back to the page saying so', async () => {
    const r = await run(restorePresetAction, { kind: 'item', id: FLAG, reason: 'Demo: back in use' });
    expect(requests[0]).toMatchObject({
      path: '/v1/admin/presets/{kind}/{id}/restore',
      init: { params: { path: { kind: 'item', id: FLAG } }, body: { reason: 'Demo: back in use' } },
    });
    expect(r.to).toBe(`/team/presets/flags?done=restored&preset=${FLAG}`);
  });

  it('says a bundle that would come back Non-Medical holding a medication can’t', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'medical', code: 'bundle_not_medical' }] });
    const r = await run(restorePresetAction, { kind: 'bundle', id: FLAG, reason: 'Demo: back in use' });
    expect(r.state?.error).toBe(
      'This bundle now holds a medication, so it must be Medical. Add a Medical bundle instead.',
    );
  });
});

describe('taking Sineobex’s update', () => {
  const fields = {
    kind: 'flag',
    id: FLAG,
    baseVersion: '3',
    platformVersion: '2',
    asNew: 'false',
    reason: 'Demo: take theirs',
  };

  it('sends back the version shown and the platform version reviewed, and comes back saying so', async () => {
    answer = { status: 200, body: { id: FLAG, version: 4, revision: 9 } };
    const r = await run(takePresetUpdateAction, fields);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}/{id}/take-update',
        init: {
          params: { path: { kind: 'flag', id: FLAG } },
          body: { baseVersion: 3, platformVersion: 2, asNew: false, reason: 'Demo: take theirs' },
        },
      },
    ]);
    expect(r.to).toBe(`/team/presets/flags?done=updated&preset=${FLAG}`);
    expect(revalidated).toEqual(['/team/presets/flags']);
  });

  it('names the new preset after one added as new', async () => {
    answer = { status: 200, body: { id: NEW, version: 1, revision: 9 } };
    const r = await run(takePresetUpdateAction, { ...fields, asNew: 'true' });
    expect(requests[0]!.init.body).toMatchObject({ asNew: true });
    expect(r.to).toBe(`/team/presets/flags?done=added&preset=${NEW}`);
  });

  it('reads the page again when refused stale, so the review shows what is on offer now', async () => {
    answer = refusal(409, 'stale', { currentVersion: 3, platformVersion: 3 });
    const r = await run(takePresetUpdateAction, fields);
    expect(r.state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: fields,
    });
    expect(revalidated).toEqual(['/team/presets/flags']);
  });

  it('reads nothing again for any other refusal', async () => {
    answer = refusal(409, 'fixed_field', { fields: ['tier'] });
    const r = await run(takePresetUpdateAction, fields);
    expect(r.state?.error).toBe(
      'This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.',
    );
    expect(revalidated).toEqual([]);
  });

  it('asks nothing of the API for a take no page writes', async () => {
    for (const bad of [
      { ...fields, asNew: 'yes' },
      { ...fields, platformVersion: '0' },
      { ...fields, baseVersion: 'x' },
    ])
      expect((await run(takePresetUpdateAction, bad)).state?.error).toBe(
        'This can’t be found. Reload the page.',
      );
    expect(requests).toEqual([]);
  });
});
