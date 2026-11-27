/**
 * When a problem is due a status check (phase 5 design 5.3; PRD main 476). The chart marks it
 * (P5-chart-read) and the phone's problem lists mark it offline (P2-problem-check), with the window
 * of the team's settings preset; phase 7's bag check reads the same window.
 * packages/contract/test-vectors/problem-check.json pins the TypeScript and the Dart.
 *
 * Pure, and in the API's edge bundle: it imports nothing.
 */

// A day is 24 hours of elapsed time: no calendar date or time zone is read, so a phone and the
// server, wherever each is, mark the same problems.
const DAY_MS = 86_400_000;

export type ProblemCheck = {
  status: 'new' | 'ongoing' | 'resolved';
  /** The last status set or confirmation; null where none is known yet (made on the phone). */
  statusCheckedAt: Date | null;
  enteredInError: boolean;
};

// PLAN-OPEN (BM-76): when is a problem due a status check? When it is New or Ongoing and its status
// was last checked more than the team's window ago (90 days unless the team sets another).
export function problemCheckDue(problem: ProblemCheck, now: Date, problemCheckDays: number): boolean {
  if (problem.status === 'resolved' || problem.enteredInError) return false;
  // The server sets the time when the problem reaches it; until then it was made just now. A time
  // after now, from a clock that ran ahead, is not due either.
  if (problem.statusCheckedAt === null) return false;
  return now.getTime() - problem.statusCheckedAt.getTime() > problemCheckDays * DAY_MS;
}
