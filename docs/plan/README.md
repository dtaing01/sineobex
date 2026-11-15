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
better than a long one and loses the end of a long one. It is also exact, because a program reads
it: the card driver (below) fetches the lines a card names and writes the files it names.

```
# Card <ID>: <title>

Level: T. Window: 16,000. Needs: L0-vectors.

## Goal          One or two sentences: what exists after the card.
## Read first    What to read, by line: `path` lines 56-73, or `path`, all of it (124 lines).
## Files         What the card writes: `path` (new), `path` (the whole file), `path` lines 56-73.
## Steps         Numbered. One edit each. The code to write is given where it matters.
## Tests         The tests already on the branch (level T), or the tests to write, by name.
## Run           One block of commands that fail when the card is not done, and what they print.
## Audit         For the auditor, not the implementer: what to check, and how.
```

Limits, which `node tools/card-check.mjs` enforces and CI runs:

- At most 90 lines (120 for level X).
- **Read first** is a list of items that each name lines, never a section: a small model cannot
  find a section in a long file. It asks for at most 200 lines in all (400 in the 32,000 window).
  A file an earlier card creates is marked "(made by <card ID>)", and that card is under
  **Needs**. A card with nothing to read says `Nothing.`
- **Files** says what the reader writes, one item each: a file that is not there yet
  (`path (new)`), a file written again whole (the path alone), or some lines of a file
  (`path lines 56-73`), with the path in backticks and these words straight after it. The small
  model sends back every line of what it changes, so a long file is changed by line range: the
  lines that are already there and are written again come to at most 200 (400 in the 32,000
  window). `(replace)` after the path or the lines says that the card puts other lines in their
  place; without it, a reply that does not bring most of them back is refused.
- What the commands write (a lockfile, generated code) is said in words, with no path at the
  start of the item, and a generated file is never a card's to write by hand. A level S card may
  name no file at all: it is then its commands, and no model is asked.
- At most three source files under **Files**. Tests and documents are not counted. Every path is
  plain and inside the repository.
- **Run** has exactly one code block (`sh`): the commands that are run.
- **Needs** names card IDs, or `none`. **Window** is 16,000 or 32,000 tokens.
- The header line ends with `Done.` once the card's work is audited and on the branch. A done
  card is checked for its shape only: the files it names have moved on.

What the check cannot see, and the planner sees to:

- The commands under **Run** stop with an error when the card is not done. The driver goes by
  how they end; the lines under the block, which say what they print, are for the auditor.
- A card that writes source formats it in its commands (`npx prettier --write <file>`), after the
  tests: the small model cannot run a formatter, and a format check it cannot satisfy sends a
  good card back.
- For a level T card the tests come first, so that the first run, before any code, fails on
  them and writes nothing.
- No part is empty. To take lines out, name the lines around them too.

What a card leaves out, on purpose:

- **Reasons.** They are in the phase design, for the planner and the auditor.
- **General rules.** They are in `docs/plan/implementer-rules.md`, sent with every card.
- **Questions for the implementer to ask itself.** Checking is the auditor's job, under **Audit**.

## Running a card

`tools/card-run.mjs`, the card driver, runs one card of level S, T or R with a local model:

```sh
CARD_MODEL=<the runner's name for the model> node tools/card-run.mjs docs/plan/<phase>/cards/<ID>.md
```

The model needs no tool calling. The driver sends it `docs/plan/implementer-rules.md`, the
card's goal, steps and tests, the lines under **Read first** and what is now in each place the
card changes. The model answers with each part whole. Then the driver:

- writes the parts to the files the card names. A reply is read by part number, so it cannot
  name a file;
- runs the card's commands, and no others. What the reply wrote is then run by those commands,
  as any code under test is, with the rights of whoever runs the driver;
- asks once more, with what went wrong, when the reply cannot be used or the commands fail.
  After two tries the card goes back to the planner;
- stops, and writes nothing from that reply, when the model answers `STOP:` and says why;
- commits nothing. What it leaves in the working tree is for the audit.

It refuses to start when:

- the working tree has changes, or another run is at work in the checkout;
- lines the card names are no longer the lines they were when the card named them. The planner
  counts them again and corrects the card; `--ranges-checked` says the numbers still hold;
- a file the card names is a link, is reached through one, is ignored by git, or a new file
  would be;
- a level T card's commands pass before any code is written, or write files before they fail;
- the prompt would take more than 60% of the window;
- the runner is too old, or the model would run on another machine.

It refuses a reply that leaves lines out ("... the rest is unchanged", or a part of twelve lines
or more that brings back fewer than six in ten of them), that is a diff, that carries line
numbers, that has a code block outside its parts, or that was cut off. Each run leaves a record
under `.card-runs/` (ignored by git): what was sent, what came back, what the commands printed,
how long it took.

`--dry-run` prints what the model would be sent and what it comes to, and asks nothing. The
planner reads every card that way before handing it out.

Why a program, and not an agent tool that lets the model open files and run commands itself: a
card already says what to read and what to write, so nothing is left to explore; a small model
that explores spends its window and edits what it should not; and a rule kept by a program needs
no audit. It also means that a model which cannot call tools can do the work.

The commands are run with `bash`. On Windows that is Git Bash or WSL, with the repository's
tools in that same shell.

### The runner

The driver speaks to Ollama, version 0.12.6 or later, at `http://127.0.0.1:11434`. `--url` or
`OLLAMA_HOST` names another address. A runner on another machine, or a model the local runner
would pass on to one, needs `--allow-remote`: the card, the lines it names and, on a second
attempt, the end of what the commands printed are then sent there.

- **The window.** The driver asks for the card's window with every request, so no model file is
  needed. Left alone, the runner gives a model 4,096 tokens on a graphics card under 24 GB and
  cuts the middle out of a longer prompt without a word. The driver tells it to refuse instead
  (`truncate` and `shift` off, which older runners do not know: hence the version), and stops if
  the runner loaded a smaller window than was asked for, or does not say which.
- **Memory.** The window costs memory on top of the model, and what does not fit on the graphics
  card runs on the processor: slower, and it works. `ollama ps` shows the split. Halving the
  window's cache (`OLLAMA_KV_CACHE_TYPE=q8_0`, set where the runner starts) leaves more of the
  card to the model. `--keep-alive 0` unloads the model before the commands run, on a machine
  short of memory.
- **One user at a time.** A model is loaded for one window. Another program that uses the same
  model with other settings makes the runner load it again, and the driver's next card loads it
  back. Run cards while nothing else uses the model.
- **Thinking.** A model that thinks before it answers is asked not to: thinking spends the
  window. `--think` lets it.
- **Sampling.** Temperature 0.2 and a fixed seed, so that a card gives the same reply twice.
  `--temperature` and `--seed` change them.
- **Silence.** The driver gives up when the runner sends nothing for 30 minutes
  (`--runner-timeout`), and stops the card's commands after 30 (`--command-timeout`).

### Which model

Measure, on the first unit. Run the same three cards (one S, one T, one R) with each model that
fits the machine, and compare what each run's `result.json` and the audit say: did the commands
pass, in how many tries, how long did it take, what did the auditor have to fix. A newer or a
larger model is not thereby better at following a card to the letter. Write the result in the
phase's design, under **Status**, calling each model by what it is (a 14-billion coder model, a
35-billion general one): documents name no model, and the names are in the runs' records.

### An agent tool instead

A model that calls tools reliably can do a card through an agent tool. Give it
`docs/plan/implementer-rules-agent.md` and the card, a window of at least 16,000 tokens and one
card a session, and turn the tool's automatic commits off. It is the weaker arrangement: what the
driver cannot do (write another file, read the rest of the repository, commit) becomes what the
model is asked not to do, and the auditor has to check that it did not.

## The loop

1. Pick the next card of the phase's index whose **Needs** are on the branch. If it is not
   written in full yet, the planner writes it now, from the index row, the design section and a
   finished card of the same level, and reads it with `--dry-run`.
2. Run the card with the driver. For level T it first runs the commands and goes on only if they
   fail. Any failure counts, a database that is down as much as a missing function, so the
   planner reads why in the record (`before-commands.log`).
3. If the driver ends with the card going back to the planner (the reply could not be used twice,
   the commands failed twice, or the model wrote `STOP:`), the card is wrong or too big. Set
   aside what the run left (`git stash -u`), change the card, and run it again.
4. Audit the card (below). The auditor runs the card's commands itself: a record that says they
   passed is where the audit starts, not what it rests on.
5. Commit, with a plain message that says what changed and why, and add `Done.` to the card's
   header line in the same commit.
6. When a unit's cards are all in: audit the unit, run the full local CI (`tools/ci-local.sh`,
   see `CLAUDE.md`), push, and tick the unit in the phase's design, with what the audit found
   and the commits that fixed it.

### When the auditor is on another machine

The driver leaves its work uncommitted, which suits an auditor in the same checkout. When the
small model runs on one machine and the auditor on another, the work travels on a work branch:

```sh
git switch -c work/<unit> <the phase's branch>
CARD_MODEL=<name> node tools/card-run.mjs <card> --commit    # one commit a card
git push -u origin work/<unit>
```

- `--commit` makes one commit for the card, marked "not audited". It refuses any branch whose
  name does not start with `work/`. The record of a run stays on the machine it ran on, so the
  commit says how the run went: each attempt, its time, and how it ended.
- A failed attempt is committed too, marked "a failed attempt, back to the planner", and taken
  out again by the commit after it. The branch stays as it was, so the card can be run again
  once the planner has changed it; the attempt is there to read (`git show <commit>`).
- The auditor fetches the branch and takes the "not audited" commits one at a time, in order:
  `git cherry-pick -n <commit>`, audit, fix what the audit found, mark the card `Done.`, commit.
  It never picks a failed attempt or the commit that took one out.
- Nothing on a work branch counts until then, and CI does not run there. `node
  tools/card-check.mjs` fails on a work branch as soon as a card has made its new file: the card
  is not `Done.` until it is audited.
- When a unit's audit has landed, start the next from audited work:
  `git switch -C work/<unit> <the phase's branch>`.
- A card run on top of one that is not audited yet may have to be run again when the audit
  changes what it built on. Run ahead of the audit only within a unit. A card that names lines
  of a file which an earlier card of the unit changes is written after that card has run, or it
  is refused for naming lines that have moved.

## The audit

**After each card**, the auditor:

1. Reads what changed (`git diff --stat`, or `git show --stat` for a commit on a work branch):
   only the files under **Files**, and what the commands write. No test that was given was
   edited. No generated file was edited by hand.
2. Goes through the card's **Audit** list. It names what is specific to this card: the rule to
   look for, the mistake a small model makes here, the command that proves a test bites.
   The driver refuses a reply that leaves lines out; it does not catch a function left as
   `// TODO` or one that only throws "not implemented". Those are for the tests and for this
   reading.
3. Levels T and R: reads the diff. Level R: also opens the screen in Day, Night run and High
   contrast, at 200% text and at 320 px.

**After each unit**, the auditor reads the whole diff of the unit against the design section it
builds, and checks:

- Every rule that never bends (`CLAUDE.md`) that the unit touches.
- For every sync, audit and permission rule: the test bites (below).
- The phone's test server answers as the API does, for every rule the unit changed.
- No patient details in a log, a URL, a title, a notification or the phone's key-value store.
- The **What the auditor checks** list of every recipe the unit's cards read.

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
| The card driver | `tools/card-run.mjs`; its rules, and their tests, are in `tools/card-run-rules.mjs` and `tools/test/` |
| The implementer's standing rules | `docs/plan/implementer-rules.md` (sent by the driver); `docs/plan/implementer-rules-agent.md` (for an agent tool) |
| What each feature does | The PRD (linked from `CLAUDE.md`); it lives outside the repository |
| Decisions and phase status | `IMPLEMENTATION_PLAN.md` |
| A phase's design | `docs/design/phase-<n>-<name>.md` and the files it links |
| Recipes for recurring work | `docs/plan/patterns/` |
| A phase's cards | `docs/plan/phase-<n>-<name>/cards/`, indexed in that folder's `README.md` |

## When the plan and the code disagree

The code is what runs. The planner finds out which is right, fixes the other, and says so in the
commit. The implementer does neither: it stops and reports.
