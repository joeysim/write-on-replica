#!/bin/bash
# Make the copy of the app that goes on a release: build/release/Write_On-<version>.zip.
#   scripts/package.sh
# The app is built afresh in build/release, so the one in build/ can stay open. A release is
# of a commit, so nothing is packaged while the working copy has changes that are not
# committed. The zip is then opened again and looked at, since it is what strangers will
# run: the signature has to hold, both halves have to be there, and nothing of this Mac (its
# name, the path of your home folder) may be in it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/release"
VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$ROOT/packaging/Info.plist")"
ZIP="$OUT/Write_On-$VERSION.zip"

# Where this folder is a repository of its own. (A copy downloaded as an archive has no
# commits to be of.)
if [ "$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" = "$(cd "$ROOT" && pwd -P)" ] && [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "package: commit what has changed, or put it aside, first (git status): a release is of a commit" >&2
  exit 1
fi

rm -rf "$OUT"
WRITEON_APP="$OUT/Write_On.app" "$ROOT/scripts/build-app.sh" >/dev/null
# The files and nothing else: no resource forks, extended attributes or access lists. The
# app needs none of them, and any of them would put a __MACOSX folder in the zip.
ditto -c -k --keepParent --norsrc --noextattr --noacl "$OUT/Write_On.app" "$ZIP"

OPENED="$(mktemp -d)"
trap 'rm -rf "$OPENED"' EXIT
fail() {
  echo "package: $1" >&2
  rm -f "$ZIP"
  exit 1
}
ditto -x -k "$ZIP" "$OPENED"
APP="$OPENED/Write_On.app"
[ "$(ls -A "$OPENED")" = "Write_On.app" ] || fail "the zip holds more than the app"
codesign --verify --deep --strict "$APP" 2>/dev/null || fail "the app's signature does not hold once it is unzipped"
[ "$(lipo -archs "$APP/Contents/MacOS/WriteOn" | tr ' ' '\n' | sort | xargs)" = "arm64 x86_64" ] || fail "the app is not universal"
for mine in "$HOME" "$(scutil --get LocalHostName 2>/dev/null || true)"; do
  [ -z "$mine" ] || ! grep -r -a -q -F -e "$mine" "$APP" || fail "the app has '$mine' in it"
done

echo "$ZIP"
echo "Write_On $VERSION, $(du -h "$ZIP" | cut -f1 | xargs), sha256 $(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
