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
SIZE="$(stat -f %z "$ZIP" | awk '{ printf "%.1f MB", $1 / 1000000 }')"
SUM="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"

cat <<EOF
An unofficial Mac replica of Write_On, the writing tool Jason Fried shows in [his post on X](https://x.com/jasonfried/status/2105403067793584590). It is not his, and he had no part in it. When he releases his own, the README will link to it, and that is the one to use.

## What changed

$CHANGES

## The download

\`$(basename "$ZIP")\` is the app as \`scripts/package.sh\` builds it at this tag: universal (Apple silicon and Intel), for macOS 13 or later, $SIZE. It was built on GitHub's own Mac by the [release workflow]($REPO/blob/main/.github/workflows/release.yml), which ran the unit tests first and then the app itself, as it is in the zip, before publishing it.

**macOS will refuse to open it the first time, and may call it damaged.** It is not: it is signed ad hoc and not notarized. Unzip it, drag Write_On to Applications, then take off the mark the download put on it:

\`\`\`sh
xattr -dr com.apple.quarantine /Applications/Write_On.app
\`\`\`

Or build it yourself, which is the surer way: two commands, in the README's [Build and run]($REPO#build-and-run).

SHA-256 of the zip: \`$SUM\`

Versions follow Semantic Versioning. The README's [Versions]($REPO#versions) says what each number promises, and [CHANGELOG.md]($REPO/blob/main/CHANGELOG.md) what each release changed.
EOF
