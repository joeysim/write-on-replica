#!/bin/bash
# Build build/Write_On.app with SwiftPM and the Command Line Tools (no Xcode needed).
#   scripts/build-app.sh [release|debug]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-release}"
APP="$ROOT/build/Write_On.app"

swift build -c "$CONFIG" --package-path "$ROOT"
BIN="$(swift build -c "$CONFIG" --package-path "$ROOT" --show-bin-path)/WriteOn"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/WriteOn"
cp "$ROOT/packaging/Info.plist" "$APP/Contents/Info.plist"
cp -R "$ROOT/web" "$APP/Contents/Resources/web"
if [ -f "$ROOT/packaging/AppIcon.icns" ]; then
  cp "$ROOT/packaging/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
fi
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "built $APP"
