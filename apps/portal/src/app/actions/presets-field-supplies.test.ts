import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import { addFieldSupplyAction, saveFieldSupplyAction } from './presets-field-supplies';

// Field supplies' own forms (phase 5 design 4.4, 7, 8.1), as the page's forms send them, written
// ahead of their code (card P4-tests): each fails until card P4-field-supplies builds them. The API
// is a stand-in that records each request and answers it: the list for a GET, `answer` for a write.
// Every value is made up.
//
// A mapping's form names each field as its body does: name; noteTypeKey; path, the field or a
// grid's cell, or empty for Every note of this type; when.kind (answered, equals or includes) and
// when.value, the answer it fires on; lines.<n>.itemId and lines.<n>.qty, the items it suggests.
const requests: { method: string; path: string; init?: { params?: unknown; body?: unknown } }[] = [];
let answer: { status: number; body: unknown };
let listed: unknown[];
const revalidated: string[] = [];

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-pathname': '/team/presets/field-supplies' }),
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

const MAP = '30f00000-0000-4000-8000-000000000001';
const GAUZE = '30f00000-0000-4000-8000-000000000002';
const SOCKS = '30f00000-0000-4000-8000-000000000003';
const PAGE = '/team/presets/field-supplies';

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
const sentBody = () => (writes()[0]!.init!.body as { body: Record<string, unknown> }).body;

beforeEach(() => {
  requests.length = 0;
  revalidated.length = 0;
  listed = [
    row(MAP, {
      name: 'Demo: Dressing applied',
      noteTypeKey: 'wound_care',
      path: 'wound.treatment.dressing',
      when: { includes: 'gauze' },
      lines: [{ itemId: GAUZE, qty: 1 }],
    }),
  ];
  answer = { status: 200, body: {} };
});

describe('adding a field supply mapping', () => {
  const fields = {
    name: ' Demo: Socks given ',
    noteTypeKey: 'outreach',
    path: 'outreach.support',
    'when.kind': 'includes',
    'when.value': 'clothing',
    'lines.0.itemId': SOCKS,
    'lines.0.qty': '2',
    reason: 'Demo: socks go out with clothing',
  };

  it('sends its note type, its field and the answer it fires on, and its lines, with the reason', async () => {
    answer = { status: 201, body: { id: MAP, version: 1, revision: 4 } };
    const r = await run(addFieldSupplyAction, fields);
    expect(writes()).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/presets/{kind}',
        init: {
          params: { path: { kind: 'field_supply_map' } },
          body: {
            body: {
              name: 'Demo: Socks given',
              noteTypeKey: 'outreach',
              path: 'outreach.support',
              when: { includes: 'clothing' },
              lines: [{ itemId: SOCKS, qty: 2 }],
            },
            reason: 'Demo: socks go out with clothing',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Added: Demo: Socks given. It’s on the phones after their next sync.',
    });
    expect(revalidated).toEqual([PAGE]);
  });

  it('sends Every note of this type as no field and no answer', async () => {
    answer = { status: 201, body: { id: MAP, version: 1, revision: 4 } };
    await run(addFieldSupplyAction, { ...fields, path: '', 'when.kind': '', 'when.value': '' });
    expect(sentBody()).toEqual({
      name: 'Demo: Socks given',
      noteTypeKey: 'outreach',
      lines: [{ itemId: SOCKS, qty: 2 }],
    });
  });

  it('sends an answered field as answered, whatever the answer', async () => {
    answer = { status: 201, body: { id: MAP, version: 1, revision: 4 } };
    await run(addFieldSupplyAction, { ...fields, 'when.kind': 'answered', 'when.value': 'clothing' });
    expect(sentBody().when).toEqual({ answered: true });
  });

  it('says an answer only some people may read can’t suggest supplies, beside the field', async () => {
    answer = refusal(422, 'invalid', { problems: [{ path: 'path', code: 'sensitive_path' }] });
    const r = await run(addFieldSupplyAction, { ...fields, noteTypeKey: 'harm_reduction', path: 'hr.given' });
    expect(r.state).toEqual({
      error: 'Only some people may read this answer, so it can’t suggest supplies.',
      fieldErrors: { path: 'Field: Only some people may read this answer, so it can’t suggest supplies.' },
      values: { ...fields, noteTypeKey: 'harm_reduction', path: 'hr.given' },
    });
  });

  it('says a field the note type no longer has, and an answer it can’t hold, beside each', async () => {
    answer = refusal(422, 'invalid', {
      problems: [
        { path: 'path', code: 'unknown_path' },
        { path: 'when', code: 'when_invalid' },
      ],
    });
    const r = await run(addFieldSupplyAction, fields);
    expect(r.state?.fieldErrors).toEqual({
      path: 'Field: This isn’t a field of the note type.',
      when: 'Answer: This answer isn’t one the field can hold.',
    });
  });

  it('says a refused reason beside the Reason box', async () => {
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason', problem: 'too_small' }] });
    expect((await run(addFieldSupplyAction, { ...fields, reason: 'no' })).state?.fieldErrors).toEqual({
      reason: 'Reason: Give a reason of 3 to 300 characters.',
    });
  });

  it('goes through /reauth and back to the page when the sign-in is too old', async () => {
    answer = refusal(403, 'reauth_required');
    expect((await run(addFieldSupplyAction, fields)).to).toBe(
      '/reauth?next=%2Fteam%2Fpresets%2Ffield-supplies',
    );
  });
});

describe('editing a field supply mapping', () => {
  const fields = {
    id: MAP,
    baseVersion: '1',
    name: 'Demo: Dressing put on',
    noteTypeKey: 'wound_care',
    path: 'wound.treatment.dressing',
    'when.kind': 'includes',
    'when.value': 'xeroform',
    'lines.0.itemId': GAUZE,
    'lines.0.qty': '2',
    reason: 'Demo: xeroform needs gauze over it',
  };

  it('sends the mapping as the API holds it with the form’s fields over it, at the version shown', async () => {
    listed = [{ ...(listed[0] as object), body: { ...(listed[0] as { body: object }).body, note: 'kept' } }];
    answer = { status: 200, body: { version: 2, revision: 5 } };
    const r = await run(saveFieldSupplyAction, fields);
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/v1/admin/presets/{kind}/{id}',
        init: {
          params: { path: { kind: 'field_supply_map', id: MAP } },
          body: {
            baseVersion: 1,
            body: {
              name: 'Demo: Dressing put on',
              noteTypeKey: 'wound_care',
              path: 'wound.treatment.dressing',
              when: { includes: 'xeroform' },
              lines: [{ itemId: GAUZE, qty: 2 }],
              note: 'kept',
            },
            reason: 'Demo: xeroform needs gauze over it',
          },
        },
      },
    ]);
    expect(r.state).toEqual({
      ok: true,
      message: 'Saved: Demo: Dressing put on. It’s on the phones after their next sync.',
    });
  });

  it('says someone else changed it, keeping what was typed', async () => {
    answer = refusal(409, 'stale', { currentVersion: 2 });
    expect((await run(saveFieldSupplyAction, fields)).state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: fields,
    });
  });

  it('asks nothing of the API for a form the page doesn’t write', async () => {
    for (const bad of [
      { ...fields, id: 'not-an-id' },
      { ...fields, baseVersion: '' },
    ])
      expect((await run(saveFieldSupplyAction, bad)).state?.error).toBe(
        'This can’t be found. Reload the page.',
      );
    expect(requests).toEqual([]);
  });
});
