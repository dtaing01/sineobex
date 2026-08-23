#!/usr/bin/env bash
#
# Guards docs/ARCHITECTURE.md against drift.
#
# It checks one narrow thing: that every name the architecture doc claims to
# describe still exists in the source, and that every name in the source is
# still mentioned in the doc. Names are what rot first and are cheapest to
# catch — a route renamed in code and not in the doc is a silent lie.
#
# It cannot tell you whether a diagram still describes how the system behaves.
# That judgement stays with the reviewer.
#
# Usage: docs/check-architecture.sh
set -euo pipefail

cd "$(dirname "$0")/.."

DOC="docs/ARCHITECTURE.md"
ROUTER="app/lib/core/router/app_router.dart"
CRON="infra/lambda/cron/index.ts"
API_STACK="infra/lib/api-stack.ts"

fail=0

for f in "$DOC" "$ROUTER" "$CRON" "$API_STACK"; do
  if [ ! -f "$f" ]; then
    echo "error: missing $f" >&2
    exit 1
  fi
done

# A literal backtick. Kept in a variable so the greps below can stay in double
# quotes without shellcheck reading them as command substitution.
BT=$(printf '\140')

# Prints the doc between two numbered headings, e.g. `section 6 7`.
section() {
  sed -n "/^## $1\./,/^## $2\./p" "$DOC"
}

# Reports a name that exists in the source but is absent from the doc.
check_in_doc() {
  local kind="$1" name="$2"
  if ! grep -qF -- "$name" "$DOC"; then
    echo "  MISSING  $kind '$name' is in the source but not in $DOC"
    fail=1
  fi
}

# Reports a name the doc claims that no longer exists in the source.
check_in_source() {
  local kind="$1" name="$2" file="$3"
  if ! grep -qF -- "$name" "$file"; then
    echo "  STALE    $kind '$name' is in $DOC but no longer in $file"
    fail=1
  fi
}

echo "Checking navigation routes..."
# AppRoutes constants, e.g.  static const dashboard = '/dashboard';
routes=$(grep -oE "static const [a-zA-Z]+ = '[^']+'" "$ROUTER" \
  | sed -E "s/.*'([^']+)'/\1/" | sort -u)
for r in $routes; do
  check_in_doc "route" "$r"
done

echo "Checking cron job names..."
# Job registry keys, e.g.  'analytics-rollup': analyticsRollup,
jobs=$(grep -oE "^\s+'[a-z-]+': [a-zA-Z]+," "$CRON" \
  | sed -E "s/.*'([^']+)'.*/\1/" | sort -u)
for j in $jobs; do
  check_in_doc "cron job" "$j"
done
# And the reverse: a job the doc still documents that has been removed. Read
# it back out of the doc's own job table rather than repeating the list here,
# so this script never becomes a third place the names have to be kept in step.
doc_jobs=$(section 7 8 | grep -oE "^\| ${BT}[a-z-]+${BT}" | tr -d "|${BT} " | sort -u)
for j in $doc_jobs; do
  check_in_source "cron job" "$j" "$CRON"
done

echo "Checking API routes..."
# Route table entries, e.g.  [[apigwv2.HttpMethod.GET], '/v1/reference'],
api_routes=$(grep -oE "'/v1/[a-z/-]+'" "$API_STACK" | tr -d "'" | sort -u)
for a in $api_routes; do
  check_in_doc "API route" "$a"
done
# The reverse, so a deleted route does not linger in the doc.
doc_routes=$(section 6 7 | grep -oE "${BT}/v1/[a-z/-]+${BT}" | tr -d "${BT}" | sort -u)
for a in $doc_routes; do
  check_in_source "API route" "$a" "$API_STACK"
done

echo "Checking session states..."
states=$(sed -n '/^enum SessionState/,/^}/p' \
  app/lib/features/auth/session_controller.dart \
  | grep -oE "^  [a-zA-Z]+," | tr -d ' ,' | sort -u)
for st in $states; do
  check_in_doc "session state" "$st"
done

if [ "$fail" -ne 0 ]; then
  cat >&2 <<'MSG'

docs/ARCHITECTURE.md has drifted from the code.

That document is meant to describe the system as it exists, so a mismatch is a
doc bug, not a nuisance. Update the affected section — the table at the top of
the file maps each source path to the section that covers it — and check that
the surrounding diagram still tells the truth while you are there.
MSG
  exit 1
fi

echo "OK: ARCHITECTURE.md matches the source."
