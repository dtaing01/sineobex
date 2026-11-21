# A. Factory Integration Delta

Sineobex at `ca2c4db` (branch `claude/modest-feynman-1bz6ws`). Labels used throughout:
**[V]** verified against the Sineobex repository on Nov 16, with evidence; **[I]** an assumption that needs someone to look at
the factory; **[P]** a proposed change. Nothing in this document has been applied to the factory.

The factory's code was not available when this was written; only the Sineobex repository was. So
every factory file and function below is a question with the command that answers it, not a guessed
name. The next step compares this document with the factory's actual code and replaces the [I] rows
with file and function names.

## A0. What to inspect first (no changes, no inference)

| # | Question | Command (on the factory host) | Decides |
|---|---|---|---|
| I1 | What network does the launcher give workers? | `podman inspect <recent worker> --format '{{.HostConfig.NetworkMode}}'`; grep the launcher's `podman run` arguments for `--network`, `pasta`, `slirp4netns`, `--add-host`, `host.containers.internal` | A2 |
| I2 | How did the demonstrated OpenCode + Ollama edit reach Ollama? | The worker profile's provider config (OpenCode `provider.ollama.options.baseURL` or equivalent) | A2 |
| I3 | How are worktrees mounted? | Launcher `-v`/`--mount` arguments; `cat <worktree>/.git`; is the main repo's `.git` mounted, at what path, read-write? | A3 |
| I4 | Can a Hermes/bridge task run a fixed command, not only an agent prompt? How are its exit code and an output directory captured? | Bridge task schema / plugin config | A1 |
| I5 | Do workers' environments carry provider keys? | `podman exec <worker> env \| cut -d= -f1 \| grep -Ei 'key\|token\|anthropic\|openai'` | A2 (P3) |
| I6 | Ollama version, models, cloud reachability | `ollama --version` (the driver needs ≥ 0.12.6); `ollama list` (any `-cloud` or remote entries); `systemctl cat ollama` | A2 (P1) |
| I7 | What do ESTOP and "dispatch disabled" block: automatic dispatch only, or manual dispatch too? | Hermes config / safety checkpoint record | C Stage 4 |

## A1. Responsibilities: who owns each one

| Responsibility | Existing owner | Status | Delta |
|---|---|---|---|
| One task per card; intake | Hermes Kanban | [I] | **Config.** Create the card's task by hand for the first run. No import tool yet |
| Readiness (Needs are `Done.`) | Hermes Kanban dependencies | [I] | **Config.** Edges come from the card's `Needs:`. A task is done only when its audited commit is on the integration branch (C Stage 7). The card runner doesn't check Needs [V `card-check-rules.mjs:311,345`]. First run: done by hand (C Stage 1) |
| ESTOP, dispatch policy | Hermes | [I] | None. Real-model tasks are manual (A5) |
| Model selection | Hermes worker profile | [I] | **Config:** a profile `sineobex-card` with the model name fixed. Frontier profiles are separate (A2 P3) |
| Workspace isolation | Agent Factory bridge worktrees | [I] | Reuse if the tests in A3 pass. Otherwise use `git clone --local` |
| Container, limits | Rootless Podman launcher | [I] | **Config:** image, network profile (A2), mounts (A3), `--init` (so the runner gets SIGTERM), memory limit |
| Preflight (DB up, dependencies installed) | Launcher entry or task command | [I] | **Config:** a fixed command prefix (A4). Not a new program |
| Bounded context, writes, retries, records, commit on `work/` | `tools/card-run.mjs` | [V] 104 tests pass. Ran end to end in a git worktree against a stub runner: range check, T first-run, write, commit, exit 0 | None |
| Timeout, cancel | Hermes lifecycle + launcher stop | [I] | **Config:** 180 min wall clock, SIGTERM then `podman stop -t 30`. On SIGTERM the runner kills the command group and writes `result.json` [V `card-run.mjs:524-535`] |
| Artifact collection | Bridge | [I] | **Config:** collect `.card-runs/<card>/` (ignored by git [V `.gitignore`]), the exit code, `git log base..HEAD` |
| Exit code → task state | Bridge / Hermes result mapping | [I] | **Config:** table A4 |
| Out-of-scope writes | Frontier audit step 1 (`docs/plan/README.md` "The audit", step 1) | [V] it's in the procedure | None required. Optional: a free `git diff --name-only` check before paying for review |
| Independent re-validation | Existing launcher, plain command task | [I] | **Config:** run the card's Run block again in a fresh container at the work commit |
| Frontier implementation and review | Hermes frontier workers. OpenCode optional | [I] | **Config:** a named model per task, a paid-authorization field. High-risk decisions go to the frontier model directly; OpenCode is a convenience, not a gate |
| GitHub handoff | Existing (not yet verified) | [I] | Only the integration lane holds push credentials (A5) |

**New code needed for the first execution: none.** For unattended operation later, two small pieces:
(a) an import of the index's cards and Needs into Kanban, which first needs the index made
machine-readable (B §2.4); (b) a log classifier, because exit 1 can hide an infrastructure fault
(A4, [V] evidence `evidence/F0-package-offline-run.txt`). Write neither before the first run.

## A2. Ollama connectivity and blocking paid inference

**The card runner's local check** [V `card-run.mjs:110-132, 193-212`]. It refuses a runner address
other than localhost, 127.0.0.1 or ::1, and refuses `*-cloud` or `remote_host` models, unless
`--allow-remote` is passed. `--allow-remote` also skips the cloud-model check. So connectivity has
to make Ollama appear at 127.0.0.1 inside the container, and the paid-inference guard can't rely on
that flag alone.

**Choose by what I1 and I2 show**, reusing the launcher where you can:

| Launcher today | What the runner sees | Decision |
|---|---|---|
| `--network host` | 127.0.0.1 works | **Reject for card tasks.** Model-written code would get the host's whole network, including Tailscale |
| pasta or slirp, Ollama reached at the gateway or `host.containers.internal` | Not local, so the runner refuses | [P] **Config:** for this profile, add pasta `-T 11434`, which maps the container's 127.0.0.1:11434 to the host's [I: check on your Podman version]. Outbound traffic stays open, so pair it with P1–P3 |
| `--network none` | Nothing | [P] A Unix-socket bridge (socat on both ends, a few lines of config). Pick this only if I1 shows `none`, or if policy requires model-written code to have no outbound network at all, which pasta can't provide |

**Blocking paid inference in four independent layers.** Each one holds even if the others fail.

| Layer | Mechanism | Acceptance test |
|---|---|---|
| P1 Runner can't reach a cloud | [P] A systemd drop-in for `ollama.service`: `IPAddressDeny=any`, `IPAddressAllow=localhost`. Lift it only by hand, for model pulls. [I: Ollama runs under systemd (I6)] | `systemctl show ollama -p IPAddressDeny` shows `any`. A chat request for any `*-cloud` model fails at the runner |
| P2 Worker can't reach provider APIs | The network profile from the table above | From the worker: `curl -m 5 https://api.anthropic.com` and `https://api.openai.com` both fail |
| P3 Worker holds no provider keys | Profile `sineobex-card` defines no provider credentials (I5) | I5's command prints nothing |
| P4 The runner's own guard | The task command is a fixed template: no task field is ever placed into the runner's arguments, and `--allow-remote` never appears | A task carrying an extra-argument field doesn't change the command line (check the launcher's log of `podman run`) |

## A3. Git isolation: test the existing worktrees before replacing them

[V] The card runner works in a git worktree. In a scratch worktree on `work/probe/wt` it range-checked
a `Read first` item (`git log -S` reaches the shared history), ran a level T card's first run, wrote
the part, committed on the `work/` branch and exited 0.

[V] A worktree whose `.git` file (`gitdir: <repo>/.git/worktrees/<name>`) points at a path
the process can't see fails with "not a git repository". That's what happens in a container that
mounts only the worktree.

Keep the existing factory worktrees if all five tests pass from inside a worker container:

| # | Requirement | Test from inside the worker |
|---|---|---|
| W1 | The main `.git` is mounted at the same absolute path | `git -C <wt> rev-parse --git-common-dir` succeeds |
| W2 | Objects, refs and `worktrees/<name>` are writable (`--commit` writes them) | `git -C <wt> commit --allow-empty -m probe && git -C <wt> reset --hard HEAD~1` |
| W3 | Full history (the range check uses `git log -S`) | `git -C <wt> rev-parse --is-shallow-repository` prints `false` |
| W4 | The branch starts with `work/` | The bridge's branch naming |
| W5 | **The container can't write the main repo's `hooks/` or `config`** | `touch "$(git rev-parse --git-common-dir)/hooks/x"` and `git config --local x.y 1` both fail |

W5 is the reason to look before reusing. A writable shared `.git` lets code the small model wrote,
which the card's commands run, plant a hook or a `core.fsmonitor` setting. That code then runs on the
host the next time anyone uses git in the main repository.

- If W5 fails: bind-mount `hooks/` and `config` read-only on top of the writable `.git` [I: nested
  read-only bind mounts under rootless Podman], then test again.
- If W1–W5 still can't all pass: [P] `git clone --local <mirror> <ws>` per task. The clone has its
  own `.git` and full history (hard links). Results come back with
  `git -C <ws> bundle create out.bundle <base>..HEAD` and `git fetch out.bundle` on the host, so host
  git never runs inside a directory the container wrote.

## A4. Task contract

**Input** (one Kanban task): `card_path`, `card_id`, `level` (S|T|R), `base_sha`, `branch`
(`work/<unit>/<card>`), `model` (an Ollama name, plus the digest from `ollama list`), `lane`
(`card`|`registry`, see A5), `authorization` (C Stage 3; required unless the task is a dry run),
`dispatch: manual`.

**Command** (a fixed template; only the four `<…>` values come from the task, and each is checked
against `^[A-Za-z0-9._:/-]+$`):

```sh
set -euo pipefail
pg_isready -q -h 127.0.0.1 || { echo PREFLIGHT_DB; exit 90; }
pnpm install --frozen-lockfile --offline >/dev/null || { echo PREFLIGHT_PNPM; exit 91; }
(cd apps/mobile && flutter pub get --offline --enforce-lockfile >/dev/null) || { echo PREFLIGHT_PUB; exit 92; }
node tools/card-run.mjs <card_path> --dry-run >/dev/null            # exit 2 = card defect
CARD_MODEL=<model> node tools/card-run.mjs <card_path> --commit --keep-alive 0
```

A dry-run task runs the first four lines only. It never names a model and never touches the GPU.
[V] `--dry-run` returns before any contact with the runner (`card-run.mjs:410-437`, before `runnerUrl` at 438).

**Output**: the exit code, `.card-runs/<card>/<stamp>/` (prompts, replies, command logs,
`result.json`), the commits `base..HEAD`, `git show --stat`.

| Exit | Meaning [V `card-run.mjs:11-13`] | State | Hermes retry |
|---|---|---|---|
| 0 | Commands passed, committed "not audited" | `awaiting_review` | — |
| 1 | Two attempts failed | `back_to_planner`, **unless** the last command log shows an infrastructure fault (`ERR_PNPM_`, `ECONNREFUSED`, `ENOTFOUND`), which is `infra_failed` | none |
| 2 | Card not runnable (ranges moved, window, a T card's tests pass before any code, dirty tree) | `back_to_planner`, except a dirty tree, which is `infra_failed` | none |
| 3 | Model wrote `STOP:` | `back_to_planner` | none |
| 4 | Runner failed | `infra_failed` | once, after the I6 checks |
| 5 | The runner itself failed | `infra_failed`, page a person | none |
| 90–92 | Preflight failed | `infra_failed` | after a fix |
| 130/143 | Interrupted | `cancelled` | new task |

The runner already tried twice with feedback [V `card-run.mjs:579-690`]. A Hermes retry on exit 1
would spend up to an hour of GPU repeating a failure the planner has to fix.

## A5. Lanes

| Lane | Network | Credentials | Used for |
|---|---|---|---|
| `card-dryrun` | none | none | Static validation. Allowed under ESTOP if I7 allows manual dispatch |
| `card` | Ollama only (A2) | none | S/T/R cards that don't change a dependency |
| `registry` | Ollama + the package registries only | none | Cards that change `package.json`, the lockfile or `pubspec.*`. [V] needed: a new workspace package fails offline even with a warm store and warm direct-dependency metadata (`ERR_PNPM_NO_OFFLINE_META`, evidence `evidence/F0-package-offline-run.txt`). It passes with registry access (`evidence/F0-package-registry-run.txt`) |
| `validate` | none | none | Re-running a card's commands; `tools/ci-local.sh` in the validation image |
| `frontier` | provider API | the named model's key only | X cards, reviews. Each task needs paid authorization |
| `integrate` | GitHub + registries | push to `claude/modest-feynman-1bz6ws` and `work/*` only | cherry-pick, ci-local, push. Never `main` (`deploy-preview.yml` deploys on push to `main`) |

One `card`/`registry` task on the machine at a time, and never at the same time as `ci-local.sh`:
there's one GPU, and 32 GB has to hold Postgres, Flutter and a model partly in RAM. One local
worker slot in Hermes enforces both.

## A6. Acceptance tests for the delta

| AT | Pass when |
|---|---|
| AT-1 | A0's I1–I7 answered in writing |
| AT-2 | P1–P4 tests pass |
| AT-3 | W1–W5 pass for worktrees, or the clone fallback passes W2, W3, W4 |
| AT-4 | A `card-dryrun` task for `F0-package` goes through Kanban, the bridge and the launcher, and its output is collected. `ollama ps` shows no model loaded before or after |
| AT-5 | Each exit code in A4 is produced once and mapped to the right state. Codes 0/2/3 come from cards; 4 from stopping Ollama; 90 from stopping Postgres; 143 from a cancel |
| AT-6 | One authorized real-model run, done by runbook C, Stages 3–5 |
