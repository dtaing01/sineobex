/// When a problem is due a status check (phase 5 design 5.3; PRD main 476): the phone's copy of
/// packages/presets/src/problem-check.ts, which packages/contract/test-vectors/problem-check.json
/// pins with it. The problem lists mark it offline with the window of the team's settings preset
/// (P5-status-check).
///
/// Written ahead of its code (P2-tests): every body that throws is P2-problem-check's.
library;

/// What [problemCheckDue] reads of a problem: its status (`new`, `ongoing` or `resolved`), when its
/// status was last set or confirmed (null for one made here that hasn't reached the server, which
/// sets it), and whether it was entered in error.
typedef ProblemCheck = ({String status, DateTime? statusCheckedAt, bool enteredInError});

/// True exactly when [problem] is New or Ongoing, not entered in error, and its status was last
/// checked more than [problemCheckDays] days before [now], a day being 24 hours of elapsed time:
/// no calendar date or time zone is read, so the phone and the server mark the same problems.
bool problemCheckDue(ProblemCheck problem, DateTime now, int problemCheckDays) =>
    throw UnimplementedError('P2-problem-check');
