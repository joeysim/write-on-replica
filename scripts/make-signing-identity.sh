#!/bin/bash
# Make this Mac's identity for signing Write_On: a certificate for code signing, and its key, in a
# keychain of its own in ~/.writeon-signing. Nothing of it goes into the repository.
#   scripts/make-signing-identity.sh
# macOS sees builds signed with one identity as one app. So when a new build reads the key that
# Settings saved in the Keychain, "Always Allow" from an earlier build still holds. scripts/
# build-app.sh signs with the identity when it is here, and ad hoc when it is not.
# Given WRITEON_SIGNING_P12 (identity.p12 from another Mac, in base64) and its password in
# WRITEON_SIGNING_P12_PASSWORD, the script imports that identity in place of making one. GitHub
# signs a release so, with the identity from the repository's secrets.
# The script makes the identity once. Run again, it keeps the identity that is there. When only
# the keychain is gone, it puts the identity's copy (identity.p12) into a new keychain. It needs
# no password: codesign signs with the certificate, and nothing has to trust it.
set -euo pipefail
DIR="${WRITEON_SIGNING_DIR:-$HOME/.writeon-signing}"
KEYCHAIN="$DIR/signing.keychain-db"
NAME="Write_On Local Signing"
# Apple's own: an OpenSSL 3, as Homebrew puts first on a PATH, writes a copy of the identity
# (identity.p12) that `security import` cannot read.
OPENSSL=/usr/bin/openssl

if [ ! -e "$KEYCHAIN" ]; then
  umask 077
  mkdir -p "$DIR"
  WORK="$(mktemp -d)"
  CREATED=""
  # A keychain without the identity would pass for a whole one on the next run, so a run that
  # fails takes away the keychain it made.
  trap 'status=$?; rm -rf "$WORK"; [ "$status" -eq 0 ] || [ -z "$CREATED" ] || security delete-keychain "$KEYCHAIN"' EXIT
  if [ -n "${WRITEON_SIGNING_P12:-}" ]; then
    # An identity made on another Mac.
    printf '%s' "${WRITEON_SIGNING_P12_PASSWORD:?the password for WRITEON_SIGNING_P12 is not set}" > "$DIR/identity.p12.password"
    printf '%s' "$WRITEON_SIGNING_P12" | base64 --decode > "$DIR/identity.p12"
    DONE=imported
  elif [ -f "$DIR/identity.p12" ] && [ -f "$DIR/identity.p12.password" ]; then
    # The identity made before. GitHub may hold it too, so it is not made again.
    DONE=restored
  else
    cat > "$WORK/certificate.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
    # Ten years. The key goes into the keychain, and into a copy with a password (identity.p12),
    # for another Mac or GitHub to sign with. No copy without a password is kept.
    "$OPENSSL" req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$WORK/key.pem" -out "$WORK/certificate.pem" -config "$WORK/certificate.cnf" 2>/dev/null
    "$OPENSSL" rand -hex 24 > "$DIR/identity.p12.password"
    "$OPENSSL" pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/certificate.pem" -name "$NAME" -out "$DIR/identity.p12" -passout "file:$DIR/identity.p12.password"
    DONE=made
  fi
  # The keychain has a password of its own, in a file beside it, so a build can open it.
  "$OPENSSL" rand -hex 24 > "$DIR/signing.keychain.password"
  security create-keychain -p "$(cat "$DIR/signing.keychain.password")" "$KEYCHAIN"
  CREATED=1
  security set-keychain-settings "$KEYCHAIN" # no lock after a time
  security unlock-keychain -p "$(cat "$DIR/signing.keychain.password")" "$KEYCHAIN"
  security import "$DIR/identity.p12" -k "$KEYCHAIN" -P "$(cat "$DIR/identity.p12.password")" -T /usr/bin/codesign >/dev/null
  # codesign can use the key without a question.
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$(cat "$DIR/signing.keychain.password")" "$KEYCHAIN" >/dev/null
  # The certificate alone, to see what signs the app.
  security find-certificate -c "$NAME" -p "$KEYCHAIN" > "$DIR/certificate.pem"
  echo "$DONE $NAME in $DIR"
fi

echo "Builds on this Mac are signed as $NAME (scripts/build-app.sh)."
