# Recipe: mirror a server sync rule in the phone's test server

Line ranges are from commit `ead5a05`.

## When to use this

Use this whenever a change under `services/api/src/sync/**` (or a patient read route the phone
calls) changes what the API answers. The same answer must be given by
`apps/mobile/test/sync/fake_server.dart`, and a parity test must pin it.

Why the mirror exists: the fake is an in-memory server with the API's sync rules, written by hand
(lines 17-26). Fourteen files under `apps/mobile/test` import it, so a rule missing from it is a rule the
phone is never tested against. A review found seven places where phone tests passed against
behaviour the API does not have (plan risk 7). Since then the fake's agreement is itself tested
(`IMPLEMENTATION_PLAN.md` decision D52). The live tests (`live_api_test.dart`, run by
`tools/live-sync.sh`) run the same scenarios against the real API, but only in the full CI run.

## Level

**X.** `apps/mobile/test/sync/fake_server.dart` is always level X, and so is the server rule it
mirrors. The frontier model writes the parity test and the fake's change; a second review compares
the fake to the server code line by line.

A small model must not edit `fake_server.dart`, `fake_parity_test.dart`, `fake_reads_test.dart` or
`phone_harness.dart`, and must not decide what the server's answer is.

A small model may, under a T card whose tests the planner wrote first: change phone code outside
`lib/sync/**`, `lib/security/**` and `lib/auth/**` so that tests which run against the fake pass.
If such a test fails because the fake looks wrong, it stops and reports. It does not touch the fake.

## The example to copy

The rule: a change held for review is answered with no `details`; what it waits on goes to the
server's audit event, not to the phone (review finding P8).

| File and lines | What it does |
|---|---|
| `services/api/src/sync/apply.ts` 425-443 | The server's `hold`: stores the change, writes `sync.quarantined` with `waitsOn` in the audit details, returns `{ status: 'rejected', reason, quarantined: true }` |
| `services/api/test/sync.test.ts` 1360-1369 | The API test that pins the answer: `toEqual` on the whole receipt, so an extra key fails |
| `apps/mobile/test/sync/fake_server.dart` 559-565 | The fake's `_hold`: the doc comment names the server file and function; `waitsOn` is kept in `held`, the answer has three keys |
| `fake_server.dart` 530-557 | `_decide`, which calls `_hold`: the same order of checks as the server's `decide` |
| `apps/mobile/test/sync/fake_parity_test.dart` 13-81 | The helpers: `as`, `register`, `change`, `push`, `results`, `consented` |
| `fake_parity_test.dart` 158-180 | The parity test: the whole receipt compared, the retry compared to the first answer, `server.held[...]!.waitsOn` checked on the server side only |
| `fake_parity_test.dart` 225-288 | A read rule pinned the same way (`fetchRecords` through the generated client, `server.serverAudit` compared whole) |

Use `fake_parity_test.dart` for push rules and notices. Use `fake_reads_test.dart` for the patient
read routes (team index, chart, search, match); its helper `chart()` is at lines 28-52 and it reads through the generated client (`api`).

## Steps

1. Read the server rule and write down its exact answer: every key of the receipt or the response,
   the status, `reason`, `details.problem`, and what is stored. Find the API test that pins it. If
   there is none, write it first (that is server work, also X).
2. Find the fake's method. Each one's doc comment starts with the server file and function it
   mirrors, for example `/// apply.ts hold:`. Search for the server function's name:
   `grep -n "apply.ts" apps/mobile/test/sync/fake_server.dart`.
3. Write the parity test first. Shape:
   ```dart
   test('<the rule, in plain words>', () async {
     await register(casey, 'dev-casey');
     final p = server.seedPatient();
     final c = change(entityProblem, 'create', {'patientId': p, 'title': 'Cough', 'status': 'new'});
     final first = results(await push(casey, 'dev-casey', [c])).single;
     expect(first, {'changeId': c['changeId'], 'status': 'rejected', /* every key */});
     expect(results(await push(casey, 'dev-casey', [c])).single, first);
   });
   ```
   Set a role with `server.permissions[user] = FakeSyncServer.chw` (or `healthcareStaff` plus keys).
   Make records with `server.seed(entity, value, by:, at:)`, `server.seedPatient(...)` and
   `server.serverEdit(recordId, field, value, by:)`.
4. Run the test against the unchanged fake. It must fail on the assertion that names the rule.
5. Change the fake in the method that mirrors the server function. Keep the server's order of
   checks. Start the doc comment with the server file and function, and name the review finding
   if there is one.
6. Where the phone already has the rule in `lib/`, pinned to the server by a shared vector file,
   call it; do not write it again. The fake does this for values (`rulesFor`, `auditIssues`),
   access (`mayViewProblems`), blank fields (`isBlankField`) and matching.
7. If the rule is a new kind of rule, add it to the list in the class comment (lines 17-26).
8. Run every phone test that uses the fake (see Run). A test that now fails was passing against
   behaviour the API does not have: fix the phone code or that test, never the new rule.
9. Check that the parity test bites (see Tests to write).

## Tests to write

- One parity test per rule, in the file named above, with the helpers above. Compare whole maps
  and whole lists (`expect(first, {...})`), not single keys: the bug this guards against is an
  extra key or a missing one.
- Assert the retry: the same change pushed again gets the same answer.
- Assert what the server keeps and the phone must not see, on `server.held`, `server.quarantine`,
  `server.records`, `server.receipts`, `server.notices` or `server.serverAudit`.
- Assert what was not stored when the rule refuses (as lines 221-222 of `fake_parity_test.dart` do).
- Bite check, scripted, in a scratch worktree (never in the PR checkout):
  1. Commit the fake's change and the test.
  2. Put the old behaviour back in `fake_server.dart` only (for the example: add
     `'details': {'waitsOn': waitsOn}` to what `_hold` returns).
  3. `flutter test test/sync/fake_parity_test.dart` must fail, on the test that names the rule.
  4. `git checkout -- test/sync/fake_server.dart`, then run again: `All tests passed!`.
- Do the same on the server side: revert the server rule, see its API test fail, restore.

## Run

```sh
export PATH=/opt/flutter/bin:/opt/bin:$PATH
cd apps/mobile
flutter test test/sync/fake_parity_test.dart
flutter test test/sync test/patients test/features
tool/format_check.sh && flutter analyze --fatal-infos
```

Each `flutter test` ends with `All tests passed!` (the live tests are skipped without
`SINEOBEX_LIVE_API`). `flutter analyze` ends with `No issues found!` and a time. The coordinator then runs
`flock "$CI_LOCK" env ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres tools/live-sync.sh`:
only that run shows the fake and the real API giving the same answers to the same scenarios.

## What the auditor checks

1. Is there an API test that pins the same answer?
2. Does the parity test compare the whole answer, so that an extra key fails it?
3. Did the parity test fail before the fake changed, and again with the old behaviour put back?
4. Does the fake's doc comment name the server file and function it mirrors?
5. Does the fake keep the server's order of checks (permission, then value, then parents, then the entity's own checks)?
6. Does the answer to the phone leave out what only the server may know (what a held change waits on, another person's record)?
7. Do all phone tests that use the fake still pass, with no test weakened to get there?
8. Is `services/api/src/sync/**` changed only together with the fake, in the same commit or the same unit?

## Mistakes to avoid

- **Server changed, fake not.** `CLAUDE.md`: any change to `services/api/src/sync/**` comes with
  the same change to the fake. This is plan risk 7.
- **The fake told the phone more than the API does.** It used to answer a held change with
  details; the API sends none (`fake_server.dart` 559-560, review finding P8).
- **A test of one key.** `expect(r['status'], 'rejected')` passes whatever else the answer holds.
- **A rule only the fake has.** A check the server does not make lets phone code depend on it.
  Every rule in the fake has a server line it comes from.
- **Trusting the live tests alone.** They run only in the full CI run, minutes later, and cover
  scenarios, not each rule. The parity test is what fails first.
- **Fixing the fake to make a phone test pass.** The server is what runs. If the two disagree, find
  out which is right, fix the other, and say so in the commit.
