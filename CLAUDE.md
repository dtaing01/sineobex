# Working in this repository

Sineobex: offline-first charting for street medicine teams. HIPAA-regulated; the preview holds
made-up patients only. Read this before changing anything; it is how every session and every
helper agent works here, so work can stop at any point (usage limits, restarts) and another
session can pick it up.

## Where the truth lives

| What | Where |
|---|---|
| Product spec (the PRD) | [Sineobex Build & Strategy Plan](https://claude.ai/code/artifact/6f83b7b9-4134-4c36-ad0c-17a41eed3af3): the main tab is the source of truth for what each feature does; the Build plan tab sets the order. It lives outside the repo. |
| Plan, decisions, phase status | `IMPLEMENTATION_PLAN.md`: architecture, decisions D1–D43, regulation mapping, the phase table with each phase's **Done when** and status, defaults for open questions, risks, what needs a person. |
| The current phase's design and its unit status | `docs/design/phase-<n>-<name>.md`. Its **Status** section says which units are done, which are open and what each needs. Start there. |
| Compliance mapping | `docs/compliance/` |
| Deployment setup (accounts, secrets) | `docs/setup.md` |

When the code and these documents disagree, find out which is right, fix the other, and say so in
the commit.

## Rules that never bend

- Data leaves a phone only after a hash-confirmed receipt. A rejected change is never dropped and
  its dependents are held. A rejection never stops a phone's queue. "Log out anyway" never deletes
  unsynced data; only a remote wipe and the tenth wrong PIN do.
- Every action writes its audit event in the same database transaction. A read that can't be
  logged is refused.
- No patient details in logs, URLs, page titles, notifications, crash reports or browser storage.
  Search terms travel in POST bodies and are never stored in the audit log.
- Permissions are checked in the API (existing keys only; the PRD allows no new permission types in
  the MVP). Row-level security is the second line, not the first.
- The phone's offline index holds no legal names and nothing derived from one (D40).
- Every new screen passes accessibility checks in Day, Night run and High contrast, and reflows at
  narrow width. Every new feature is tested offline, not only online.
- Demo data only: invented names, descriptors starting "Demo:", no realistic identifiers (the PHI
  guard fails the build on them).

## Environment

```sh
export PATH=/opt/flutter/bin:/opt/bin:$PATH        # flutter, deno, gitleaks, actionlint
pg_isready -h localhost || pg_ctlcluster 16 main start   # Postgres is down after a machine restart
pnpm install --frozen-lockfile
(cd apps/mobile && flutter pub get --enforce-lockfile)
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

Each API and DB test file makes its own scratch database, so those suites can run anywhere, any
time. The portal end-to-end tests, `tools/live-sync.sh` and `tools/ci-local.sh` use **fixed ports
(8787, 8790, 3100) and fixed databases (`ci_scratch`, `sineobex_e2e`)**: two of them at once break
each other. Run them under the shared lock, always:

```sh
flock "$CI_LOCK" <command>
```

`CI_LOCK` is one file that everything sharing the machine agrees on. A session that runs helper
agents creates it (in its scratchpad) and passes the path to each agent; a lone session can use any
file. Without the lock, a second run drops the first one's database mid-test and both fail in ways
that look like bugs.

## Commands

| Check | Command |
|---|---|
| Lint, format, types | `pnpm -s lint && pnpm -s format:check && pnpm -s typecheck` |
| DB and API tests | `pnpm -s --filter @sineobex/db test && pnpm -s --filter @sineobex/api test` |
| One API test file | `cd services/api && pnpm -s vitest run test/<file>.test.ts` |
| Contract (after any route or schema change) | `pnpm contract:generate`, then commit the regenerated files with the change |
| Phone | `cd apps/mobile && tool/format_check.sh && flutter analyze --fatal-infos && flutter test` |
| Phone against the real API | `flock "$CI_LOCK" env ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres tools/live-sync.sh` |
| PHI guard | `node tools/phi-guard.mjs` |
| **Everything CI runs** (all but the Android build) | `flock "$CI_LOCK" env ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres PORTAL_ENV=test PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome tools/ci-local.sh` |

`tools/ci-local.sh` takes about 15 minutes. It must end with "All local CI checks passed" before
anything is pushed. Without `PW_CHROMIUM_PATH` the portal tests can't start a browser.
Local Postgres is 16; CI also runs 17, so don't rely on version-specific behaviour (the
`unaccent` dictionary differs between them: that is why `normalize_name` is pinned, migration
0015).

## Conventions

- Match the code around you: its comment density, naming and idiom. Comments say why, not what.
- Every default the PRD leaves open is a `PLAN-OPEN:` comment naming the question, and a row in
  `IMPLEMENTATION_PLAN.md` section 6.
- Generated files are never edited by hand: `packages/contract/openapi.json`,
  `packages/contract/src/generated/**`, `apps/mobile/lib/api/generated/**` and the
  `generated/` data modules. Never run `dart format` over `apps/mobile/lib/api/generated`
  (`tool/format_check.sh` skips it).
- Migrations are plain SQL that runs unchanged on RDS, numbered, additive, applied in one
  transaction (no `create index concurrently`). A migration is never edited once merged; a fix is a
  new file.
- `apps/mobile/test/sync/fake_server.dart` mirrors the API's sync rules by hand (plan risk 7). Any
  change to `services/api/src/sync/**` comes with the same change to the fake.
- Every rule gets a regression test. For sync, audit and permission rules, check the test bites:
  revert the rule, see it fail, restore it.
- User-facing copy is plain language, with curly apostrophes as the existing copy has.
- No model names in code, comments, commits or documents.

## Git and the pull request

- Phase work lands on the PR branch (today `claude/modest-feynman-1bz6ws`, draft PR
  dtaing01/sineobex#5). Commit in focused commits with plain messages that say what changed and
  why; end each message with the attribution lines your session's instructions give.
- Push only after `tools/ci-local.sh` passes on the exact commit you push. Keep the PR green: a red
  check is the next thing to fix, before new work goes on top.
- Update the PR description when a phase or a review round lands.

## How a phase is run

1. **Design.** Read the phase's scope in the plan and its PRD modules. Write
   `docs/design/phase-<n>-<name>.md`: data model, sync rules, routes, permissions (existing keys),
   screens, tests mapped to the Done when, defaults, risks, and a **work breakdown into units**, each
   owning its files, in dependency order. Have it critiqued against the PRD and the code before
   anyone builds from it. Phase 3's design is the model.
2. **Build in units.** A unit that others depend on (the schema and contract unit) lands first, alone,
   with CI green. Then units run in parallel only when they own disjoint files. Keep each unit's
   **Status** row in the design doc current as it lands.
3. **Review.** An adversarial review of the whole phase (sync safety, audit, permissions, PHI,
   accessibility, the fake's fidelity). Every confirmed finding is fixed with a regression test.
4. **Close.** Copy the phase's decisions into the plan's D-table, set its status to Done with the
   evidence, update the compliance docs and the PR description.

## Running units with helper agents

- One agent per unit, each in its own git worktree, told to `git reset --hard <PR branch>` first
  (a new worktree may start from `main`).
- Give it: the design sections it needs (by number, so it reads ranges, not the whole file), its
  exact file list, the files it must not touch and who owns them, the rules above, the lock, the
  commit rules, and what to report (branch, SHAs, signatures others call, test results,
  departures from the design, open questions).
- Tell it to commit working pieces as it goes and to report early when other units wait on part of
  its work. Usage limits stop agents mid-task; whatever is committed survives, and nothing else
  does.
- The coordinating session merges each unit onto the PR branch (fast-forward when the agent rebased,
  otherwise cherry-pick), runs the full local CI, pushes, and tells the units that wait on it.
  Worktrees under `.claude/worktrees/` are scratch: nothing in them counts until it is on the branch.
  Remove a worktree only after its agent has stopped.
- Shared test helpers have one owner. A bug in one is fixed by its owner (or the coordinator), on
  the branch, with a test, and every unit is told to rebase.
