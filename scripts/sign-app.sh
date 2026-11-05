#!/bin/bash
# Sign an app as scripts/build-app.sh signs the one it builds: with this Mac's signing
# identity where it has one (scripts/make-signing-identity.sh), so that every build has the
# same designated requirement, which Check for Updates checks an update against; and ad hoc
# where it does not. codesign needs no trust in the certificate to sign with it.
#   scripts/sign-app.sh <app>
# WRITEON_SIGNING_DIR names the identity's folder, if not ~/.writeon-signing. Says how the
# app is signed: "signed as Write_On Local Signing", or "signed ad hoc".
set -euo pipefail
APP="${1:?usage: sign-app.sh <app>}"
SIGNING="${WRITEON_SIGNING_DIR:-$HOME/.writeon-signing}"
KEYCHAIN="$SIGNING/signing.keychain-db"
IDENTITY=""
if [ -f "$KEYCHAIN" ] && [ -f "$SIGNING/signing.keychain.password" ]; then
  security unlock-keychain -p "$(cat "$SIGNING/signing.keychain.password")" "$KEYCHAIN"
  IDENTITY="$(security find-identity -p codesigning "$KEYCHAIN" | awk '/"Write_On Local Signing"/ { print $2; exit }')"
  [ -n "$IDENTITY" ] || echo "sign-app: there is no Write_On Local Signing in $KEYCHAIN: signing ad hoc" >&2
fi
if [ -z "$IDENTITY" ]; then
  codesign --force --sign - "$APP" >/dev/null 2>&1
  echo "signed ad hoc"
  exit 0
fi

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
  echo "sign-app: codesign could not sign with Write_On Local Signing: $SAID" >&2
  exit 1
fi
echo "signed as Write_On Local Signing"
