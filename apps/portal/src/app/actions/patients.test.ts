import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import { searchPatients } from './patients';

// The patient search with Risk level and Conditions (phase 5 design 7, 8.1; section 11, row 37; card
// P5-portal-filters), written ahead of their code: the flags chosen go in the search's POST body as
// `flagIds`, never the address, and narrow a name or birth search; a flag alone browses nothing.
// The API is a stand-in that records each request and answers `answer`. Every value is made up.
const requests: { path: string; body: Record<string, unknown> }[] = [];
let answer: { status: number; body: unknown };

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-pathname': '/patients' }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  api: async () => ({
    POST: async (path: string, init: { body: Record<string, unknown> }) => {
      requests.push({ path, body: init.body });
      const response = new Response(JSON.stringify(answer.body), { status: answer.status });
      return answer.status < 300 ? { data: answer.body, response } : { error: answer.body, response };
    },
  }),
}));

const HIGH = '30f70000-0000-4000-8000-000000000001';
const FROST = '30f70000-0000-4000-8000-000000000011';
const WET = '30f70000-0000-4000-8000-000000000012';

const form = (fields: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
};

beforeEach(() => {
  requests.length = 0;
  answer = { status: 200, body: { hits: [], truncated: false } };
});

describe('a search narrowed by flags', () => {
  it('sends the risk level and each condition chosen as flagIds, in the body, with the name; none chosen, none', async () => {
    const state = await searchPatients(
      form([
        ['name', 'Demo Wren'],
        ['riskLevel', HIGH],
        ['conditions', FROST],
        ['conditions', WET],
      ]),
    );
    expect(state.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe('/v1/patients/search');
    expect(requests[0]!.body).toMatchObject({ name: 'Demo Wren', surface: 'portal' });
    expect([...(requests[0]!.body.flagIds as string[])].sort()).toEqual([HIGH, FROST, WET].sort());

    // None chosen: the search as it was before, with no flagIds.
    await searchPatients(
      form([
        ['name', 'Demo Wren'],
        ['riskLevel', ''],
      ]),
    );
    expect(requests[1]!.body).not.toHaveProperty('flagIds');
  });

  it('a flag value that is no ID is refused, and a flag alone browses nothing, each sending nothing', async () => {
    const odd = await searchPatients(
      form([
        ['name', 'Demo Wren'],
        ['conditions', 'not-an-id'],
      ]),
    );
    expect(odd.ok).toBeFalsy();
    expect(requests).toEqual([]);
    const alone = await searchPatients(form([['riskLevel', HIGH]]));
    expect(alone.fieldErrors?.name).toBe('Type a name, street name or description, or a full date of birth.');
    expect(requests).toEqual([]);
  });
});

describe('what a search narrowed by flags gives back', () => {
  it('keeps the conditions searched for the form to tick again, and says when the flags found no one', async () => {
    const state = await searchPatients(
      form([
        ['name', 'Demo Wren'],
        ['riskLevel', HIGH],
        ['conditions', FROST],
        ['conditions', WET],
      ]),
    );
    expect(state.values).toMatchObject({ name: 'Demo Wren', riskLevel: HIGH, conditions: `${FROST},${WET}` });
    expect(state.message).toBe(
      'No one found with every flag chosen. Choose fewer, or try part of a name or the full date of birth.',
    );
    // Without flags, phase 3's words.
    expect((await searchPatients(form([['name', 'Demo Wren']]))).message).toBe(
      'No one found. Try part of a name, a street name, or the full date of birth.',
    );
  });
});
