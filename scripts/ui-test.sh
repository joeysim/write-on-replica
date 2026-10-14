#!/bin/bash
# Run one UI scenario from tests/ui through the built app's harness, in the real web view.
#   scripts/ui-test.sh <scenario> [--zoom 2] [--size 1548x976] [--ai mock] [--timeout 60]
# Snapshots and result.json land in build/ui/<scenario>/. Exit status is the scenario's.
# WRITEON_APP names the bundle to run, if not build/Write_On.app.
# WRITEON_ARCH names the half of the universal app to run, if not the Mac's own: x86_64 runs
# the Intel half on an Apple silicon Mac, under Rosetta.
# A scenario can ask for launch options of its own on its first line:
#   // launch: --setting read=false
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" # so that a scenario's launch options can name paths in the project
NAME="${1:?usage: ui-test.sh <scenario> [options]}"
shift
BIN="${WRITEON_APP:-$ROOT/build/Write_On.app}/Contents/MacOS/WriteOn"
SCENARIO="$ROOT/tests/ui/$NAME.js"
[ -x "$BIN" ] || { echo "ui-test: build the app first (scripts/build-app.sh)" >&2; exit 2; }
[ -f "$SCENARIO" ] || { echo "ui-test: no scenario $SCENARIO" >&2; exit 2; }
OUT="$ROOT/build/ui/$NAME"
rm -rf "$OUT"
mkdir -p "$OUT"
status=0
read -r -a OWN <<<"$(sed -n '1s|^// launch: ||p' "$SCENARIO")"

# Unless the run is a live one (--ai live), the app is given nothing of what this shell says
# about the AI service: not its key, its address, its format or its model. A scenario then
# starts the same for everyone, and a key of yours is sent nowhere by a test.
AI=""
for option in ${OWN[@]+"${OWN[@]}"} "$@"; do
  if [ "$AI" = "--ai" ]; then AI="$option"; break; fi
  [ "$option" = "--ai" ] && AI="--ai"
done
[ "$AI" = "live" ] || unset WRITEON_API_KEY WRITEON_BASE_URL WRITEON_API_FORMAT WRITEON_MODEL LUNAROUTE_API_KEY LUNAROUTE_BASE_URL

# A scenario can also ask for a stand-in for the AI gateway, on its second line:
#   // gateway: tests/ui/support/fake-gateway.mjs
# It is started here and stopped afterwards, and the app is given its address and a key it
# knows. Nothing of the run then leaves this Mac.
GATEWAY="$(sed -n '2s|^// gateway: ||p' "$SCENARIO")"
if [ -n "$GATEWAY" ]; then
  node "$ROOT/$GATEWAY" >"$OUT/gateway.log" 2>&1 &
  GATEWAY_PID=$!
  trap 'kill "$GATEWAY_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 50); do
    PORT="$(sed -n 's/^listening //p' "$OUT/gateway.log")"
    [ -n "$PORT" ] && break
    sleep 0.1
  done
  [ -n "${PORT:-}" ] || { echo "ui-test: the stand-in gateway did not start (see $OUT/gateway.log)" >&2; exit 2; }
  export WRITEON_BASE_URL="http://127.0.0.1:$PORT/v1"
  export WRITEON_API_KEY="fake-key-from-the-environment"
fi

# Which half of the app runs is the Mac's choice, unless one is named.
HALF=()
[ -z "${WRITEON_ARCH:-}" ] || HALF=(arch "-$WRITEON_ARCH")

# The page is read from the working copy, so page-only changes need no rebuild.
WRITEON_WEB_ROOT="${WRITEON_WEB_ROOT:-$ROOT/web}" ${HALF[@]+"${HALF[@]}"} "$BIN" --ui-test "$SCENARIO" --out "$OUT" ${OWN[@]+"${OWN[@]}"} "$@" || status=$?
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
