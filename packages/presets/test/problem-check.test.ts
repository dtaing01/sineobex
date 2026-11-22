import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { problemCheckDue } from '../src/index.ts';
import type { ProblemCheck } from '../src/index.ts';

// When a problem is due a status check (phase 5 design 5.3; PRD main 476) is data: the answers live
// in packages/contract/test-vectors/problem-check.json, which the phone's problem check reads too.
// This reader holds no answer of its own. The chart (P5-chart-read) and the phone's problem lists
// (P2-problem-check) call it with the settings preset's window.
//
// The signature these tests are written to, in packages/presets/src/problem-check.ts and exported
// from the package index:
//
//   export type ProblemCheck = {
//     status: 'new' | 'ongoing' | 'resolved';
//     /** The last status set or confirmation; null where none is known yet (made on the phone). */
//     statusCheckedAt: Date | null;
//     enteredInError: boolean;
//   };
//   export function problemCheckDue(problem: ProblemCheck, now: Date, problemCheckDays: number): boolean;

interface Case {
  name: string;
  problem: { status: ProblemCheck['status']; statusCheckedAt: string | null; enteredInError: boolean };
  now: string;
  problemCheckDays: number;
  due: boolean;
}

const vectors = JSON.parse(
  readFileSync(new URL('../../contract/test-vectors/problem-check.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

const problemOf = (c: Case): ProblemCheck => ({
  status: c.problem.status,
  statusCheckedAt: c.problem.statusCheckedAt === null ? null : new Date(c.problem.statusCheckedAt),
  enteredInError: c.problem.enteredInError,
});

describe('problemCheckDue', () => {
  it('is exported from the package index', () => {
    expect(typeof problemCheckDue).toBe('function');
  });

  it('has one name per case, both answers, and every status', () => {
    expect(new Set(vectors.cases.map((c) => c.name)).size).toBe(vectors.cases.length);
    expect(new Set(vectors.cases.map((c) => c.due))).toEqual(new Set([true, false]));
    expect(new Set(vectors.cases.map((c) => c.problem.status))).toEqual(
      new Set(['new', 'ongoing', 'resolved']),
    );
    for (const days of [7, 90, 365])
      expect(vectors.cases.some((c) => c.problemCheckDays === days)).toBe(true);
  });

  for (const c of vectors.cases)
    it(c.name, () => {
      expect(problemCheckDue(problemOf(c), new Date(c.now), c.problemCheckDays)).toBe(c.due);
    });

  it('leaves the dates it is given as they were', () => {
    for (const c of vectors.cases) {
      const problem = problemOf(c);
      const now = new Date(c.now);
      const before = [problem.statusCheckedAt?.getTime(), now.getTime()];
      problemCheckDue(problem, now, c.problemCheckDays);
      expect([problem.statusCheckedAt?.getTime(), now.getTime()]).toEqual(before);
    }
  });
});
