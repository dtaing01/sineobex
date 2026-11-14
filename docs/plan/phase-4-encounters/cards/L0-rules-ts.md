# Card L0-rules-ts: the lifecycle rules in TypeScript

## Goal

`services/api/src/encounters/rules.ts` exists and exports nine pure functions that give the
answer the vector file expects for every case.

## Level

T. The planner wrote the tests first. The job is to make them pass without changing them.

## Depends on

- L0-vectors (the vector file `packages/contract/test-vectors/note-lifecycle.json` and its reader
  `services/api/test/encounter-rules.test.ts` are on the branch, and the reader fails because
  `rules.ts` does not exist).

## Read first

- `docs/design/phase-4/lifecycle.md`, section 3.12 only, from the heading "3.12 The small core"
  to the heading "4. Sync" (about 120 lines). It gives every signature and the order of the
  checks.
- `services/api/test/encounter-rules.test.ts`, all of it (about 60 lines) (made by L0-vectors):
  how the functions are called.
- `services/api/src/auth/permissions.ts` lines 50-73: a file of small pure rules, for style.

## Pattern

Recipe: `docs/plan/patterns/shared-vectors.md`, the paragraph "A small model may" in its Level
section, and step 6. Example to copy: `services/api/src/auth/permissions.ts` lines 50-73 (pure
functions with a comment that names their vector file).

## Files to change

- `services/api/src/encounters/rules.ts` (new)

## Steps

1. Create the file. Start it with this comment and these types:

   ```ts
   /**
    * The rules of a note's life (phase 4 design, lifecycle 3.12). Pure: no database, no clock, no
    * network. packages/contract/test-vectors/note-lifecycle.json holds every answer; the phone's
    * apps/mobile/lib/encounters/rules.dart must give the same ones.
    */
   export type NoteStatus = 'draft' | 'completed' | 'signed';
   export type Attestation = 'not_needed' | 'waiting' | 'attested';
   export type Kind = 'medical' | 'non_medical';
   ```

2. Write `signoffEffect` with the signature in section 3.12. Write the eight checks as eight
   `if` statements in the order the section lists them, each returning at once. Do not combine
   them and do not reorder them: the order decides which refusal a note gets.
3. Write `reopenEffect` the same way: five checks, in order.
4. Write `correctionEffect`: four cases, in order. "Unchanged" means `statusAfter` is the
   `noteStatus` given and `attestationAfter` is the `attestation` given.
5. Write `cosignEffect` and `attestEffect`. Each checks in the order its refusals are listed in
   the signature. For `cosignEffect`, `attestationAfter` is `'waiting'` when `needsAttestation`
   is true, else `'not_needed'`.
6. Write `mayAssign`: five checks in the order of its refusals. `credential_too_low` is
   `assigneeRank < neededRank`. `cannot_see_all` is `noteHasHiddenSection`.
7. Write `encounterStatus`: an empty list is `'draft'`; any `'draft'` in the list is `'draft'`;
   otherwise any `'completed'` is `'completed'`; otherwise `'signed'`.
8. Write `envelopeLocked`: true when any status in the list is not `'draft'`.
9. Write `isOverdue`. Use `Date.parse` on the strings. The start is `receivedAt` when
   `startedVerified` is false and `receivedAt` is not null; otherwise `startedAt`. The answer is
   true only when `noteStatus` is `'draft'` and `now` minus the start is more than
   `INCOMPLETE_AFTER_HOURS * 3600 * 1000`. Export the constant:
   `export const INCOMPLETE_AFTER_HOURS = 24;`
10. Export every function by name. No default export. No other imports.

## Tests

Already on the branch: `services/api/test/encounter-rules.test.ts` reads
`packages/contract/test-vectors/note-lifecycle.json` and runs one test per case. Do not edit
either file.

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
(cd services/api && pnpm -s vitest run test/encounter-rules.test.ts)
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck
```

- The vitest run prints `Test Files  1 passed (1)`.
- `pnpm -s lint && pnpm -s format:check && pnpm -s typecheck` prints no error and exits 0. If
  only the format check fails, run `npx prettier --write services/api/src/encounters/rules.ts`
  and run it again.

## Check before you report

1. Does each function check in exactly the order section 3.12 gives?
2. Does `signoffEffect` return `{ effect: 'none' }` for a note that is not a draft, before any
   other check?
3. Is there no `Date.now()` and no `new Date()` without an argument anywhere in the file?
4. Does the file import nothing?
5. Are the two test files unchanged (`git status` shows only `rules.ts`)?
6. Did every case pass, with none skipped?

## Never

- Never edit `packages/contract/test-vectors/note-lifecycle.json` or
  `services/api/test/encounter-rules.test.ts`. If a case looks wrong, stop and report it.
- Never read the database, the clock or the network in this file.
- Never touch `services/api/src/sync/**` or `services/api/src/auth/**`.

## If stuck

Stop and write in **Report** if a case fails after two attempts, or if the section and a vector
case disagree. Give the case's name, what the function returned and what the file expects. The
planner decides which is right.

## Context

About 7,000 tokens for this card, the section, the reader and the example, and about 3,000 for
the answer. A 16,000-token window is enough.

## Report

(The implementer fills this in: the files changed, the last line of each command, anything that
did not match the card.)
