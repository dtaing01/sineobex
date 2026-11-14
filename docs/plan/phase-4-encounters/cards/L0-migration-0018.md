# Card L0-migration-0018: note and encounter columns, the status trigger, the finished-note guard

Level: X. Window: 32,000. Needs: L0-vectors.

## Goal

Migration `0018_encounter_lifecycle.sql` gives the database the columns, checks and two triggers
of the lifecycle design, section 2.2, with a test for each rule.

## Read first

- `docs/design/phase-4/lifecycle.md`, section 2.2, from its heading to the heading "2.3" (about
  125 lines): every column, check, function and trigger.
- `docs/plan/patterns/migration.md` lines 52-121: the steps, the tests and the commands.

## Files

- `db/migrations/0018_encounter_lifecycle.sql` (new)
- `db/test/encounter-lifecycle.test.ts` (new)

## Steps

1. Write the migration in this order, in one transaction:
   1. `encounters`: `summary` and `location_text`, with their length checks.
   2. `encounter_notes`: `medical`, `completed_at`, `completed_by`, `first_signed_at`,
      `signoff_id`, `attestation`, `assigned_user_id`; `unique (team_id, id)`.
   3. Fill `completed_at` and `completed_by` for rows that are already `completed`.
   4. The five check constraints of section 2.2, each `not valid`, as
      `db/migrations/0013_encounter_patient_fk.sql` adds its constraint.
   5. `note_is_empty`, `encounter_status`, `refresh_encounter_status`, and the trigger
      `encounter_notes_status` (after insert, or update of `status` or `data`).
   6. `guard_finished_note` and the trigger `encounter_notes_finished`. Its error is
      `check_violation`: a class 23 error becomes a stored rejection in sync, and any other class
      stops a phone's queue.
   7. The two partial indexes.
2. Add no policy and change none. Do not touch the audit tables.
3. Write the tests below, then check that each one bites.

## Tests

In `db/test/encounter-lifecycle.test.ts`, with the helpers of `db/test/helpers.ts`:

1. `the encounter's status follows its notes`: every `encounterStatus` case of
   `packages/contract/test-vectors/note-lifecycle.json`, inserted as notes, gives the case's
   answer in `encounters.status`.
2. `an empty draft does not count`: a draft with `{}`, and one whose answers are all blank, leave
   the status as if the note were absent; its first real answer changes the status.
3. `a finished note's answers change only through a correction`: an update of `data` on a
   finished note fails with SQLSTATE `23514`; it succeeds after
   `set_config('app.note_correction', <note id>, true)`; with another note's ID it fails.
4. `the update that finishes a note may change its answers`: one update from `draft` to `signed`
   that also replaces `data` succeeds.
5. One test for each check constraint.
6. `rows from before the migration stay`: phase 2 rows inserted before 0018 are unchanged
   after it, with `completed_at` filled for completed ones and `medical` false.
7. `the app role still cannot delete a note`.

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm -s --filter @sineobex/db test
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck
```

- The test run prints `Test Files` with a count that says `passed` and no `failed`.
- Before pushing: `tools/ci-local.sh` under the shared lock (`CLAUDE.md`) ends with
  `All local CI checks passed`. CI also runs the migrations on Postgres 17.

## Audit

A second reviewer reads the migration against section 2.2, and checks:

- Every statement is additive; no `create index concurrently`; every new check is `not valid`.
- The guard raises class 23, and the test asserts the SQLSTATE, not the message.
- The status trigger fires on `data` as well as on `status`.
- Each test fails with its rule removed from the migration (remove, run, restore).
- No rule in the file that section 2.2 does not have.
