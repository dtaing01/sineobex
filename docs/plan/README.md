# Building Sineobex from task cards

Two models build the remaining phases. A small local coding model writes the code, one short task
card at a time. A frontier model plans the work, writes the few parts that are too risky to hand
over, and audits everything the small model wrote.

Read `CLAUDE.md` at the repository root first. Its rules apply to every card.

## Who does what

| Role | Who | Does |
|---|---|---|
| Planner | The frontier model, or a person | Writes the phase design. Writes each card just before it is handed out. Writes the tests of level T cards first. Writes the code of level X cards itself. |
| Implementer | The small local model | Writes the code of one card at a time, exactly as written. Decides nothing. |
| Auditor | The frontier model | After each card: runs the card's commands and goes through its **Audit** list. After each unit: reads the unit's whole diff, checks that each rule's test bites, runs the full local CI. Fixes what it finds, or sends the card back. |

## Why the work is split this way

The hard part of this codebase is a handful of rules that cut across many files: a phone deletes
data only after the server confirms it by hash; every action writes its audit event in the same
transaction; permissions are checked in the API; the phone's test server answers exactly as the
real API does; no patient details in logs, URLs, titles or notifications.

A small model follows a short, exact instruction well. It breaks these rules without noticing,
and it cannot check its own work: asked "did you keep the rule?", it says yes. So a card tells it
what to type, not what to judge, and the judging is done before the card (the design, the tests)
and after it (the audit).

## Card levels

| Level | Who writes the code | What stands between the code and the branch |
|---|---|---|
| **S** | The small model | A machine: the card's commands. The auditor reads the diff at the end of the unit. |
| **T** | The small model | Tests the planner wrote first. The auditor reads the diff. |
| **R** | The small model | The auditor reads the diff and looks at the screen. |
| **X** | The frontier model | A second review. |

A card is level S only when a machine check catches every mistake the card could contain. A
screen, a widget or a permission is never S.

Level X exists because auditing a small model's attempt at these would cost more than writing
them: a wrong line there loses a patient record or opens one to the wrong person, and it does
not show in a test the same model wrote. These paths are always level X:

- `services/api/src/sync/**`, `services/api/src/auth/**`, `services/api/src/db/**`
- `apps/mobile/lib/sync/**`, `apps/mobile/lib/security/**`, `apps/mobile/lib/auth/**`
- `apps/mobile/test/sync/fake_server.dart`
- `db/migrations/**` when the migration adds or changes a policy, a trigger, or anything in the
  audit tables
- `.github/**`, `tools/**`

## What a card looks like

One file: `docs/plan/phase-<n>-<name>/cards/<ID>.md`. The ID is the card's unit and a short name:
`F6-psychological`, `L0-rules-ts`. A card is short, because a small model follows a short page
better than a long one and loses the end of a long one.

```
# Card <ID>: <title>

Level: T. Window: 16,000. Needs: L0-vectors.

## Goal          One or two sentences: what exists after the card.
## Read first    Files and line ranges. Each item starts with the path and says how many lines.
## Files         Every file the card creates or changes.
## Steps         Numbered. One edit each. The code to write is given where it matters.
## Tests         The tests already on the branch (level T), or the tests to write, by name.
## Run           The commands, and the last line each prints when it passes.
## Audit         For the auditor, not the implementer: what to check, and how.
```

Limits, which `node tools/card-check.mjs` enforces and CI runs:

- At most 90 lines (120 for level X).
- **Read first** asks for at most 200 lines in all. A file an earlier card creates is marked
  "(made by <card ID>)", and that card is under **Needs**.
- At most three source files under **Files**. Tests and documents are not counted.
- **Needs** names card IDs, or `none`. **Window** is 16,000 or 32,000 tokens.

What a card leaves out, on purpose:

- **Reasons.** They are in the phase design, for the planner and the auditor.
- **General rules.** They are in `docs/plan/implementer-rules.md`, given to the small model once.
- **Questions for the implementer to ask itself.** Checking is the auditor's job, under **Audit**.

## Setting up the small model

- Give it a context window of at least 16,000 tokens, and 32,000 if the machine can hold it.
  Many local runners default to far less, and cut off whatever is past the window without
  warning, so the model edits a file it only half read. Set the window explicitly (for one common
  runner: `PARAMETER num_ctx 16384` in its model file).
- The budget for a 16,000-token window: the standing rules 600, the card 2,000, the reading
  2,600 (200 lines), the tool's own instructions 1,500. About 9,000 are left for the answer.
- Give it three things, in this order: `docs/plan/implementer-rules.md`, the card, the lines
  under **Read first**. Nothing else.
- One card per session. Start a new session for the next card.

## The loop

1. Pick the next card of the phase's index whose **Needs** are on the branch. If it is not
   written in full yet, the planner writes it now, from the index row, the design section and a
   finished card of the same level.
2. Level T: check that its tests are on the branch and fail because the code is missing.
3. Hand the card to the implementer.
4. Run the card's **Run** commands yourself. Never take "tests pass" from the model's own text.
   If a command fails, give the model the failing output once. If it fails again, stop: the card
   is wrong or too big, and it goes back to the planner.
5. Audit the card (below). Commit, with a plain message that says what changed and why.
6. When a unit's cards are all in: audit the unit, run the full local CI (`tools/ci-local.sh`,
   see `CLAUDE.md`), push, and tick the unit in the phase's design, with what the audit found
   and the commits that fixed it.

## The audit

**After each card**, the auditor:

1. Runs `git diff --stat`: only the files under **Files** changed. No test that was given was
   edited. No generated file was edited by hand.
2. Goes through the card's **Audit** list. It names what is specific to this card: the rule to
   look for, the mistake a small model makes here, the command that proves a test bites.
3. Levels T and R: reads the diff. Level R: also opens the screen in Day, Night run and High
   contrast, at 200% text and at 320 px.

**After each unit**, the auditor reads the whole diff of the unit against the design section it
builds, and checks:

- Every rule that never bends (`CLAUDE.md`) that the unit touches.
- For every sync, audit and permission rule: the test bites (below).
- The phone's test server answers as the API does, for every rule the unit changed.
- No patient details in a log, a URL, a title, a notification or the phone's key-value store.

When the audit finds a defect: if it is small and local, the auditor fixes it and says so in the
commit. If the same defect shows twice, the card or the recipe is wrong: fix that, so the next
card does not repeat it.

## Checking that a test bites

A test that passes with the rule removed protects nothing.

1. Put the old behaviour back in the source file only.
2. Run the card's tests. They must fail on the assertion that names the rule.
3. Restore the file.

Script it when a unit has many: reverse the fix's source hunks in a scratch worktree and run the
tests the change added.

## Where things are

| What | Where |
|---|---|
| Rules, commands, environment | `CLAUDE.md` |
| The implementer's standing rules | `docs/plan/implementer-rules.md` |
| What each feature does | The PRD (linked from `CLAUDE.md`); it lives outside the repository |
| Decisions and phase status | `IMPLEMENTATION_PLAN.md` |
| A phase's design | `docs/design/phase-<n>-<name>.md` and the files it links |
| Recipes for recurring work | `docs/plan/patterns/` |
| A phase's cards | `docs/plan/phase-<n>-<name>/cards/`, indexed in that folder's `README.md` |

## When the plan and the code disagree

The code is what runs. The planner finds out which is right, fixes the other, and says so in the
commit. The implementer does neither: it stops and reports.
