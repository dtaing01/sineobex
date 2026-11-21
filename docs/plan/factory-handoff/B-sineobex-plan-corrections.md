# B. Sineobex Plan Corrections (PR dtaing01/sineobex#5)

Against `ca2c4db`. **[V]** verified against the repository on Nov 16, **[I]** to check, **[P]** a
proposed edit, **not applied**. Every edit points at an existing section rather than restating it. Line numbers are as of
`ca2c4db`.

## 1. Card counts, reproducibly

### 1.1 The baseline: what the repository says today [V]

Scripts: `scripts/count-cards.mjs` (phases 5–12, from each design's §13 tables) and
`scripts/count-phase4.mjs` (phase 4's index, expanding the prose rows by the index's own rules).
Run each with the repo path as its argument. Set `ROWS=1` to list every card.

| Phase | S | T | R | X | Total | Local (S+T+R) | Matches the doc's own count |
|---|---|---|---|---|---|---|---|
| 4 | 40 | 67 | 64 | 49 | 220 | 171 | [V] index lines 366-385 |
| 5 | 4 | 31 | 30 | 14 | 79 | 65 | [V] |
| 6 | 3 | 28 | 27 | 26 | 84 | 58 | [V] |
| 7 | 3 | 31 | 30 | 21 | 85 | 64 | [V] |
| 8 | 3 | 20 | 15 | 35 | 73 | 38 | [V] |
| 9 | 3 | 18 | 18 | 21 | 60 | 39 | [V] |
| 10 | 3 | 31 | 17 | 16 | 67 | 51 | [V] |
| 12 | 1 | 8 | 10 | 47 | 66 | 19 | [V] |
| **All** | **60** | **234** | **211** | **229** | **734** | **505** | |

**Reconciling 458/276** [V]: no commit has these counts. Summing the Count lines at each of the
twelve commits that touched `docs/design` and the phase 4 index; the totals ran 127, 204, then 514
for phases 5–12, always with phase 4 at 220. The arithmetic is exact, though: 458 = 505 − 47 and
276 = 229 + 47, and **47 is phase 12's X count**. That fits phase 12's X cards being added twice,
with "local" then worked out as 734 − X. [I] It's a hypothesis: ask whoever produced 458/276.

**The baseline is 505 local / 229 X / 734 total.** It stays the baseline until the corrections are
applied to the designs and the index.

### 1.2 The proposed revision [P], not applied

If every change in §3 and §4 is accepted: **503 local / 237 X / 740 total**. The derivation is in
§4, "Count changes". The scripts count the repository as it is, so they will print the revision
only once the edits have landed.

## 2. Defects that block execution (fix before any T card is written)

### 2.1 Tests written first break the checks each T card runs [V]

- The level T card `L0-rules-ts` runs repo-wide `pnpm -s typecheck` (card, Run block).
  `services/api/tsconfig.json` includes `test`, so `tsc` fails on any test file that imports a
  module not written yet.
- Tests cards write several units' test files at once. `F0-tests` writes seven, including E's
  `export.test.ts`, whose module comes in wave 3. `L0-vectors` writes one TS reader,
  `services/api/test/encounter-rules.test.ts`, which reads all three vector files
  (`lifecycle.md` 3.12 and 11.2).
- As a result, `L0-rules-ts`, `L0-signed-under-ts` and `L0-content-hash-ts` all run the same
  test file. Each fails until the other two exist, and `L0-content-hash-ts` also waits on
  `F1-effective`. None of the three can ever pass on its own, so the runner would send every one
  back. F0's T cards fail the same way until wave 3.

**[P] Corrections:**

1. **One reader per implementation file.** In `lifecycle.md` 3.12, replace "both readers
   (`services/api/test/encounter-rules.test.ts`, `apps/mobile/test/encounters/rules_test.dart`)"
   with: "a reader per function file: `services/api/test/encounter-rules.test.ts`,
   `signed-under.test.ts`, `note-content-hash.test.ts`, `apps/mobile/test/encounters/rules_test.dart`,
   `content_hash_test.dart`".
2. **T-card Run blocks check only the card's own scope.** In `docs/plan/README.md`, "What the check
   cannot see", add: "A level T card's Run checks only what the card wrote: its test file(s); `npx
   eslint --max-warnings=0` and `npx prettier --check` on its files; `tsc --noEmit -p
   <package>/tsconfig.src.json` (the package's sources without its tests); on the phone, `dart
   analyze --fatal-infos <its files>`. The repo-wide lint, type check and analyze run when a set of
   cards lands (2.2)." [I] `dart analyze` on a list of files, under Flutter 3.47.6: not checked
   here: the machine that checked these documents had no Flutter.
3. **`tsconfig.src.json`** (extends the package's `tsconfig.json`, `include: ["src"]`). It's added
   by the tests card that first puts unwritten-module tests in a package: `L0-vectors-lifecycle` for
   `services/api`, `F0-tests` for `packages/forms`.
4. In `L0-rules-ts.md`, replace the Run block:

   ```sh
   export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
   (cd services/api && pnpm -s vitest run test/encounter-rules.test.ts)
   npx prettier --write services/api/src/encounters/rules.ts
   npx eslint --max-warnings=0 services/api/src/encounters/rules.ts
   (cd services/api && npx tsc --noEmit -p tsconfig.src.json)
   ```

   Change the header to `Needs: L0-vectors-lifecycle.`

### 2.2 Landings: the PR branch stays green while a unit is open [V]

The README loop commits each audited card to "the phase's branch" (`docs/plan/README.md` "The
loop", 5). With tests written first, that branch is red until the unit's last T card lands, and
then no other unit can pass `tools/ci-local.sh`. The coordinator workflow in `CLAUDE.md` already
keeps one branch per unit.

**[P]** In `docs/plan/README.md`, "The loop", replace step 5 and add a step:

> 5. Commit the audited card on its unit's branch, `unit/<phase>-<unit>` (made from the phase's
>    branch), with `Done.` added to its header in the same commit.
> 6. A **landing** is a set of a unit's Done cards whose tests all pass: the tests card that wrote a
>    test lands with the card that makes it pass, never before. A landing goes onto the phase's
>    branch after `tools/ci-local.sh` passes on it. A card whose Needs are in another unit waits
>    until that unit has landed in full.

### 2.3 The fake falls behind the server for a whole wave [V]

`CLAUDE.md`: "Any change to `services/api/src/sync/**` comes with the same change to the fake."
`lifecycle.md` §4.9 says the same, rule by rule. The order table (index 56-65) still
lands L1 in wave 4 and L3-fake-* in wave 5.

**[P]** After index line 71, add: "L1 lands together with L3-fake-encounter, L3-fake-signoff,
L3-fake-rest and L3-parity, as one landing (2.2). L3's other cards may follow."

### 2.4 Needs that a program can read [V]

| Index line | Now | [P] Replace with |
|---|---|---|
| 126-130 | F2's 14 card IDs in a sentence | A table of 14 rows: `\| F2-<name> \| T \| phone/forms/<name>.dart \| F1-<name> \|` |
| 162 | `F5-info, F5-text, … F5-photo` in one row | One row each |
| 203, 206, 207 | `F6-sexrepro-1, -2, -3`; `F6-quick-1, -2`; `F6-exam-01 to F6-exam-22` | One row each |
| 134 | `F2 (the fourteen), E-golden` | `F2, E-golden` (the rule at line 75 expands a unit name) |
| 171 | `the widget cards` | The 15 F5 widget IDs |
| 192-193, 212 | "each needing F6-lists, E-presets and the shape card"; `every F6 transcription card` | Each row's Needs written out. `F6-psychological.md` also needs `F6-spec-pieces` and `F6-red-flags`, and the index row should match the card |
| 231 | `L0-migration-0018` needs `—` | `L0-vectors-lifecycle` (the card's test 1 reads `note-lifecycle.json`; the card says so, the index doesn't) |
| 260, 277, 352 | `the L1 cards above`, `the route cards above`, `the L6 cards above` | The IDs |
| 67-71 | The order of shared files, in prose | As Needs: L2-read-visit needs F3-routes; L2-permissions needs F3-contract; L2-seed needs F3-install; L5-location needs E-presets |
| 318 | `L5-labels` (S) needs `—` but its unit starts in wave 7 | Keep `—` (it truly depends on nothing). Its Run must compare every string to a table in the card, or it isn't S |

## 3. New and split cards (phase 4) [P]

| New card | Level | Files | Needs | Why |
|---|---|---|---|---|
| L0-vectors-lifecycle | X | `vectors/note-lifecycle.json`, `api-test/encounter-rules.test.ts`, `phone-test/encounters/rules_test.dart`, `services/api/tsconfig.src.json` | none | Replaces part of L0-vectors (2.1). **Ready now** |
| L0-vectors-signed-under | X | `vectors/signed-under.json`, `api-test/signed-under.test.ts` | none | The same. **Ready now** |
| L0-vectors-content-hash | X | `vectors/note-content-hash.json`, `api-test/note-content-hash.test.ts`, `phone-test/encounters/content_hash_test.dart` | F0-schema, F1-vectors | The hash is over `effectiveAnswers(definition, data)` (`lifecycle.md` 4.5), so its cases embed form definitions, whose format F0-schema fixes. Each case also carries `effective`, the expected answers that count, so a reviewer can check a case by reading it rather than recomputing a hash |
| E-tests | X | `forms/test/export.test.ts` (moved out of F0-tests) | F0, F1 | F0 must land green (2.2); E-presets is wave 3. E-presets then needs E-tests |
| F0-ci | X | `.github/workflows/ci.yml` line 88 and `tools/ci-local.sh` "Unit tests" line: add `--filter @sineobex/forms` | F0-package | [V] Both run unit tests from a fixed package list that leaves out forms, and no card adds it (E-drift adds only the drift step, index 122). Without it, F0's and F1's tests never run in CI. Lands in F0's first landing that has tests |
| L2-pdf-dependency | X | `services/api/package.json`, the lockfile (`registry` lane) | none | Choosing a dependency is a supply-chain decision (L2-handoff-pdf's row, line 276). L2-handoff-pdf then needs it and writes code only |
| L5-location-plugin | X | `apps/mobile/pubspec.yaml`, `pubspec.lock`; [I] the iOS and Android location permission entries and their wording, if the plugin needs them | E-presets | "Use my location": a location permission and its user-facing wording. L5-location then needs it |

L0-vectors itself is removed; the index lines that named it now name the split cards.

## 4. Level changes, with justification [P]

| Card | Doc, line | Files | Change | Justification |
|---|---|---|---|---|
| L6-handoff-link | index 351 | `apps/portal/src/app/(app)/encounters/[encounterId]/page.tsx` | S → **R** | `docs/plan/README.md:38-39`: "A screen, a widget or a permission is never S." |
| U2-content | phase 8, 426 (now one row "U2-list, U2-content") | `services/api/src/attachments/reads.ts` (after U2-list) | T → **X**; split the row | Serves the bytes of a photo or document: audit first, then bytes, `no-store`, 404 when hidden. "A read that can't be logged is refused" (`CLAUDE.md`) has to hold in the same transaction as the read, and a mistake is a leak no ordinary test shows. **This corrects my Nov 15 assessment, which named U2-open; U2-open opens an upload session and stays T** |
| B2-data-route | phase 10, 411 | `services/api/src/routes/exports-data.ts`, `services/api/src/exports/full-view.ts` (`seesEverything`), `services/api/src/app.ts` | T → **X** | `seesEverything` is the access decision for exporting the whole dataset, PHI included. Authorization, the MFA-level token (D6) and the audit event meet in this one route |
| I4-allergy-stop | phase 6, 450 | `apps/mobile/lib/features/orders/allergy_stop_screen.dart` | R → **T**; its widget test moves to I4-tests (X) | A clinical hard stop (phase 6 §5.4). As R, the small model writes its own widget test, the arrangement `docs/plan/README.md` says can't protect a rule. The frontier model's test asserts: no way to proceed without "Choose something else" or "Give anyway" with a reason; every bundle line is stopped before any is ordered |

**Kept, with the conditions added to the named tests card's Audit list:**

| Card | Condition (added to the tests card that writes its test) |
|---|---|
| L2-cosign, L2-attest, L2-assign (index 270-273); P4-publish (phase 5, 448) | For every route: a refusal for each missing key or credential in `lifecycle.md` §6.1, each refusal logged; and an audit write that fails rolls the action back |
| L4-close-sweep (index 307) | L4-tests: a draft with any change waiting in the outbox is not closed; a finished note without its receipt is not closed. Each test checked to bite (`lifecycle.md` 8.2, "When a finished note leaves the phone") |
| L5-needs-attention (index 337) | The card calls only L3's named store functions; Audit: no button discards a change (CLAUDE.md, "A rejected change is never dropped") |
| B0-suppress (phase 10, 386) | B0-tests: vectors at n−1, n and n+1 of every threshold, and complementary suppression |

**Count changes:** phase 4: the L0-vectors split is −1 +3 X, and E-tests, F0-ci, L2-pdf-dependency,
L5-location-plugin add 4 X, so +6 X in all; L6-handoff-link goes S→R. Phase 4 becomes S 39, T 67, R 65,
X 55, 226 cards. Phase 6: R −1, T +1. Phase 8: T −1, X +1. Phase 10: T −1, X +1. Totals:
**503 local / 237 X / 740**. Update each Count line, and the index counts table (366-385), when the
edit lands.

## 5. Permission tables [P]

Every `*-permissions` card writes rows of `RouteCase` (`services/api/test/permissions.test.ts:56-68`:
`method`, `path`, `body`, `label`, `allowed`, `refused`, `code`, `logged`). Add to
`docs/plan/README.md`, "Card levels": "A card that writes permission rows is given every row in
full, in the card, as a table with those columns, taken from the design's route section and its
table of keys. The Audit checks each row against the design. If a row can't be given, the card is
level X."

| Card | Routes from | Keys from |
|---|---|---|
| F3-contract (index 144) | `forms.md` §3.3 | `forms.md` §3.3, D37 |
| L2-permissions (index 277) | `lifecycle.md` §5 | `lifecycle.md` §6.1 |
| P1-, P4-, P5-permissions; I2-; W2-; Q2-; B1-, B2-; A1-permissions | Each design's §7 | Each design's §7 / permissions table |

The planner fills each table **when the card is written**, not now: the routes don't exist yet.

## 6. Missing acceptance tests [P]

| Where | Test |
|---|---|
| F0-ci | CI runs `@sineobex/forms` tests (3) |
| Every level T card's Audit | `before-commands.log` fails on the card's missing module, not on the environment |
| L0-vectors-content-hash | Each case's `effective` equals what `effectiveAnswers` gives, in F1's conformance vectors too |
| L4-tests, I4-tests, L2-tests | The conditions in §4 |

## 7. Exceptions that cross phases [P]

| Exception | Where to write it |
|---|---|
| L1 lands together with L3-fake-* and L3-parity (2.3) | Phase 4 index, after 71 |
| Phase n+1's cards are written only after a planner card has checked its design's §2 against a branch where every phase-n unit it names has landed | `docs/plan/README.md`, "The loop", step 1. The designs say "check section 2 against the code before building" (line 1 of each of 5–12) but never when |
| Phase 12's A3/A4 deploy, release, restore-drill and db-verify cards: the factory writes the code and runs `cdk synth`, cdk-nag and the policy fixtures; a person runs them against AWS | Phase 12 design §13, and `IMPLEMENTATION_PLAN.md` §7 |
| The field specification (forms question 10, `forms.md` 10.1 #10) and the Nov 14 PRD export must be readable by the planner | `IMPLEMENTATION_PLAN.md` §7. Blocks F6's 36 transcription cards |

## 8. The first card, written and tested [V]

`proposed-cards/F0-package.md` is a full card for the first local run. In a scratch worktree it
passes `node tools/card-check.mjs`, and `--dry-run` reports a prompt of 1,207–2,013 tokens in a
16,384 window. Run with a stub model giving the expected reply, it passed its full Run block
(install, `--filter @sineobex/forms typecheck`, repo-wide lint, format and typecheck) and committed
4 files. The only lockfile change was the `packages/forms` importer (`evidence/F0-package-commit.diff`).
It needs the `registry` lane: with `--offline` the install fails (`evidence/F0-package-offline-run.txt`).
It declares `src/index.ts` because `tsc --noEmit` fails on a package with no input files.
