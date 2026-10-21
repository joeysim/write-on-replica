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
# A release build may go to someone else's Mac. What a debugger would use to find the source
# names every file by its full path on the Mac that built it, home folder and all, so it is
# taken out. (The signature this breaks is made again below.)
[ "$CONFIG" != release ] || strip -S -no_code_signature_warning "$APP/Contents/MacOS/WriteOn"
cp "$ROOT/packaging/Info.plist" "$APP/Contents/Info.plist"
# Where the build came from, as git names it: v1.0.1 at a release's tag, v1.0.1-1-g0ce718c a
# commit after it, and -dirty on the end with changes not committed; and the commit itself.
# About shows the commit for a release and the rest for any other build (README, "Versions").
# A copy with no history has nothing to say.
if [ "$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" = "$(cd "$ROOT" && pwd -P)" ]; then
  SOURCE="$(git -C "$ROOT" describe --tags --match 'v[0-9]*' --dirty 2>/dev/null || true)"
  COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"
  [ -z "$SOURCE" ] || plutil -insert WriteOnSource -string "$SOURCE" "$APP/Contents/Info.plist"
  [ -z "$COMMIT" ] || plutil -insert WriteOnCommit -string "$COMMIT" "$APP/Contents/Info.plist"
fi
cp -R "$ROOT/web" "$APP/Contents/Resources/web"
# The icon is drawn by a script and kept in the repository; it is drawn again only if missing.
[ -f "$ROOT/packaging/AppIcon.icns" ] || swift "$ROOT/scripts/make-icon.swift" >/dev/null
cp "$ROOT/packaging/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
# The signature. A Mac with a signing identity of its own (scripts/make-signing-identity.sh) signs
# with it, so that macOS sees each build as the same app. Elsewhere the signature is ad hoc.
# codesign needs no trust in the certificate to sign with it.
SIGNING="${WRITEON_SIGNING_DIR:-$HOME/.writeon-signing}"
KEYCHAIN="$SIGNING/signing.keychain-db"
IDENTITY=""
if [ -f "$KEYCHAIN" ] && [ -f "$SIGNING/signing.keychain.password" ]; then
  security unlock-keychain -p "$(cat "$SIGNING/signing.keychain.password")" "$KEYCHAIN"
  IDENTITY="$(security find-identity -p codesigning "$KEYCHAIN" | awk '/"Write_On Local Signing"/ { print $2; exit }')"
  [ -n "$IDENTITY" ] || echo "build-app: there is no Write_On Local Signing in $KEYCHAIN: signing ad hoc" >&2
fi
if [ -n "$IDENTITY" ]; then
  # codesign finds an identity only in a keychain on the search list. The signing keychain is
  # on the list only while codesign runs: when it is locked, as after a restart, other apps
  # could ask for its password.
  LISTED=()
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line#\"}"
    line="${line%\"}"
    [ -z "$line" ] || LISTED+=("$line")
  done < <(security list-keychains -d user)
  trap 'security list-keychains -d user -s "${LISTED[@]}"' EXIT
  security list-keychains -d user -s "${LISTED[@]}" "$KEYCHAIN"
  SAID=""
  SIGNED=0
  SAID="$(codesign --force --sign "$IDENTITY" --keychain "$KEYCHAIN" "$APP" 2>&1)" || SIGNED=$?
  security list-keychains -d user -s "${LISTED[@]}"
  trap - EXIT
  if [ "$SIGNED" -ne 0 ]; then
    echo "build-app: codesign could not sign with Write_On Local Signing: $SAID" >&2
    exit 1
  fi
  echo "built $APP, signed as Write_On Local Signing"
else
  codesign --force --sign - "$APP" >/dev/null 2>&1
  echo "built $APP"
fi
