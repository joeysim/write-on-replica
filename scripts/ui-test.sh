#!/bin/bash
# Run one UI scenario from tests/ui through the built app's harness, in the real web view.
#   scripts/ui-test.sh <scenario> [--zoom 2] [--size 1548x976] [--ai mock] [--timeout 60]
# Snapshots and result.json land in build/ui/<scenario>/. Exit status is the scenario's.
# A scenario can ask for launch options of its own on its first line:
#   // launch: --setting read=false
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" # so that a scenario's launch options can name paths in the project
NAME="${1:?usage: ui-test.sh <scenario> [options]}"
shift
BIN="$ROOT/build/Write_On.app/Contents/MacOS/WriteOn"
SCENARIO="$ROOT/tests/ui/$NAME.js"
[ -x "$BIN" ] || { echo "ui-test: build the app first (scripts/build-app.sh)" >&2; exit 2; }
[ -f "$SCENARIO" ] || { echo "ui-test: no scenario $SCENARIO" >&2; exit 2; }
OUT="$ROOT/build/ui/$NAME"
rm -rf "$OUT"
mkdir -p "$OUT"
status=0
read -r -a OWN <<<"$(sed -n '1s|^// launch: ||p' "$SCENARIO")"
# The page is read from the working copy, so page-only changes need no rebuild.
WRITEON_WEB_ROOT="${WRITEON_WEB_ROOT:-$ROOT/web}" "$BIN" --ui-test "$SCENARIO" --out "$OUT" ${OWN[@]+"${OWN[@]}"} "$@" || status=$?
if [ -f "$OUT/result.json" ]; then
  python3 -I -c '
import json, sys
r = json.load(open(sys.argv[1]))
print(("PASS" if r["ok"] else "FAIL"), r["scenario"], "in", str(r["durationMs"]) + "ms,", len(r["snapshots"]), "snapshot(s)")
for f in r["failures"]: print("  ✖", f)
for l in r["logs"]: print("  ·", l)
' "$OUT/result.json"
else
  echo "FAIL $NAME: the app exited with $status before writing a result" >&2
fi
exit $status
