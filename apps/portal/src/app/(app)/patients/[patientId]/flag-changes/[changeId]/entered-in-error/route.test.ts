import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Flags from '@/lib/flags';
import { POST } from './route';

// Entered in error, posted by the Flags panel (phase 5 design 7, 8.1; D115; card P5-portal-panel),
// written ahead of its code: it fails until that card lands. The API's call is a stand-in that
// records what it was sent and answers `outcome` (lib/flags.ts answers a mark already made as done).
// Every value is made up.
const sent: { patientId: string; changeId: string; reason: string }[] = [];
let outcome: Awaited<ReturnType<typeof Flags.markFlagChange>>;
vi.mock('@/lib/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof Flags>()),
  markFlagChange: async (patientId: string, changeId: string, reason: string) => {
    sent.push({ patientId, changeId, reason });
    return outcome;
  },
}));

const PATIENT = '5eed0000-0000-4000-8000-0000000000f5';
const CHANGE = 'cf300000-0000-4000-8000-000000000001';

const post = (
  body: unknown,
  { site = 'same-origin', changeId = CHANGE }: { site?: string; changeId?: string } = {},
) =>
  POST(
    new NextRequest(`http://portal.test/patients/${PATIENT}/flag-changes/${changeId}/entered-in-error`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': site },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ patientId: PATIENT, changeId }) },
  );

beforeEach(() => {
  sent.length = 0;
  outcome = { done: true };
});

describe('Entered in error', () => {
  it('marks the change named with the reason given, and a retry is told it is done', async () => {
    for (let i = 0; i < 2; i++) {
      const answer = await post({ reason: 'Demo: set on the wrong patient' });
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ ok: true });
    }
    expect(sent).toEqual([
      { patientId: PATIENT, changeId: CHANGE, reason: 'Demo: set on the wrong patient' },
      { patientId: PATIENT, changeId: CHANGE, reason: 'Demo: set on the wrong patient' },
    ]);
  });

  it('refuses another site, a change ID that is no ID and a body the panel never sends, sending nothing', async () => {
    expect((await post({ reason: 'Demo: x y z' }, { site: 'cross-site' })).status).toBe(403);
    expect((await post({ reason: 'Demo: x y z' }, { changeId: 'nope' })).status).toBe(404);
    for (const bad of [null, {}, { reason: 3 }])
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(422);
    expect(sent).toEqual([]);
  });

  it('answers the person’s own refusal in the panel’s words: not theirs to mark', async () => {
    outcome = { refused: { status: 403, code: 'forbidden' } };
    const answer = await post({ reason: 'Demo: not mine' });
    expect(answer.status).toBe(403);
    const said = (await answer.json()) as { ok: boolean; error: string };
    expect([said.ok, said.error.length > 0, said.error.includes('The API’s words.')]).toEqual([
      false,
      true,
      false,
    ]);
  });
});
