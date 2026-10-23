#!/usr/bin/env bash
# Runs the bundled Supabase Edge Function under Deno against a real database and checks that it
# serves. Catches breakage in the Deno entry that the Node tests can't see.
# Needs: deno on PATH, DATABASE_URL pointing at a migrated database.
set -euo pipefail
cd "$(dirname "$0")/../supabase/functions/api"
test -f bundle.js || { echo "bundle.js missing; run pnpm build first" >&2; exit 1; }

APP_ENV=local MFA_MODE=none IDENTITY_ADMIN=memory \
OIDC_ISSUER=https://idp.example.invalid OIDC_AUDIENCE=smoke OIDC_JWKS_URL=https://idp.example.invalid/jwks \
  deno run --allow-net --allow-env --allow-read --allow-sys bundle.js >deno-smoke.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; rm -f deno-smoke.log' EXIT

for _ in $(seq 1 30); do
  if body=$(curl -fsS http://localhost:8000/api/v1/health 2>/dev/null); then
    echo "health: $body"
    grep -q '"status":"ok"' <<<"$body"
    curl -fsS http://localhost:8000/api/v1/time >/dev/null
    echo "edge bundle smoke test passed"
    exit 0
  fi
  sleep 1
done
echo "edge bundle did not become healthy" >&2
cat deno-smoke.log >&2
exit 1
