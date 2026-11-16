import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  attestEffect,
  correctionEffect,
  cosignEffect,
  encounterStatus,
  envelopeLocked,
  INCOMPLETE_AFTER_HOURS,
  isOverdue,
  mayAssign,
  noteIsEmpty,
  reopenEffect,
  signoffEffect,
} from '../src/encounters/rules.ts';
import { CREDENTIALS } from '../src/auth/permissions.ts';
import { signedUnder, TRUSTED_AHEAD_MS, type SignedUnderInput } from '../src/encounters/signed-under.ts';
import { CLOCK_LIMIT_MS } from '../src/sync/push.ts';

// The rules of a note's life are data (phase 4 design, lifecycle 3.12): the answers live in
// packages/contract/test-vectors, and the phone's rules_test.dart reads the same lifecycle file.
// This reader holds no answer of its own.

interface Case {
  name: string;
  input: unknown;
  expected: unknown;
}

const vector = <T>(name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/contract/test-vectors/${name}`, import.meta.url), 'utf8'),
  ) as T;

const lifecycle = vector<{ cases: Record<string, Case[]> }>('note-lifecycle.json');

// Each function takes a case's input as its one argument.
const RULES: Record<string, (input: never) => unknown> = {
  signoffEffect,
  reopenEffect,
  correctionEffect,
  cosignEffect,
  attestEffect,
  mayAssign,
  noteIsEmpty,
  encounterStatus,
  envelopeLocked,
  isOverdue,
};

/** The refusals a function's cases show, so a list that lost one fails here and not in review. */
const refusals = (cases: Case[]) =>
  [...new Set(cases.map((c) => (c.expected as { refuse?: string } | null)?.refuse))]
    .filter((r) => r !== undefined)
    .sort();

describe('note lifecycle rules', () => {
  it('has cases for each of the ten functions and for nothing else', () => {
    expect(Object.keys(lifecycle.cases).sort()).toEqual(Object.keys(RULES).sort());
    for (const [rule, cases] of Object.entries(lifecycle.cases)) {
      expect(cases.length, rule).toBeGreaterThan(5);
      expect(new Set(cases.map((c) => c.name)).size, `${rule}: one name per case`).toBe(cases.length);
    }
  });

  it('shows every refusal each function can give', () => {
    const shown = Object.fromEntries(Object.entries(lifecycle.cases).map(([rule, c]) => [rule, refusals(c)]));
    expect(shown).toMatchObject({
      signoffEffect: ['content_changed', 'incomplete', 'red_flags_first'],
      cosignEffect: ['cannot_see_all', 'cannot_sign', 'content_changed', 'is_author', 'not_waiting'],
      attestEffect: [
        'cannot_attest',
        'cannot_see_all',
        'content_changed',
        'is_author',
        'is_signer',
        'not_waiting',
      ],
      mayAssign: [
        'assignee_cannot_chart',
        'assignee_not_member',
        'author_active',
        'cannot_see_all',
        'credential_too_low',
      ],
    });
  });

  for (const [rule, cases] of Object.entries(lifecycle.cases)) {
    describe(rule, () => {
      for (const c of cases) {
        it(c.name, () => {
          expect(RULES[rule]!(c.input as never)).toEqual(c.expected);
        });
      }
    });
  }

  it('calls a note incomplete after 24 hours (PRD main 99)', () => {
    expect(INCOMPLETE_AFTER_HOURS).toBe(24);
  });
});

describe('the credential a signature is recorded under', () => {
  const cases = vector<{ cases: Case[] }>('signed-under.json').cases;
  const fault = (c: Case) => (c.expected as { throws?: string }).throws;
  const answers = cases
    .filter((c) => fault(c) === undefined)
    .map((c) => c.expected as ReturnType<typeof signedUnder>);

  it('has cases for every credential, and for a time that is trusted and one that is not', () => {
    expect(cases.length).toBeGreaterThan(20);
    expect([...new Set(answers.map((a) => a.credential))].sort()).toEqual([...CREDENTIALS].sort());
    expect(new Set(answers.map((a) => a.timeTrusted))).toEqual(new Set([true, false]));
  });

  for (const c of cases) {
    it(c.name, () => {
      const message = fault(c);
      if (message === undefined) expect(signedUnder(c.input as SignedUnderInput)).toEqual(c.expected);
      else expect(() => signedUnder(c.input as SignedUnderInput)).toThrow(message);
    });
  }

  it('believes a time as far ahead of its receipt as a push lets a phone clock be', () => {
    expect(TRUSTED_AHEAD_MS).toBe(CLOCK_LIMIT_MS);
  });
});
