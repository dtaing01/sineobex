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

  it('comes back to the page it was sent from, saying so, when another admin removed it first', async () => {
    // The page, read again, draws it removed, so the form refused would say nothing.
    pathname = `/team/presets/flags/${FLAG}`;
    answer = refusal(409, 'archived');
    const r = await run(removePresetAction, { ...fields, back: '/team/presets/flags' });
    expect(r.to).toBe(`/team/presets/flags/${FLAG}?refused=archived&preset=${FLAG}`);
    expect(revalidated).toEqual([`/team/presets/flags/${FLAG}`]);
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

  it('comes back to the page, saying so, when another admin restored it first', async () => {
    answer = refusal(409, 'not_archived');
    const r = await run(restorePresetAction, { kind: 'item', id: FLAG, reason: 'Demo: back in use' });
    expect(r.to).toBe(`/team/presets/flags?refused=not_archived&preset=${FLAG}`);
    expect(revalidated).toEqual(['/team/presets/flags']);
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
    baseState: 'active',
    asNew: 'false',
    reason: 'Demo: take theirs',
  };

  it('sends back the version shown, the platform version reviewed and the state shown, and comes back saying so', async () => {
    answer = { status: 200, body: { id: FLAG, version: 4, revision: 9 } };
    const r = await run(takePresetUpdateAction, fields);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}/{id}/take-update',
        init: {
          params: { path: { kind: 'flag', id: FLAG } },
          body: {
            baseVersion: 3,
            platformVersion: 2,
            baseState: 'active',
            asNew: false,
            reason: 'Demo: take theirs',
          },
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

  it('reads the page again when refused stale, and lets the form send what the review shows now', async () => {
    answer = refusal(409, 'stale', { currentVersion: 3, platformVersion: 3, state: 'active' });
    const r = await run(takePresetUpdateAction, fields);
    // What the review was opened at is left out of what the form keeps, so it takes the page's again.
    const { baseVersion: _shown, platformVersion: _offered, baseState: _state, ...kept } = fields;
    expect(r.state).toEqual({
      error:
        'Sineobex offered a newer version while you were reviewing this one. Review it below before you take it.',
      values: kept,
    });
    expect(revalidated).toEqual(['/team/presets/flags']);
  });

  it('keeps the versions it sent when refused for anything but stale, so a change made since is still stale', async () => {
    for (const [status, code, details] of [
      [422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] }],
      [409, 'name_taken', undefined],
      [409, 'reference_archived', { problems: [] }],
      [422, 'invalid', { problems: [{ path: 'categoryId', code: 'unknown_reference' }] }],
    ] as const) {
      answer = refusal(status, code, details);
      const r = await run(takePresetUpdateAction, { ...fields, reason: '' });
      expect(r.state?.values, code).toMatchObject({ baseVersion: '3', platformVersion: '2' });
    }
    expect(revalidated).toEqual([]);
  });

  it('reads nothing again for any other refusal', async () => {
    answer = refusal(409, 'fixed_field', { fields: ['tier'] });
    const r = await run(takePresetUpdateAction, fields);
    expect(r.state?.error).toBe(
      'This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.',
    );
    expect(revalidated).toEqual([]);
  });

  it('comes back to the page it was sent from, saying so, when another admin removed the copy first', async () => {
    pathname = `/team/presets/flags/${FLAG}`;
    answer = refusal(409, 'archived');
    const r = await run(takePresetUpdateAction, { ...fields, back: '/team/presets/flags' });
    expect(r.to).toBe(`/team/presets/flags/${FLAG}?refused=archived&preset=${FLAG}`);
  });

  it('comes back to the page, saying so, when another admin restored or removed the copy after its review (item 5)', async () => {
    // The take is stale and names the copy's state now: the page draws the copy there, so the form
    // that was refused has gone with its old place, and the page's notice says what happened.
    pathname = `/team/presets/flags/${FLAG}`;
    answer = refusal(409, 'stale', { currentVersion: 3, platformVersion: 2, state: 'active' });
    const restored = await run(takePresetUpdateAction, { ...fields, baseState: 'archived', asNew: 'true' });
    expect(restored.to).toBe(`/team/presets/flags/${FLAG}?refused=not_archived&preset=${FLAG}`);
    answer = refusal(409, 'stale', { currentVersion: 3, platformVersion: 2, state: 'archived' });
    const removed = await run(takePresetUpdateAction, { ...fields, asNew: 'true' });
    expect(removed.to).toBe(`/team/presets/flags/${FLAG}?refused=archived&preset=${FLAG}`);
    expect(revalidated).toEqual([`/team/presets/flags/${FLAG}`, `/team/presets/flags/${FLAG}`]);
  });

  it('says in 8.1’s words that Non-Medical bundles hold an item an update taken in place would move', async () => {
    answer = refusal(409, 'bundle_not_medical', { bundles: 2 });
    const r = await run(takePresetUpdateAction, { ...fields, kind: 'item' });
    expect(r.state?.error).toBe(
      'Non-Medical bundles hold this item, and a bundle that holds a medication must be Medical. Make them Medical first.',
    );
    expect(revalidated).toEqual([]);
  });

  it('asks nothing of the API for a take no page writes', async () => {
    for (const bad of [
      { ...fields, asNew: 'yes' },
      { ...fields, platformVersion: '0' },
      { ...fields, baseVersion: 'x' },
      { ...fields, baseState: 'removed' },
      { ...fields, baseState: '' },
    ])
      expect((await run(takePresetUpdateAction, bad)).state?.error).toBe(
        'This can’t be found. Reload the page.',
      );
    expect(requests).toEqual([]);
  });
});
