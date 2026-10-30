#!/usr/bin/env bash
# dart format, skipping generated code (the contract generator owns lib/api/generated/).
set -euo pipefail
cd "$(dirname "$0")/.."
mapfile -t files < <(find lib test -name '*.dart' -not -path 'lib/api/generated/*' -not -name '*.g.dart' | sort)
dart format --set-exit-if-changed "${files[@]}"
