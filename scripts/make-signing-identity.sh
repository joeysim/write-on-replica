#!/bin/bash
# Make this Mac's identity for signing Write_On: a certificate for code signing, and its key, in a
# keychain of its own in ~/.writeon-signing. Nothing of it goes into the repository.
#   scripts/make-signing-identity.sh
# macOS sees builds signed with one identity as one app. So when a new build reads the key that
# Settings saved in the Keychain, "Always Allow" from an earlier build still holds. scripts/
# build-app.sh signs with the identity when it is here and trusted, and ad hoc when it is not.
# The script makes the identity once. Run again, it keeps the identity that is there. macOS signs
# only with a certificate that this Mac trusts for code signing. Trust takes your password once:
# run the script in Terminal, and it asks for it through sudo. Then macOS asks for it again in a
# dialog on this Mac's screen, so be at this Mac, or see its screen through Screen Sharing.
set -euo pipefail
DIR="${WRITEON_SIGNING_DIR:-$HOME/.writeon-signing}"
KEYCHAIN="$DIR/signing.keychain-db"
NAME="Write_On Local Signing"

if [ ! -e "$KEYCHAIN" ]; then
  umask 077
  mkdir -p "$DIR"
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
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
  # Ten years. The key goes into the keychain, and into a copy with a password (identity.p12), for
  # another Mac or GitHub to sign with if that is wanted. No copy without a password is kept.
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$WORK/key.pem" -out "$DIR/certificate.pem" -config "$WORK/certificate.cnf" 2>/dev/null
  openssl rand -hex 24 > "$DIR/identity.p12.password"
  openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$DIR/certificate.pem" -name "$NAME" -out "$DIR/identity.p12" -passout "file:$DIR/identity.p12.password"
  # The keychain has a password of its own, in a file beside it, so a build can open it.
  openssl rand -hex 24 > "$DIR/signing.keychain.password"
  security create-keychain -p "$(cat "$DIR/signing.keychain.password")" "$KEYCHAIN"
  security set-keychain-settings "$KEYCHAIN" # no lock after a time
  security unlock-keychain -p "$(cat "$DIR/signing.keychain.password")" "$KEYCHAIN"
  security import "$DIR/identity.p12" -k "$KEYCHAIN" -P "$(cat "$DIR/identity.p12.password")" -T /usr/bin/codesign >/dev/null
  # codesign can use the key without a question.
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$(cat "$DIR/signing.keychain.password")" "$KEYCHAIN" >/dev/null
  echo "made $NAME in $DIR"
fi

trusted() { security find-identity -v -p codesigning "$KEYCHAIN" | grep -q "\"$NAME\""; }
if ! trusted && [ -t 0 ]; then
  echo "Trust $NAME for code signing, and for nothing else, on this Mac."
  echo "Caution: after sudo, macOS shows a dialog on this Mac's screen. Enter your password there too."
  sudo security add-trusted-cert -d -r trustRoot -p codeSign "$DIR/certificate.pem"
fi
if trusted; then
  echo "$NAME is trusted for code signing: builds on this Mac are signed with it"
else
  echo "$NAME is not trusted yet. Run this once in Terminal on this Mac: scripts/make-signing-identity.sh"
fi
