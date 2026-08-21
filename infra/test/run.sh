#!/usr/bin/env bash
#
# Runs the database test suite against a real PostgreSQL + PostGIS.
#
# The suite exists because SQL bugs do not show up in a typecheck. Four
# shipped past code review in this repository — two type mismatches that
# failed on every cron run, an unscoped join that leaked one team's inventory
# state to another, and an upsert that aborted on duplicate keys. A real
# database catches all four in under a second.
#
# Usage:
#   infra/test/run.sh                     # uses $DATABASE_URL, or a local socket
#   DATABASE_URL=postgres://... run.sh    # explicit target
#
# The target database is DROPPED and recreated. Never point this at anything
# holding real data.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

DB_NAME="${DB_NAME:-sineobex_test}"
API_PASSWORD="${API_PASSWORD:-test_only_password}"

# CI provides DATABASE_URL for the postgres service container. Locally we fall
# back to whatever libpq is already configured for.
if [[ -n "${DATABASE_URL:-}" ]]; then
  ADMIN_URL="$DATABASE_URL"
  BASE_URL="${DATABASE_URL%/*}"
  TEST_URL="$BASE_URL/$DB_NAME"
else
  ADMIN_URL="postgres:///postgres"
  TEST_URL="postgres:///$DB_NAME"
fi

# The application role connects over the same host as the admin URL, so the
# RLS file can be run through it rather than as a superuser.
api_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    python3 - "$TEST_URL" "$API_PASSWORD" <<'PY'
import sys, urllib.parse as u
p = u.urlparse(sys.argv[1])
netloc = f"sineobex_api:{u.quote(sys.argv[2])}@{p.hostname}"
if p.port:
    netloc += f":{p.port}"
print(u.urlunparse(p._replace(netloc=netloc)))
PY
  else
    echo "postgres://sineobex_api:$API_PASSWORD@/$DB_NAME?host=${PGHOST:-/var/run/postgresql}"
  fi
}

run() {  # run <url> <file...>
  local url="$1"; shift
  for f in "$@"; do
    psql "$url" \
      --quiet --no-psqlrc \
      --set ON_ERROR_STOP=1 \
      --set api_password="$API_PASSWORD" \
      -f "$f"
  done
}

echo "==> Resetting $DB_NAME"
psql "$ADMIN_URL" -q --no-psqlrc --set ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" \
  -c "CREATE DATABASE $DB_NAME;"

echo "==> Applying migrations"
run "$TEST_URL" \
  "$MIGRATIONS/001_initial_schema.sql" \
  "$MIGRATIONS/002_row_level_security.sql" \
  "$MIGRATIONS/003_seed_reference_data.sql"

echo "==> Loading fixtures"
run "$TEST_URL" "$HERE/assert.sql" "$HERE/00_fixtures.sql"

# Row-level security is asserted through the application role. Running it as
# the superuser would pass every check while proving nothing, because a
# superuser bypasses RLS entirely.
echo "==> Row-level security (as sineobex_api)"
run "$(api_url)" "$HERE/10_rls.sql"

echo "==> Integrity and cron queries (as owner)"
run "$TEST_URL" "$HERE/20_integrity.sql" "$HERE/30_cron_queries.sql"

echo
echo "All database tests passed."
