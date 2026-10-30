import { createHash, randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { registerPhone } from './helpers';

// Fresh made-up patients and problems, sent the way a phone sends them, for specs that change what
// they work on (merge it, reverse it) and so must not use seeded rows other specs read. Every run
// makes new names, so a rerun against the same database works.

/** Canonical JSON (services/api/src/sync/canonical.ts) for the plain ASCII values sent here. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export interface PhoneChange {
  entity: string;
  recordId: string;
  op: 'create' | 'set';
  field?: string;
  value: unknown;
  baseVersion?: number;
  /** When the phone made it, so records have an order. */
  minutesAgo: number;
}

/** A phone for a seeded staff member. `send` pushes changes in order and expects each accepted. */
export async function phoneOf(email: string) {
  const phone = await registerPhone(email);
  let seq = 0;
  return {
    token: phone.token,
    async send(...changes: PhoneChange[]) {
      const body = await phone.push(
        changes.map((c) => ({
          changeId: randomUUID(),
          seq: ++seq,
          entity: c.entity,
          recordId: c.recordId,
          op: c.op,
          ...(c.field ? { field: c.field } : {}),
          value: c.value,
          valueHash: createHash('sha256').update(canonical(c.value)).digest('hex'),
          baseVersion: c.baseVersion ?? 0,
          deviceTime: new Date(Date.now() - c.minutesAgo * 60_000).toISOString(),
          clockVerified: true,
        })),
      );
      const results = body.results as { status: string }[];
      expect(
        results.map((r) => r.status),
        JSON.stringify(results),
      ).toEqual(changes.map(() => 'accepted'));
    },
  };
}

/** A made-up surname nobody has used yet: "Kqzvbn". */
export function newSurname(): string {
  const letters = Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26)));
  return letters[0]!.toUpperCase() + letters.slice(1).join('');
}

/** A made-up birth date, different each run, so this run's patients don't match the last run's. */
export function newBirthDate(): string {
  const n = (max: number) => 1 + Math.floor(Math.random() * max);
  return `${1940 + n(40)}-${String(n(12)).padStart(2, '0')}-${String(n(28)).padStart(2, '0')}`;
}

/** A patient create as intake sends it: consent given verbally, privacy notice acknowledged. */
export function newPatient(fields: Record<string, unknown>, minutesAgo: number): PhoneChange {
  return {
    entity: 'patient',
    recordId: randomUUID(),
    op: 'create',
    minutesAgo,
    value: {
      consent: {
        id: randomUUID(),
        decision: 'given',
        method: 'verbal',
        scriptVersion: '2026-10-1',
        language: 'en',
      },
      privacyNotice: { id: randomUUID(), decision: 'acknowledged' },
      ...fields,
    },
  };
}
