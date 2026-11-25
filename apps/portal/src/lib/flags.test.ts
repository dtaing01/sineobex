import type { Schemas } from '@sineobex/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from './api';
import {
  changeFlag,
  flagChoices,
  listFlags,
  markableChanges,
  markFlagChange,
  type ListedFlag,
} from './flags';

// The portal's calls for a patient's flags (phase 5 design 7, 8.1; card P5-portal-panel), written
// ahead of their code: each fails until that card lands. The API is a stand-in that records each
// request and answers it with `answer`. Every value is made up.
const requests: { method: string; path: string; init: { params?: unknown; body?: unknown } }[] = [];
let answer: { status: number; body: unknown };

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-pathname': '/patients' }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  api: async () => {
    const call = (method: string) => async (path: string, init: { params?: unknown; body?: unknown }) => {
      requests.push({ method, path, init });
      const response = new Response(JSON.stringify(answer.body), { status: answer.status });
      return answer.status < 300 ? { data: answer.body, response } : { error: answer.body, response };
    };
    return { GET: call('GET'), POST: call('POST') };
  },
}));

const PATIENT = '5eed0000-0000-4000-8000-0000000000f1';
const ALEX = 'a0000000-0000-4000-8000-00000000000a';
const BLAIR = 'b0000000-0000-4000-8000-00000000000b';
const HIGH = '30f20000-0000-4000-8000-000000000001';
const MEDIUM = '30f20000-0000-4000-8000-000000000002';
const FROST = '30f20000-0000-4000-8000-000000000011';
const HEAT = '30f20000-0000-4000-8000-000000000012';
const CHANGE = 'cf000000-0000-4000-8000-000000000001';
const MINE = 'cf000000-0000-4000-8000-000000000002';
const MARKED = 'cf000000-0000-4000-8000-000000000003';

const refusal = (status: number, code: string, details?: Record<string, unknown>) => ({
  status,
  body: { error: { code, message: 'The API’s words.', ...(details ? { details } : {}) } },
});

const listed: ListedFlag[] = [
  { flagId: HIGH, name: 'Demo: High', tier: 'primary', color: 'red', colorName: 'Red', rank: 10 },
  { flagId: MEDIUM, name: 'Demo: Medium', tier: 'primary', color: 'yellow', colorName: 'Yellow', rank: 20 },
  { flagId: FROST, name: 'Demo: Frost risk', tier: 'secondary', color: 'blue', colorName: 'Blue', rank: 10 },
];

/** A snapshot of a flag change as the chart's `flagChanges` gives it. */
const snapshot = (id: string, author: string, status = 'active') => ({
  entity: 'patient_flag_change',
  id,
  status,
  authorUserId: author,
  createdAt: '2026-10-21T15:00:00.000Z',
  updatedAt: '2026-10-21T15:00:00.000Z',
  version: status === 'active' ? 1 : 2,
  attributes: { patientId: PATIENT, flagId: FROST, action: 'set', effectiveAt: '2026-10-21T15:00:00.000Z' },
  fields: {
    enteredInError: { value: status === 'active' ? null : {}, version: status === 'active' ? 0 : 1 },
  },
});

/** A chart carrying High and Frost risk, and Heat risk, which the team removed from its list. */
const chart = {
  canonicalId: PATIENT,
  flagChanges: [snapshot(CHANGE, BLAIR), snapshot(MINE, ALEX), snapshot(MARKED, ALEX, 'entered_in_error')],
  flags: {
    primary: {
      flagId: HIGH,
      name: 'Demo: High',
      tier: 'primary',
      color: 'red',
      colorName: 'Red',
      rank: 10,
      archived: false,
    },
    secondary: [
      {
        flagId: FROST,
        name: 'Demo: Frost risk',
        tier: 'secondary',
        color: 'blue',
        colorName: 'Blue',
        rank: 10,
        archived: false,
      },
      {
        flagId: HEAT,
        name: 'Demo: Heat risk',
        tier: 'secondary',
        color: 'orange',
        colorName: 'Orange',
        rank: 5,
        archived: true,
      },
    ],
    history: [],
  },
} as unknown as Schemas['PatientChart'];

beforeEach(() => {
  requests.length = 0;
  answer = { status: 200, body: listed };
});

describe('the flag list', () => {
  it('reads the team’s flags the person may see from the API, as it gives them', async () => {
    expect(await listFlags()).toEqual(listed);
    expect(requests).toEqual([{ method: 'GET', path: '/v1/presets/flags', init: expect.anything() }]);
  });
});

describe('Set or clear', () => {
  const body = { id: CHANGE, flagId: HIGH, action: 'set' as const, reason: 'Demo: left hospital this week' };

  it('posts the change with the ID the page made for the form, and a retry posts the same ID (D115)', async () => {
    answer = { status: 201, body: { id: CHANGE } };
    expect(await changeFlag(PATIENT, body)).toEqual({ done: true });
    expect(await changeFlag(PATIENT, body)).toEqual({ done: true });
    expect(requests).toHaveLength(2);
    for (const r of requests) {
      expect([r.method, r.path]).toEqual(['POST', '/v1/patients/{patientId}/flags']);
      expect(r.init).toEqual({ params: { path: { patientId: PATIENT } }, body });
    }
  });

  it('answers a refusal with its status, code and details, for the panel to word', async () => {
    for (const [status, code] of [
      [422, 'unknown_flag'],
      [422, 'reason_invalid'],
      [409, 'archived'],
      [404, 'not_found'],
      [403, 'forbidden'],
    ] as const) {
      answer = refusal(status, code);
      expect(await changeFlag(PATIENT, body)).toEqual({ refused: { status, code } });
    }
    answer = refusal(422, 'validation_failed', { fields: [{ path: 'reason' }] });
    expect(await changeFlag(PATIENT, body)).toEqual({
      refused: { status: 422, code: 'validation_failed', details: { fields: [{ path: 'reason' }] } },
    });
  });
});

describe('Entered in error', () => {
  it('posts the reason for the change named, and takes a mark already made as done', async () => {
    answer = { status: 200, body: { version: 2 } };
    expect(await markFlagChange(PATIENT, MINE, 'Demo: set on the wrong patient')).toEqual({ done: true });
    expect(requests[0]).toEqual({
      method: 'POST',
      path: '/v1/patients/{patientId}/flag-changes/{changeId}/entered-in-error',
      init: {
        params: { path: { patientId: PATIENT, changeId: MINE } },
        body: { reason: 'Demo: set on the wrong patient' },
      },
    });
    // A retry after a dropped answer finds its own mark made.
    answer = refusal(409, 'already_marked');
    expect(await markFlagChange(PATIENT, MINE, 'Demo: set on the wrong patient')).toEqual({ done: true });
    answer = refusal(403, 'forbidden');
    expect(await markFlagChange(PATIENT, CHANGE, 'Demo: not mine')).toEqual({
      refused: { status: 403, code: 'forbidden' },
    });
  });
});

describe('what the panel offers', () => {
  it('each listed flag, then each removed flag the patient carries, offered only to clear', () => {
    const choices = flagChoices(listed, chart);
    expect(choices.map((c) => [c.flagId, c.clearOnly, c.carried])).toEqual([
      [HIGH, false, true],
      [MEDIUM, false, false],
      [FROST, false, true],
      [HEAT, true, true],
    ]);
    expect(choices.at(-1)).toMatchObject({ name: 'Demo: Heat risk', colorName: 'Orange', tier: 'secondary' });
  });

  it('a flag neither listed nor on the chart, as a sensitive one is to a reader who may not see it, is not offered', () => {
    expect(
      flagChoices(listed.slice(0, 2), { ...chart, flags: { primary: null, secondary: [], history: [] } }).map(
        (c) => c.flagId,
      ),
    ).toEqual([HIGH, MEDIUM]);
  });

  it('Entered in error on the person’s own changes, or on anyone’s for a Program Admin; never on one marked', () => {
    const edit = ['patients.view', 'patients.edit'];
    expect(markableChanges(chart, { userId: ALEX, permissions: edit })).toEqual([MINE]);
    expect(
      markableChanges(chart, { userId: ALEX, permissions: [...edit, 'team.manage_users'] }).sort(),
    ).toEqual([CHANGE, MINE].sort());
    expect(
      markableChanges(chart, { userId: ALEX, permissions: ['patients.view', 'team.manage_users'] }),
    ).toEqual([]);
    expect(
      markableChanges({ ...chart, flagChanges: undefined }, { userId: ALEX, permissions: edit }),
    ).toEqual([]);
  });
});
