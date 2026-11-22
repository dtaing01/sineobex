#!/usr/bin/env bash
# Runs what CI runs, locally, so a push doesn't find out first. Needs: pnpm, a superuser Postgres
# at $ADMIN_URL, Flutter, Deno, gitleaks and actionlint on PATH. Skips the Android build (needs
# the Android SDK) and Chromium download (set PW_CHROMIUM_PATH to use a local Chromium).
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN_URL="${ADMIN_URL:-postgres://postgres@localhost:5432/postgres}"
export TEST_ADMIN_DATABASE_URL="$ADMIN_URL"
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
# set -e does not stop at a failure inside an && list, only at its last command, so the checks of a
# step are separate commands (or one subshell).

step "Secret scan";              gitleaks git --redact --exit-code 1 . >/dev/null
step "PHI guard";                node tools/phi-guard.mjs
step "Task card check";         node tools/card-check.mjs
step "Lint, format, types";      pnpm -s lint; pnpm -s format:check; pnpm -s typecheck >/dev/null
step "Unit tests";               pnpm -s --filter @sineobex/contract --filter @sineobex/tools --filter @sineobex/forms --filter @sineobex/presets --filter @sineobex/portal test
step "Migrations on scratch DB"
psql "$ADMIN_URL" -qc 'drop database if exists ci_scratch with (force)' -c 'create database ci_scratch'
SCRATCH="${ADMIN_URL%/*}/ci_scratch"
DATABASE_URL="$SCRATCH" pnpm -s db:migrate --environment local >/dev/null
DATABASE_URL="$SCRATCH" pnpm -s db:migrate >/dev/null
DATABASE_URL="$SCRATCH" pnpm -s db:seed >/dev/null
step "Database and API tests";   pnpm -s --filter @sineobex/db test; pnpm -s --filter @sineobex/api test
step "Edge bundle under Deno";   pnpm -s --filter @sineobex/api build >/dev/null; DATABASE_URL="$SCRATCH" services/api/scripts/smoke-edge.sh
step "Contract drift"
pnpm -s contract:generate >/dev/null
git diff --exit-code -- packages/contract/openapi.json packages/contract/src/generated apps/mobile/lib/api/generated
step "Forms drift"
# The export's notes (pieces and lists nothing uses yet) are left out; its problems are not.
pnpm -s forms:export | grep -v '^note '
pnpm -s --filter @sineobex/forms golden >/dev/null
# A released line never leaves the lock: the export alone would take a lock deleted or emptied.
FORMS_BASE="$(git merge-base HEAD origin/main)"
pnpm -s --filter @sineobex/forms lock-grows "$FORMS_BASE"
# Nor a line the branch held before: main holds no lock while a release lives on a branch, so a
# version released there and then edited would pass against main alone (forms design 4.2).
# LOCK_BASE names another ref to hold the lock to.
if [ -n "${LOCK_BASE:-}" ]; then
  pnpm -s --filter @sineobex/forms lock-grows "$LOCK_BASE"
fi
FORMS_BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
if [ -n "$FORMS_BRANCH" ] && git rev-parse --verify --quiet "refs/remotes/origin/$FORMS_BRANCH^{commit}" >/dev/null; then
  pnpm -s --filter @sineobex/forms lock-grows "origin/$FORMS_BRANCH"
else
  echo "No origin/${FORMS_BRANCH:-<detached HEAD>}: the lock is held to origin/main only."
fi
FORMS_GENERATED=(packages/forms/generated apps/mobile/assets/forms)
git diff --exit-code -- "${FORMS_GENERATED[@]}"
# A generated file that was never committed is drift too, and git diff does not see it.
git status --short -- "${FORMS_GENERATED[@]}"
test -z "$(git status --porcelain -- "${FORMS_GENERATED[@]}")"
step "Flutter";                  (cd apps/mobile && flutter pub get --enforce-lockfile >/dev/null && tool/format_check.sh && flutter analyze --fatal-infos && flutter test)
step "Portal end-to-end";        ADMIN_URL="$ADMIN_URL" tools/e2e-db.sh >/dev/null; pnpm -s --filter @sineobex/portal build >/dev/null; (cd apps/portal && CI=1 pnpm -s test:a11y)
step "Phone sync, real API";     ADMIN_URL="$ADMIN_URL" tools/live-sync.sh
step "Website";                  pnpm -s --filter @sineobex/website typecheck; pnpm -s --filter @sineobex/website build >/dev/null
step "Workflows and scripts";    actionlint; git ls-files '*.sh' | xargs shellcheck
printf '\n\033[1;32mAll local CI checks passed.\033[0m\n'
