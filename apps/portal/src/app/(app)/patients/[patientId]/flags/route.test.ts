import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Flags from '@/lib/flags';
import { POST } from './route';

// Set or clear, posted by the Flags panel (phase 5 design 7, 8.1; D115; card P5-portal-panel),
// written ahead of its code: it fails until that card lands. The API's call is a stand-in that
// records what it was sent and answers `outcome`. Every value is made up.
const sent: { patientId: string; body: unknown }[] = [];
let outcome: Awaited<ReturnType<typeof Flags.changeFlag>>;
vi.mock('@/lib/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof Flags>()),
  changeFlag: async (patientId: string, body: unknown) => {
    sent.push({ patientId, body });
    return outcome;
  },
}));

const PATIENT = '5eed0000-0000-4000-8000-0000000000f4';
const FLAG = '30f50000-0000-4000-8000-000000000001';
const ID = 'cf200000-0000-4000-8000-000000000001';

const post = (
  body: unknown,
  headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' },
  patientId = PATIENT,
) =>
  POST(
    new NextRequest(`http://portal.test/patients/${patientId}/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ patientId }) },
  );

beforeEach(() => {
  sent.length = 0;
  outcome = { done: true };
});

describe('Set or clear', () => {
  const body = { id: ID, flagId: FLAG, action: 'set', reason: 'Demo: left hospital this week' };

  it('sends the change with the ID made once for the form; a retry sends the same, and is told it is done', async () => {
    for (let i = 0; i < 2; i++) {
      const answer = await post(body);
      expect(answer.status).toBe(200);
      expect(answer.headers.get('cache-control')).toBe('no-store');
      expect(await answer.json()).toEqual({ ok: true });
    }
    expect(sent).toEqual([
      { patientId: PATIENT, body },
      { patientId: PATIENT, body },
    ]);
  });

  it('refuses a post from another site, and one the panel never sends, sending nothing', async () => {
    expect((await post(body, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    for (const bad of [
      null,
      { ...body, id: 'not-an-id' },
      { ...body, flagId: 'not-an-id' },
      { ...body, action: 'toggle' },
      { ...body, reason: 7 },
      { flagId: FLAG, action: 'set', reason: 'Demo: no id' },
    ]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(422);
    }
    expect((await post(body, undefined, 'not-a-patient')).status).toBe(404);
    expect(sent).toEqual([]);
  });

  it('answers a refusal in the panel’s words, never the API’s', async () => {
    outcome = { refused: { status: 409, code: 'archived' } };
    const answer = await post(body);
    expect(answer.status).toBe(409);
    const said = (await answer.json()) as { ok: boolean; error: string };
    expect(said.ok).toBe(false);
    expect(said.error).not.toContain('The API’s words.');
    expect(said.error.length).toBeGreaterThan(0);
  });
});
