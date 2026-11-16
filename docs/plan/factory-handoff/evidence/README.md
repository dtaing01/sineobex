# Evidence: the F0-package card with a stand-in model

These runs check **the card and the driver, not a model**. A small HTTP server stood in for the
model runner (`/api/version`, `/api/show`, `/api/ps`, `/api/chat`, as
`tools/test/card-run-cli.test.mjs` does) and returned the card's expected three parts. Each run was
made in a scratch git worktree on a `work/probe/*` branch made from `ca2c4db`, with the card
committed at `docs/plan/phase-4-encounters/cards/F0-package.md`. The worktrees and branches were then
removed. Paths are shown as `<worktree>`, `<repo>` and `<pnpm-cache>`.

| File | Card's install line | Result |
|---|---|---|
| `F0-package-offline-run.txt` | `pnpm install --offline --no-frozen-lockfile` (an earlier version of the card) | Exit 1 after two attempts: `ERR_PNPM_NO_OFFLINE_META`. The machine's store was warm from `pnpm install --frozen-lockfile`, but a new workspace package needs registry metadata for its dependencies and their dependencies. Warming the metadata of the four direct dependencies alone still failed, on a transitive one. The model's reply was correct; the driver counted an environment failure as a failed card (A4) |
| `F0-package-registry-run.txt` | `pnpm install --prefer-offline --no-frozen-lockfile` (the card as proposed) | Exit 0 after one attempt. The whole Run block passed: install, `--filter @sineobex/forms typecheck`, repo-wide lint, format check and type check. Committed "not audited" on the work branch |
| `F0-package-commit.diff` | — | That commit: the three new files and a lockfile change that only adds the `packages/forms` importer at the versions `packages/contract` uses |

Also verified this way: in a git worktree the driver ran a level T card's first run, range-checked a
`Read first` item through the shared history, wrote its part and committed on a `work/` branch
(A3). With the worktree's `gitdir` pointing at a path that doesn't exist, git stops with "not a git
repository".

To repeat: make a worktree on a `work/` branch, copy `../proposed-cards/F0-package.md` to
`docs/plan/phase-4-encounters/cards/`, commit it, start a stand-in runner on a free local port, and
run `CARD_MODEL=stub node tools/card-run.mjs docs/plan/phase-4-encounters/cards/F0-package.md
--url http://127.0.0.1:<port> --commit`. Not repeated: a run with a real model, and anything
inside a container.
