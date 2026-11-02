#!/bin/bash
# Makes what the stand-in for GitHub's releases (fake-releases.mjs) hands out, for updates.js.
#   tests/ui/support/make-updates.sh <app> <folder>
# <app> is the copy of the app that the run starts. It is signed again here, with an identity
# made for the run, and it is made to say that it is a release (WriteOnSource), so that it
# may update itself. <folder> then gets the zips of the updates it is offered. Each holds a
# copy of <app>:
#   good.zip       version 99.0.0, signed with the same identity
#   stranger.zip   version 99.0.0, signed with another identity that has the same name
#   adhoc.zip      version 99.0.0, signed ad hoc
#   tampered.zip   version 99.0.0, signed with the same identity, and then a file changed
#   mismatch.zip   version 98.0.0, signed with the same identity (offered as 99.0.0)
# The two identities are made in <folder>, not in the keychains of whoever runs the test, and
# the script deletes their keychains and keys before it ends.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="${1:?usage: make-updates.sh <app> <folder>}"
OUT="${2:?usage: make-updates.sh <app> <folder>}"
rm -rf "$OUT"
mkdir -p "$OUT"
forget() {
  for who in ours stranger; do
    [ ! -e "$OUT/$who/signing.keychain-db" ] || security delete-keychain "$OUT/$who/signing.keychain-db"
    rm -rf "${OUT:?}/$who"
  done
}
trap forget EXIT
for who in ours stranger; do
  WRITEON_SIGNING_DIR="$OUT/$who" "$ROOT/scripts/make-signing-identity.sh" </dev/null >/dev/null
done
sign() {
  WRITEON_SIGNING_DIR="$OUT/$1" "$ROOT/scripts/sign-app.sh" "$2" >/dev/null
}

PLIST="$APP/Contents/Info.plist"
VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$PLIST")"
plutil -replace WriteOnSource -string "v$VERSION" "$PLIST"
sign ours "$APP"

# variant <name> <version> <ours | stranger | adhoc> [tamper]
variant() {
  local work="$OUT/work-$1"
  mkdir -p "$work"
  ditto "$APP" "$work/Write_On.app"
  plutil -replace CFBundleShortVersionString -string "$2" "$work/Write_On.app/Contents/Info.plist"
  plutil -replace WriteOnSource -string "v$2" "$work/Write_On.app/Contents/Info.plist"
  if [ "$3" = adhoc ]; then codesign --force --sign - "$work/Write_On.app" >/dev/null 2>&1; else sign "$3" "$work/Write_On.app"; fi
  [ "${4:-}" != tamper ] || echo "<!-- changed after it was signed -->" >>"$work/Write_On.app/Contents/Resources/web/index.html"
  ditto -c -k --keepParent "$work/Write_On.app" "$OUT/$1.zip"
  rm -rf "$work"
}
variant good 99.0.0 ours
variant stranger 99.0.0 stranger
variant adhoc 99.0.0 adhoc
variant tampered 99.0.0 ours tamper
variant mismatch 98.0.0 ours
echo "make-updates: $APP is $VERSION, signed for the run; the updates are in $OUT"
