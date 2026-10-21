#!/bin/bash
# What a release's page on GitHub says, in Markdown: what CHANGELOG.md says of the version,
# then how to open the download, with its size and checksum.
#   scripts/release-notes.sh <version> <zip>
# The release workflow (.github/workflows/release.yml) publishes it. Run by hand, it shows
# what a release will say.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:?usage: release-notes.sh <version> <zip>}"
ZIP="${2:?usage: release-notes.sh <version> <zip>}"
REPO="https://github.com/${GITHUB_REPOSITORY:-joeysim/write-on-replica}"

# The version's part of CHANGELOG.md, from under its heading to the next one. Its lines are
# wrapped for reading in a file; a release's page would break them where they are, so each
# paragraph and each item of a list is put back on one line.
CHANGES="$(python3 -I - "$ROOT/CHANGELOG.md" "$VERSION" <<'EOF'
import re, sys
path, version = sys.argv[1:]
found = re.search(r'^## %s(?: \([^\n]*\))?\n(.*?)(?=^## |\Z)' % re.escape(version), open(path).read(), re.S | re.M)
lines = []
for line in (found.group(1).strip() if found else '').split('\n'):
    if lines and line.strip() and lines[-1].strip() and not re.match(r'\s*([-*+]|\d+\.) ', line):
        lines[-1] += ' ' + line.strip()
    else:
        lines.append(line)
print('\n'.join(lines))
EOF
)"
[ -n "$CHANGES" ] || { echo "release-notes: CHANGELOG.md says nothing under $VERSION" >&2; exit 1; }

# How the app in the zip is signed, for the caution below.
OPENED="$(mktemp -d)"
trap 'rm -rf "$OPENED"' EXIT
ditto -x -k "$ZIP" "$OPENED"
if codesign -dvv "$OPENED/Write_On.app" 2>&1 | grep -q '^Authority=Write_On Local Signing'; then
  SIGNATURE="The project signs it with its own certificate, not one from Apple, and Apple did not notarize it."
else
  SIGNATURE="It has an ad hoc signature, and Apple did not notarize it."
fi
SIZE="$(stat -f %z "$ZIP" | awk '{ printf "%.1f MB", $1 / 1000000 }')"
SUM="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"

cat <<EOF
This app is an unofficial Mac replica of Write_On. Jason Fried shows his Write_On in [a post on X](https://x.com/jasonfried/status/2105403067793584590). This replica is not his, and he did not help to make it. When he releases his own app, the README will link to it. Use his app then.

## What changed

$CHANGES

## The download

\`$(basename "$ZIP")\` contains the app that \`scripts/package.sh\` builds at this tag. The app runs on Apple silicon and Intel Macs with macOS 13 or later. The zip is $SIZE.

The [release workflow]($REPO/blob/main/.github/workflows/release.yml) built the app on a Mac at GitHub. Before it published the zip, it ran the unit tests. Then it ran the app from the zip.

**Caution: macOS refuses to open the app the first time, and can say that the app is damaged.** The app is not damaged. $SIGNATURE To open the app:

1. Unzip the zip.
2. Drag Write_On to Applications.
3. Remove the quarantine mark that the download added:

   \`\`\`sh
   xattr -dr com.apple.quarantine /Applications/Write_On.app
   \`\`\`

You can also build the app yourself. This is the safer way. The README's [Build and run]($REPO#build-and-run) section gives the two commands.

SHA-256 of the zip: \`$SUM\`

The version numbers follow Semantic Versioning. The README's [Versions]($REPO#versions) section tells what each number means. [CHANGELOG.md]($REPO/blob/main/CHANGELOG.md) tells what each release changed.
EOF
