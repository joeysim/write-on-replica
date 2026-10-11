#!/bin/bash
# Everything that must be green: unit tests, a build, and the UI scenarios named on the
# command line (default: all of them).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm test --silent 2>&1 | grep -E "^ℹ (tests|pass|fail)" | tr '\n' ' '
echo
scripts/build-app.sh >/dev/null
if [ $# -eq 0 ]; then
  set -- $(ls tests/ui/*.js | xargs -n1 basename | sed 's/\.js$//' | grep -v '^_')
fi
failed=0
for scenario in "$@"; do
  scripts/ui-test.sh "$scenario" --ai mock || failed=1
done
[ "$failed" -eq 0 ] && echo "check: all green" || { echo "check: FAILED"; exit 1; }
