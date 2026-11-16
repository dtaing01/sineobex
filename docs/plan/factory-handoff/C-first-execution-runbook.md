# C. First Execution Runbook

A proposed procedure. None of its stages has been run. It assumes the corrections in B and the
factory delta in A, which are not applied yet.

Goal: one card (`F0-package`, level R) written by the local model through Hermes, independently
validated, reviewed by a frontier model, landed on the PR branch with CI green. ESTOP stays engaged
and automatic dispatch stays disabled throughout. Every dispatch below is manual.

Stages 0–2 use no model. Stage 4 is the only local inference; Stage 6 is the only paid inference.

| Stage | What | Model | Who |
|---|---|---|---|
| 0 | Preconditions | none | operator |
| 1 | Static validation | none | operator |
| 2 | Hermes plumbing, dry run | none | operator via Hermes |
| 3 | Authorization | none | a person |
| 4 | One local-model run | local | operator via Hermes |
| 5 | Independent validation | none | Hermes, validate lane |
| 6 | Frontier review | paid, authorized | frontier lane |
| 7 | GitHub integration | none | integrate lane |
| 8 | Release dependents | none | Hermes |

## Stage 0: Preconditions

1. Record the ESTOP state and that dispatch is disabled (screenshot or log line). From here on, every
   Hermes task is dispatched by hand.
2. Remove or disable every billed default model in the Hermes worker configs. Write down which
   profile may use which paid model, and who approves a paid task.
3. Answer A0's I1–I7. Make the A2 and A3 decisions and run their tests (AT-2, AT-3).
4. Land B §2.1–§2.4 and the `F0-package` card (`proposed-cards/F0-package.md`) on a planning commit.
   These are docs-only changes; push them only after `tools/ci-local.sh` passes (`CLAUDE.md`).

**Pass:** all four recorded. **Fail:** stop. Nothing has changed except the docs commit; roll back
with `git revert <docs commit>`, after ci-local, then push.

## Stage 1: Static validation (no model, no GPU)

In a worker container at the base SHA (the commit from Stage 0.4), `card-dryrun` lane:

```sh
node tools/card-check.mjs                     # expect: "Task card check: <n> cards clean"
node tools/phi-guard.mjs
node tools/card-run.mjs docs/plan/phase-4-encounters/cards/F0-package.md --dry-run
grep -q 'Needs: none\.$' docs/plan/phase-4-encounters/cards/F0-package.md   # readiness, by hand
pg_isready -h 127.0.0.1
```

**Pass:** every command exits 0. The dry run reports a prompt under 60% of the window (expect
1,207–2,013 of 16,384). `ollama ps` lists no model before or after.
**Fail:** a card or doc defect goes back to the planner. An environment failure (pg, pnpm) is fixed in
the image. Nothing to roll back.

## Stage 2: Hermes plumbing, dry run

Create one Kanban task with the A4 input (`lane: card-dryrun`, no `model`, no `authorization`).
Dispatch it by hand.

**Pass:** the launcher starts the configured image with the A2 network and A3 mounts (check the
launcher log of the `podman run` line), runs the first four lines of the A4 template, and the bridge
collects exit code 0 and the output. P2 holds from inside the container. **Fail:** fix the
config; don't patch the runner. If I7 shows ESTOP blocks manual dispatch too, stop here: lifting
it is a person's decision, and this runbook doesn't bypass it.

## Stage 3: Authorization

A person writes one record, attached to the Kanban task:

```
card: docs/plan/phase-4-encounters/cards/F0-package.md   base_sha: <sha>
lane: registry (the card changes the lockfile; B §8)      model: <name> @ <digest from `ollama list`>
inference: local only, no paid model                     approved by: <name>   at: <time>
valid for: one dispatch
```

Which model: any local candidate. This card tests the pipeline, not the model; its reply is about
400 tokens of given content. Comparing models comes later, with the replay benchmark
(`docs/plan/README.md` "Which model").

## Stage 4: One local-model run

Dispatch the task by hand, `lane: registry`, with the A4 command template (all five lines).

**During:** `ollama ps` shows the model loaded with a context of at least 16,384. Note the
VRAM/CPU split for the benchmark record.

**Pass, all of:**
- exit 0; `result.json` `outcome: "passed"`;
- one commit on `work/F0/package` titled "Card F0-package: the implementer's attempt, not audited";
- `git show --stat` lists exactly `packages/forms/{package.json,tsconfig.json,src/index.ts}` and
  `pnpm-lock.yaml`;
- the lockfile diff only adds the `packages/forms` importer with the four versions
  (compare with `evidence/F0-package-commit.diff`);
- the registry lane's egress log shows only registry hosts.

**Fail and rollback:**

| Result | Action |
|---|---|
| exit 1, 2, 3 | Card back to the planner, with the record. `git branch -D work/F0/package`, remove the workspace and container. Nothing reached the PR branch |
| exit 4 | Check the runner (I6, `ollama ps`), retry once with a new authorization record, then stop |
| exit 90–92 | Fix the image; new authorization |
| Anything outside the four paths | `rejected`. Keep the commit for reading, delete the branch afterwards, and review why the runner's write limit didn't hold (it should: the commands wrote it) |

## Stage 5: Independent validation (validate lane, no model)

Fresh container at the work commit, network as `registry` (the install step needs it):

```sh
pnpm install --prefer-offline --no-frozen-lockfile
grep -q '^  packages/forms:$' pnpm-lock.yaml
pnpm -s --filter @sineobex/forms typecheck
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck
git status --porcelain          # must print nothing: the commit already holds what the commands write
```

**Pass:** all exit 0, and `git status` is empty. **Fail:** back to the planner. Delete the branch.

## Stage 6: Frontier review (paid, authorized)

Needs its own authorization record (Stage 3 form, `inference: <named frontier model>`).

Give the reviewer only references, to keep tokens down: the card path; `git show <work commit>`;
the Stage 5 log; `result.json`. Instructions: "Follow `docs/plan/README.md` 'The audit', 'After
each card', steps 1–3, and the card's Audit list. Reply ACCEPT, RETURN with the card defect, or FIX
with the exact diff." Level R normally includes looking at the screen; this card has no screen.

**Pass:** ACCEPT, or FIX that's small and local (`docs/plan/README.md`: the auditor fixes it and says
so in the commit). **Fail:** RETURN goes back to the planner; delete the branch.

## Stage 7: GitHub integration (integrate lane)

In the integration checkout of `claude/modest-feynman-1bz6ws`:

```sh
git fetch <workspace or bundle> work/F0/package
git cherry-pick -n <work commit>
# apply any FIX from Stage 6; append " Done." to the card's header line
git commit                      # plain message saying what changed and why (CLAUDE.md)
flock "$CI_LOCK" env ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres \
  PORTAL_ENV=test PW_CHROMIUM_PATH=<chromium> tools/ci-local.sh
git push origin claude/modest-feynman-1bz6ws      # only after "All local CI checks passed"
```

Then update the F0 row of `docs/design/phase-4-encounters.md` **Status**
("1 of 11 cards: F0-package"), in the same push or the next.

**Pass:** ci-local ends "All local CI checks passed"; GitHub CI on PR dtaing01/sineobex#5 is green.
**Fail before push:** `git reset --hard origin/claude/modest-feynman-1bz6ws` in the integration
checkout; the card stays awaiting review. **Fail after push** (GitHub CI red): `git revert <sha>`, run
ci-local, push. Never force-push the PR branch, and never push to `main`.

## Stage 8: Release dependents

Mark the Kanban task done only now. Cards that become ready: `F0-schema`, `F0-canonical` (X).
Already ready and independent of this card: `L0-vectors-lifecycle`, `L0-vectors-signed-under`,
`F3-migration` (X), after B §3 lands. Remove the workspace and branch `work/F0/package`.

The next local card is `L0-rules-ts` (T), after `L0-vectors-lifecycle` lands. It needs its own
authorization, and Stage 4 again with `lane: card`. Its first run must fail on the missing
`rules.ts`; check `before-commands.log` says so. Automatic dispatch stays off until a person
decides otherwise. The criterion I'd suggest is about ten consecutive local cards accepted
without a frontier rewrite.

## Pass/fail summary

| Stage | Pass | Rollback |
|---|---|---|
| 0 | ESTOP recorded, paid defaults gone, I1–I7 answered, docs landed green | revert the docs commit |
| 1 | check, guard, dry run, readiness all exit 0 | none needed |
| 2 | dry-run task collected through Hermes | fix config |
| 3 | signed record | — |
| 4 | exit 0, four paths, lockfile importer only | delete work branch and workspace |
| 5 | validation commands green, clean tree | delete work branch |
| 6 | ACCEPT or small FIX | delete work branch |
| 7 | ci-local and GitHub CI green | reset before push; `git revert` after |
| 8 | dependents ready | — |
