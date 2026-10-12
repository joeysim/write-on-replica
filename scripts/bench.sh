#!/bin/bash
# Run one measurement from tests/perf in the built app, out of sight, and print what it found.
#   scripts/bench.sh <name> [options for the app, as for ui-test.sh]
# Results land in build/bench/<name>/. WRITEON_APP names the bundle, if not build/Write_On.app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
NAME="${1:?usage: bench.sh <name> [options]}"
shift
BIN="${WRITEON_APP:-$ROOT/build/Write_On.app}/Contents/MacOS/WriteOn"
[ -x "$BIN" ] || { echo "bench: build the app first (scripts/build-app.sh)" >&2; exit 2; }
[ -f "$ROOT/tests/perf/$NAME.js" ] || { echo "bench: no measurement tests/perf/$NAME.js" >&2; exit 2; }
OUT="$ROOT/build/bench/$NAME"
rm -rf "$OUT"
mkdir -p "$OUT"
# The scenario is run with the documents it measures on in scope.
{ cat "$ROOT/tests/perf/_pieces.js"; echo; cat "$ROOT/tests/perf/$NAME.js"; } >"$OUT/$NAME.js"
cp "$ROOT/tests/ui/_harness.js" "$OUT/_harness.js"
status=0
WRITEON_WEB_ROOT="${WRITEON_WEB_ROOT:-$ROOT/web}" "$BIN" --ui-test "$OUT/$NAME.js" --out "$OUT" --timeout 600 "$@" || status=$?
python3 -I -c '
import json, sys
r = json.load(open(sys.argv[1]))
if not r["ok"]:
    print("FAILED", r["scenario"])
    for f in r["failures"]: print("  ✖", f)
for l in r["logs"]: print(l)
' "$OUT/result.json"
exit $status
