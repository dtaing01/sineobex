# Card L0-rules-ts: the lifecycle rules in TypeScript

Level: T. Window: 16,000. Needs: L0-vectors. Done.

## Goal

`services/api/src/encounters/rules.ts` exports ten pure functions that give the answer the vector
file expects for every case.

## Read first

- `docs/design/phase-4/lifecycle.md` lines 1051-1173 (section 3.12, from the types the ten
  functions share to `isOverdue`): every signature, and the order of each function's checks.
- `services/api/test/encounter-rules.test.ts`, all of it (about 60 lines) (made by L0-vectors):
  how the functions are called.

## Files

- `services/api/src/encounters/rules.ts` (new)

## Steps

1. Start the file with this comment and these types:

   ```ts
   /**
    * The rules of a note's life (phase 4 design, lifecycle 3.12). Pure: no database, no clock, no
    * network. packages/contract/test-vectors/note-lifecycle.json holds every answer; the phone's
    * apps/mobile/lib/encounters/rules.dart must give the same ones.
    */
   export type NoteStatus = 'draft' | 'completed' | 'signed';
   export type Attestation = 'not_needed' | 'waiting' | 'attested';
   ```

2. Write `signoffEffect`, `reopenEffect`, `correctionEffect`, `cosignEffect`, `attestEffect` and
   `mayAssign` with the signatures of section 3.12. In each, write the checks as `if` statements
   in the order the section lists them, each returning at once. Do not combine or reorder them:
   the order decides which answer a note gets.
3. Write `noteIsEmpty`: true when every value of the map is `null`, `""`, an empty array or an
   object with no keys. An empty map is empty.
4. Write `encounterStatus`: leave out every note that is a `'draft'` and `empty`. Of the rest:
   none, or any `'draft'`, is `'draft'`; else a note that is `'completed'` and `medical` is
   `'completed'`; else any `'signed'` is `'signed'`; else `'completed'`.
5. Write `envelopeLocked`: true when any status in the list is not `'draft'`.
6. Write `isOverdue` with `Date.parse`. The start is `receivedAt` when `startedVerified` is false
   and `receivedAt` is not null; otherwise `startedAt`. True only for a `'draft'` whose start is
   more than `INCOMPLETE_AFTER_HOURS * 3600 * 1000` before `now`. Export
   `INCOMPLETE_AFTER_HOURS = 24`.
7. Export every function by name. No default export. No imports.

## Tests

On the branch already: `services/api/test/encounter-rules.test.ts` runs one test per case of
`packages/contract/test-vectors/note-lifecycle.json`. Do not edit either file.

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
(cd services/api && pnpm -s vitest run test/encounter-rules.test.ts)
npx prettier --write services/api/src/encounters/rules.ts
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck
```

- The test run prints `Test Files  1 passed (1)`.
- The last line prints no error.

## Audit

- `git diff --stat`: `rules.ts` only. The vector file and the test are unchanged.
- No `Date.now()`, no `new Date()` without an argument, no import.
- Read `signoffEffect` against section 3.12: the eight checks, in order. A small model tends to
  merge checks 3 and 4, which changes which refusal a note gets.
- No case skipped: the count of tests equals the count of cases in the vector file.
