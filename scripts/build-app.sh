#!/bin/bash
# Build build/Write_On.app with SwiftPM and the Command Line Tools (no Xcode needed).
#   scripts/build-app.sh [release|debug]
# The app is universal: it is built once for Apple silicon and once for Intel, and the two
# executables are joined into one. (SwiftPM builds for both at once only with Xcode.)
# WRITEON_APP names another place for the bundle, so that a copy can be built and tested
# while the one in build/ is open.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-release}"
APP="${WRITEON_APP:-$ROOT/build/Write_On.app}"

# Each half has a build folder of its own. SwiftPM keeps one plan to a folder, and in one
# that the halves share, or share with a plain `swift build`, a build can be handed the
# plan that was made for the other half, and fail.
HALVES=()
for arch in arm64 x86_64; do
  build=(swift build -c "$CONFIG" --package-path "$ROOT" --scratch-path "$ROOT/.build/universal/$arch" --arch "$arch")
  "${build[@]}"
  HALVES+=("$("${build[@]}" --show-bin-path)/WriteOn")
done

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create -output "$APP/Contents/MacOS/WriteOn" "${HALVES[@]}"
cp "$ROOT/packaging/Info.plist" "$APP/Contents/Info.plist"
cp -R "$ROOT/web" "$APP/Contents/Resources/web"
# The icon is drawn by a script and kept in the repository; it is drawn again only if missing.
[ -f "$ROOT/packaging/AppIcon.icns" ] || swift "$ROOT/scripts/make-icon.swift" >/dev/null
cp "$ROOT/packaging/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "built $APP"
