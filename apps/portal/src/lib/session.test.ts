import { describe, expect, it } from 'vitest';
import { IDLE_MINUTES, idleState, MAX_SESSION_HOURS } from './session';

describe('idle sign-out', () => {
  const start = Date.parse('2026-10-20T08:00:00Z');
  it('stays active within 15 minutes of the last request', () => {
    expect(idleState({ startedAt: start, lastActivity: start }, start + (IDLE_MINUTES * 60_000 - 1))).toBe(
      'active',
    );
  });
  it('ends after 15 idle minutes', () => {
    expect(idleState({ startedAt: start, lastActivity: start }, start + IDLE_MINUTES * 60_000 + 1)).toBe(
      'idle',
    );
  });
  it('ends after a working day however active', () => {
    const now = start + MAX_SESSION_HOURS * 3600_000 + 1;
    expect(idleState({ startedAt: start, lastActivity: now - 1000 }, now)).toBe('too_old');
  });
  it('treats a session with no timestamps as ended', () => {
    expect(idleState({}, start)).toBe('too_old');
  });
});
