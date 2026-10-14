#!/bin/bash
# Re-download the bundled fonts from their published sources and check them against the
# files committed in web/fonts. Both families are under the SIL Open Font License 1.1.
# A font is replaced only by a download that matches its recorded checksum.
set -euo pipefail
cd "$(dirname "$0")/../web/fonts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { # url, output file, sha256 (none for the license texts, which git will show changed)
  curl -fsSL --max-time 60 -o "$TMP/$2" "$1"
  if [ -n "${3:-}" ]; then
    echo "$3  $TMP/$2" | shasum -a 256 -c - >/dev/null 2>&1 ||
      { echo "fetch-fonts: $2 as downloaded is not the file recorded here; left as it was" >&2; exit 1; }
  fi
  mv "$TMP/$2" "$2"
  echo "$2: OK"
}

PLEX="https://cdn.jsdelivr.net/npm/@ibm/plex-mono@1.1.0"
CAVEAT="https://raw.githubusercontent.com/google/fonts/main/ofl/caveat"

fetch "$PLEX/fonts/complete/woff2/IBMPlexMono-Regular.woff2" IBMPlexMono-Regular.woff2 \
  49ce58b41a0e1cb921c0f58d9a5b8b96a2cc21437c7066f3ba4f24873076d131
fetch "$PLEX/fonts/complete/woff2/IBMPlexMono-Bold.woff2" IBMPlexMono-Bold.woff2 \
  5788454f0ba4bd6300752c474215c4dd926682fa173ae1c6252d57828b6a235d
fetch "$CAVEAT/Caveat%5Bwght%5D.ttf" Caveat-Variable.ttf \
  0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988
fetch "$PLEX/LICENSE.txt" LICENSE-IBM-Plex.txt
fetch "$CAVEAT/OFL.txt" LICENSE-Caveat.txt
