#!/bin/bash
# Take the README's pictures again: the welcome piece with the tools on, and the same with
# the panel open on a word. Run out of sight, as a scenario is, at the scale of a 2x display.
#   scripts/screenshots.sh
# The pictures land in docs/images/. WRITEON_APP names the bundle, if not build/Write_On.app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BIN="${WRITEON_APP:-$ROOT/build/Write_On.app}/Contents/MacOS/WriteOn"
[ -x "$BIN" ] || { echo "screenshots: build the app first (scripts/build-app.sh)" >&2; exit 2; }
OUT="$ROOT/build/screenshots"
rm -rf "$OUT"
mkdir -p "$OUT"
cp "$ROOT/scripts/screenshots.js" "$OUT/screenshots.js"
cp "$ROOT/tests/ui/_harness.js" "$OUT/_harness.js"
WRITEON_WEB_ROOT="${WRITEON_WEB_ROOT:-$ROOT/web}" "$BIN" --ui-test "$OUT/screenshots.js" --out "$OUT" --zoom 2 --ai mock
mkdir -p "$ROOT/docs/images"
cp "$OUT/tools.png" "$OUT/panel.png" "$ROOT/docs/images/"
echo "wrote docs/images/tools.png and docs/images/panel.png"
