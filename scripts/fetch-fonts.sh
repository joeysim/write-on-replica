#!/bin/bash
# Re-download the bundled fonts from their published sources and check them against the
# files committed in web/fonts. Both families are under the SIL Open Font License 1.1.
set -euo pipefail
cd "$(dirname "$0")/../web/fonts"

fetch() { # url, output file, sha256
  curl -fsSL --max-time 60 -o "$2" "$1"
  echo "$3  $2" | shasum -a 256 -c -
}

PLEX="https://cdn.jsdelivr.net/npm/@ibm/plex-mono@1.1.0"
CAVEAT="https://raw.githubusercontent.com/google/fonts/main/ofl/caveat"

fetch "$PLEX/fonts/complete/woff2/IBMPlexMono-Regular.woff2" IBMPlexMono-Regular.woff2 \
  49ce58b41a0e1cb921c0f58d9a5b8b96a2cc21437c7066f3ba4f24873076d131
fetch "$PLEX/fonts/complete/woff2/IBMPlexMono-Bold.woff2" IBMPlexMono-Bold.woff2 \
  5788454f0ba4bd6300752c474215c4dd926682fa173ae1c6252d57828b6a235d
fetch "$CAVEAT/Caveat%5Bwght%5D.ttf" Caveat-Variable.ttf \
  0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988
curl -fsSL --max-time 60 -o LICENSE-IBM-Plex.txt "$PLEX/LICENSE.txt"
curl -fsSL --max-time 60 -o LICENSE-Caveat.txt "$CAVEAT/OFL.txt"
