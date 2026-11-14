# Building Sineobex from task cards

This folder turns each remaining phase into small task cards. A card is one small change that a small local model (for example a 14B coding model) can make by following steps, without having to understand the whole system.

Read `CLAUDE.md` at the repository root first. Its rules apply to every card.

## Who does what

| Role | Who | Does |
|---|---|---|
| Planner | A strong model, or a person | Writes the phase design (`docs/design/`), writes the cards, writes the tests for every safety-critical card before the card is handed out |
| Implementer | The small model | Does one card at a time, exactly as written |
| Reviewer | A strong model, or a person | Reads the result of every card marked T, R or X before it is merged; runs the full local CI before anything is pushed |

The implementer never plans. It does not change what a card asks for, does not edit a file the card doesn't list, and does not edit a test it was given. When a card is unclear or a step fails twice, it stops and writes what happened in the card's **Report** section.

## Why the work is split this way

The hard part of this codebase is a handful of rules that cut across many files:

- A phone deletes data only after the server confirms it by hash.
- Every action writes its audit event in the same database transaction.
- Permissions are checked in the API.
- The phone's test server (`apps/mobile/test/sync/fake_server.dart`) must answer exactly as the real API does.
- No patient details in logs, URLs, page titles, notifications or the phone's key-value store.

A small model follows a pattern well. It breaks these rules without noticing, and a broken rule here means a lost patient record or patient details in a log. So the judgment lives in three places the small model doesn't write: the phase design, the tests, and the review.

## Card levels

Every card has one level. The level says how much the implementer may be trusted with it.

| Level | Meaning | Who implements | Before merge |
|---|---|---|---|
| **S** | Follows a pattern; a mistake is caught by the card's own tests | Small model | Commands pass |
| **T** | Enforces a rule. The planner wrote the tests first; the job is to make them pass | Small model | Reviewer reads the diff. The given tests are unchanged |
| **R** | Touches a screen's wording, accessibility or a permission | Small model | Reviewer reads the diff and the screen |
| **X** | Sync core, audit chain, sign-in, the lock, a migration with row-level security, the fake server's rules | Strong model only | A second review |

These paths are always level X:

- `services/api/src/sync/**`, `services/api/src/auth/**`, `services/api/src/db/**`
- `apps/mobile/lib/sync/**`, `apps/mobile/lib/security/**`, `apps/mobile/lib/auth/**`
- `apps/mobile/test/sync/fake_server.dart`
- `db/migrations/**` when the migration adds or changes a policy, a trigger, or anything in the audit tables
- `.github/**`, `tools/**`

## What a card looks like

Each card is one file: `docs/plan/phase-<n>-<name>/cards/<nnn>-<short-name>.md`. Every card has these sections, in this order, with these headings.

1. **Goal.** One sentence: what exists after the card that didn't before.
2. **Level.** S, T, R or X.
3. **Depends on.** Card numbers that must be merged first.
4. **Read first.** Files and line ranges, at most 600 lines in total. Nothing else needs reading.
5. **Pattern.** One existing file to copy from, and the recipe in `docs/plan/patterns/` that explains it.
6. **Files to change.** The full list. At most three source files, plus tests.
7. **Steps.** Numbered. Each step is one edit, with the code to write given in full where it matters: signatures, SQL, field names, error codes, user-facing wording.
8. **Tests.** For T: the test files already on the branch, and the command that runs them. For S and R: the tests to write, each with its name and what it asserts.
9. **Run.** The exact commands, and the last line each prints when it passes.
10. **Check before you report.** Five to eight yes/no questions about the rules that matter for this card.
11. **Never.** What this card must not do.
12. **If stuck.** When to stop, and what to write in the report.
13. **Context.** About how many tokens the card and its reading need.
14. **Report.** Filled in by the implementer: what changed, the commands' last lines, anything unexpected.

A card changes at most about 200 lines. If a change needs more, it is two cards.

## Setting up the small model

- Give the model a context window of at least 16,000 tokens. Ollama's default is far smaller, and anything past the window is cut off without warning, so the model edits a file it only half read. For Ollama: set `num_ctx` (for example `PARAMETER num_ctx 16384` in a Modelfile).
- Give it one card, the files in **Read first**, and the pattern recipe. Nothing else.
- Run the card's commands yourself, or with a tool that shows you their real output. Don't accept "tests pass" from the model's own text.
- One card per session. Start a new session for the next card, so nothing from the last one leaks in.

## The loop

1. Pick the lowest-numbered card whose **Depends on** cards are merged.
2. For a T card, check that its tests are on the branch and fail for the right reason.
3. Give the card to the implementer.
4. Run the card's **Run** commands. If they fail, give the model the failing output once. If they fail again, stop: the card goes back to the planner.
5. Go through **Check before you report**.
6. For T, R and X: the reviewer reads the diff.
7. Commit with a plain message that says what changed and why. No model names in the message beyond the attribution lines a session gives.
8. When a unit's cards are all merged, run the full local CI (`tools/ci-local.sh`, see `CLAUDE.md`) before pushing.
9. Tick the card in the phase's card index.

## Checking that a test bites

A test that passes with the rule removed protects nothing. For every T card the planner checks, before handing it out and again after it is done:

1. Put the old behaviour back in the source file only.
2. Run the card's tests. They must fail on the assertion that names the rule.
3. Restore the file.

## Where things are

| What | Where |
|---|---|
| Rules, commands, environment | `CLAUDE.md` |
| What each feature does | The PRD (linked from `CLAUDE.md`); it lives outside the repository |
| Decisions and phase status | `IMPLEMENTATION_PLAN.md` |
| A phase's design | `docs/design/phase-<n>-<name>.md` and the files it links |
| Recipes for recurring work | `docs/plan/patterns/` |
| A phase's cards | `docs/plan/phase-<n>-<name>/cards/`, indexed in that folder's `README.md` |

## When the plan and the code disagree

The code is what runs. The planner finds out which is right, fixes the other, and says so in the commit. The implementer does neither: it stops and reports.
