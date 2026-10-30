#!/usr/bin/env bash
# Runs the phone's sync scenarios (apps/mobile/test/sync/live_api_test.dart) against the real API
# on a freshly seeded database. CI's "Phone sync against the real API" job and tools/ci-local.sh
# both run this. Needs: pnpm, Flutter, curl, and a superuser Postgres at $ADMIN_URL.
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN_URL="${ADMIN_URL:-postgres://postgres@localhost:5432/postgres}"
LOGS="${RUNNER_TEMP:-$(mktemp -d)}"
API_PORT=8787
IDP_PORT=8790
# Same server as $ADMIN_URL: the seeded e2e database, as the API's non-owner login.
HOST_PART="${ADMIN_URL#*@}"
API_DATABASE_URL="postgres://sineobex_api_e2e:e2e-local-only@${HOST_PART%/*}/sineobex_e2e"

listening() { curl -s -o /dev/null "http://localhost:$1/"; }
up() {
  curl -sf "http://localhost:$API_PORT/v1/health" > /dev/null &&
    curl -sf "http://localhost:$IDP_PORT/.well-known/jwks.json" > /dev/null
}

# A leftover server would answer instead of the one started here, with other keys.
for port in "$API_PORT" "$IDP_PORT"; do
  if listening "$port"; then
    echo "Something is already listening on port $port; stop it first." >&2
    exit 1
  fi
done

ADMIN_URL="$ADMIN_URL" tools/e2e-db.sh

# Each server runs in its own session, so stopping it stops the processes pnpm and tsx start.
idp_group=""
api_group=""
trap 'kill -TERM -- "-$idp_group" "-$api_group" 2> /dev/null || true' EXIT

DEV_IDP_PORT="$IDP_PORT" setsid node tools/dev-idp.mjs > "$LOGS/idp.log" 2>&1 &
idp_group=$!
(
  cd services/api
  APP_ENV=test \
    DATABASE_URL="$API_DATABASE_URL" \
    OIDC_ISSUER="http://localhost:$IDP_PORT" \
    OIDC_AUDIENCE=sineobex-local \
    OIDC_JWKS_URL="http://localhost:$IDP_PORT/.well-known/jwks.json" \
    MFA_MODE=aal \
    IDENTITY_ADMIN=memory \
    PORT="$API_PORT" \
    exec setsid pnpm -s exec tsx src/entry/node.ts
) > "$LOGS/api.log" 2>&1 &
api_group=$!

for _ in $(seq 1 60); do
  up && break
  sleep 1
done
if ! up; then
  echo "The API or the identity provider did not start." >&2
  cat "$LOGS/api.log" "$LOGS/idp.log" >&2
  exit 1
fi

status=0
(
  cd apps/mobile
  SINEOBEX_LIVE_API="http://localhost:$API_PORT" \
    SINEOBEX_LIVE_IDP="http://localhost:$IDP_PORT" \
    SINEOBEX_LIVE_REQUIRED=1 \
    flutter test test/sync/live_api_test.dart
) || status=$?
if [[ $status -ne 0 ]]; then
  # The API's log holds no patient details (allowlisted fields only), and this is demo data.
  tail -n 200 "$LOGS/api.log" >&2
fi
exit "$status"
