#!/bin/bash
# Start the built app for real, the way Finder does, and see that it comes up: it stays
# running, opens its window, and neither the shell nor the page reports an error. Then quit it.
#
#   scripts/launch-check.sh
#
# The app is opened in the background and hidden. It is never brought to the front and takes
# neither the keyboard nor the pointer; its icon is in the Dock for the few seconds it runs.
# What the launch leaves in the app's saved settings (that the welcome piece has been shown)
# is put back as it was.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/build/Write_On.app"
ID="com.thesimhons.writeon"
[ -d "$APP" ] || { echo "launch-check: build the app first (scripts/build-app.sh)" >&2; exit 2; }
running() { pgrep -f "Write_On.app/Contents/MacOS/WriteOn" | while read -r pid; do ps -o args= -p "$pid" | grep -qv -- "--ui-test" && echo "$pid"; done; }
[ -z "$(running)" ] || { echo "launch-check: Write_On is already running; quit it first" >&2; exit 2; }

WORK="$(mktemp -d)"
had_settings=0
if defaults read "$ID" >/dev/null 2>&1; then
  had_settings=1
  defaults export "$ID" "$WORK/settings.plist"
fi
front_before="$(lsappinfo front)"

open -g -j "$APP" --stdout "$WORK/out.log" --stderr "$WORK/err.log"
pid=""
for _ in $(seq 50); do
  pid="$(running | head -1)"
  [ -n "$pid" ] && break
  sleep 0.2
done
problems=()
[ -n "$pid" ] || problems+=("the app did not start")
sleep 4 # the page loads, with its fonts, and says it is ready

if [ -n "$pid" ]; then
  kill -0 "$pid" 2>/dev/null || problems+=("the app started and then went away")
  windows="$(swift - "$pid" <<'EOF' 2>/dev/null || echo "?"
import CoreGraphics
import Foundation
let pid = Int(CommandLine.arguments[1]) ?? 0
let all = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
let own = all.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
let big = own.filter { (($0[kCGWindowBounds as String] as? [String: Any])?["Width"] as? Double ?? 0) >= 700 }
print(big.count)
EOF
)"
  [ "$windows" = "1" ] || problems+=("expected one document window, found $windows")
  [ "$(lsappinfo front)" = "$front_before" ] || problems+=("the app came to the front")
  if grep -q "\[page:error\]\|\[shell\]" "$WORK/err.log" 2>/dev/null; then
    problems+=("it reported: $(grep "\[page:error\]\|\[shell\]" "$WORK/err.log" | head -3 | tr '\n' ' ')")
  fi
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 25); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
  kill -0 "$pid" 2>/dev/null && { kill -KILL "$pid" 2>/dev/null || true; problems+=("it did not quit when asked"); }
fi

# The settings go back to what they were.
if [ "$had_settings" = 1 ]; then
  defaults import "$ID" "$WORK/settings.plist"
else
  defaults delete "$ID" >/dev/null 2>&1 || true
fi
rm -rf "$WORK"

if [ ${#problems[@]} -eq 0 ]; then
  echo "launch-check: the app starts, opens its window and reports no error"
else
  printf 'launch-check: FAILED: %s\n' "${problems[@]}"
  exit 1
fi
