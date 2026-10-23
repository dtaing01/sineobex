#!/usr/bin/env bash
# Prepares a database for the portal's end-to-end tests: migrated, marked "test", seeded with the
# made-up demo team, and a non-owner login for the API (so row-level security applies).
# Usage: ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres tools/e2e-db.sh
set -euo pipefail
ADMIN_URL="${ADMIN_URL:-postgres://postgres@localhost:5432/postgres}"
DB="${E2E_DB:-sineobex_e2e}"
API_ROLE="${E2E_API_ROLE:-sineobex_api_e2e}"
API_PASSWORD="${E2E_API_PASSWORD:-e2e-local-only}"
cd "$(dirname "$0")/.."

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q <<SQL
drop database if exists ${DB} with (force);
create database ${DB};
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = '${API_ROLE}') then
    create role ${API_ROLE} login password '${API_PASSWORD}';
  end if;
end \$\$;
SQL

OWNER_URL="${ADMIN_URL%/*}/${DB}"
DATABASE_URL="$OWNER_URL" pnpm -s db:migrate --environment test
DATABASE_URL="$OWNER_URL" pnpm -s --filter @sineobex/db exec tsx src/cli.ts grant-api "$API_ROLE"
DATABASE_URL="$OWNER_URL" pnpm -s db:seed
echo "e2e database ready: ${DB}"
