# Card L0-migration-0018: encounter and note columns, the status trigger, the finished-note guard

## Goal

Migration `0018_encounter_lifecycle.sql` exists and gives the database the columns, the checks
and the two triggers of the lifecycle design, section 2.2, with a test for each rule.

## Level

X. A migration with triggers, on the tables every sync change writes to. A strong model writes
it and a second reviewer reads it.

## Depends on

- L0-vectors (the test reads the `encounterStatus` cases of the vector file, so the SQL function
  and the two code versions are held to one set of answers).

## Read first

- `docs/design/phase-4/lifecycle.md`, section 2.2 only, from the heading "2.2
  `0018_encounter_lifecycle.sql`" to the heading "2.3" (about 125 lines). It gives every column,
  check, function and trigger.
- `docs/plan/patterns/migration.md`, all of it (147 lines).
- `db/migrations/0013_encounter_patient_fk.sql`, all of it (18 lines): how a constraint is added
  `not valid` so that rows from before it stay as they are.

## Pattern

Recipe: `docs/plan/patterns/migration.md`. Example to copy:
`db/migrations/0016_merge_review_undo.sql` with `db/test/merge-review-undo.test.ts`.

## Files to change

- `db/migrations/0018_encounter_lifecycle.sql` (new)
- `db/test/encounter-lifecycle.test.ts` (new)

## Steps

1. Write the migration in this order, one statement group each, in one transaction:
   1. `encounters`: add `summary` and `location_text` with their length checks.
   2. `encounter_notes`: add `medical`, `completed_at`, `completed_by`, `first_signed_at`,
      `signoff_id`, `attestation`, `assigned_user_id`. Add `unique (team_id, id)`.
   3. Fill `completed_at = updated_at` and `completed_by = author_user_id` for rows whose status
      is already `completed`.
   4. Add the five check constraints of section 2.2, each `not valid`.
   5. Create `sineobex.note_is_empty`, `sineobex.encounter_status` and
      `sineobex.refresh_encounter_status`, and the trigger `encounter_notes_status` (after
      insert, or update of `status` or `data`).
   6. Create `sineobex.guard_finished_note` and the trigger `encounter_notes_finished`. The
      exception's `errcode` is `check_violation`: a class 23 error becomes a stored rejection in
      sync, and any other class stops a phone's queue.
   7. Create the two partial indexes, `encounter_notes_waiting` and `encounter_notes_cosign`.
2. Add no policy and change none. The tables keep the team policy they have. Do not touch the
   audit tables.
3. Write the tests below.
4. Check that each test bites: remove the rule from the migration, run the test, see it fail on
   the assertion that names the rule, put the rule back.

## Tests

In `db/test/encounter-lifecycle.test.ts`, using `createScratchDatabase`, `asApp`, `makeTeam` and
`makeUser` from `db/test/helpers.ts`:

1. `the encounter's status follows its notes`: for every `encounterStatus` case in
   `packages/contract/test-vectors/note-lifecycle.json`, insert the notes the case lists and
   compare `encounters.status` with the case's answer.
2. `an empty draft does not count`: a draft whose `data` is `{}`, and one whose only answers are
   `null`, `""`, `[]` and `{}`, leave the status as if the note were not there; its first real
   answer changes the status.
3. `a finished note's answers change only through a correction`: an update of `data` on a
   `completed` and on a `signed` note fails with SQLSTATE `23514`; the same update succeeds after
   `set_config('app.note_correction', <note id>, true)`; with another note's ID it fails.
4. `the update that finishes a note may change its answers`: one update that sets `status` from
   `draft` to `signed` and replaces `data` succeeds.
5. One test for each check constraint: a row that breaks it is refused.
6. `rows from before the migration stay`: insert phase 2 rows through migration 0017, run 0018,
   and see them unchanged, with `completed_at` filled for completed ones and `medical` false.
7. `the app role still cannot delete a note`.

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm -s --filter @sineobex/db test
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck
```

- The db test run prints `Test Files` with a count that says `passed` and no `failed`.
- Before pushing, `tools/ci-local.sh` under the shared lock, as `CLAUDE.md` gives it, ends with
  `All local CI checks passed`. CI also runs the migrations on Postgres 17.

## Check before you report

1. Is every statement additive, and does the file run in one transaction with no
   `create index concurrently`?
2. Is every new check constraint `not valid`?
3. Does the guard raise class 23, and did you test the SQLSTATE and not the message?
4. Does the status trigger fire on `data` as well as on `status`?
5. Does the SQL of `encounter_status` give the vector file's answer for every case?
6. Did each test fail when its rule was removed?
7. Is `git status` clean apart from the two files?

## Never

- Never edit a migration that is already on the branch. A fix is a new file.
- Never add, change or drop a row-level security policy here.
- Never make the guard raise an error outside class 23.
- Never put a rule in this migration that section 2.2 does not have. If the section looks wrong,
  stop and say so.

## If stuck

If a rule of section 2.2 cannot be written as it stands (for example a check that phase 2's rows
break), stop and report the row that breaks it. The design is corrected first, then the card.

## Context

About 8,000 tokens for this card, the section, the recipe and the example. A 32,000-token
window, because the answer is long SQL and a long test file. This card is for a strong model.

## Report

(The implementer fills this in: the files changed, the last line of each command, each test that
was checked to bite, anything that did not match the card.)
