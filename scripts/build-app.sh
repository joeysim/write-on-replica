#!/bin/bash
# Build build/Write_On.app with SwiftPM and the Command Line Tools (no Xcode needed).
#   scripts/build-app.sh [release|debug]
# WRITEON_APP names another place for the bundle, so that a copy can be built and tested
# while the one in build/ is open.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-release}"
APP="${WRITEON_APP:-$ROOT/build/Write_On.app}"

swift build -c "$CONFIG" --package-path "$ROOT"
BIN="$(swift build -c "$CONFIG" --package-path "$ROOT" --show-bin-path)/WriteOn"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/WriteOn"
cp "$ROOT/packaging/Info.plist" "$APP/Contents/Info.plist"
cp -R "$ROOT/web" "$APP/Contents/Resources/web"
# The icon is drawn by a script and kept in the repository; it is drawn again only if missing.
[ -f "$ROOT/packaging/AppIcon.icns" ] || swift "$ROOT/scripts/make-icon.swift" >/dev/null
cp "$ROOT/packaging/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "built $APP"
