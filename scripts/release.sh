#!/bin/bash
# Make a release of what is on main: the next version, written down, tagged and pushed.
# Pushing the tag is what makes the release: GitHub builds the app from the tagged commit,
# tests it and publishes it (.github/workflows/release.yml).
#   scripts/release.sh patch|minor|major
# Which number goes up is for the README's "Versions" to say. What the release brings is
# what CHANGELOG.md has under "Unreleased", which becomes the new version's. Only what is
# already on GitHub's main, and tested, is released: the working copy must have no changes
# and be neither ahead of origin/main nor behind it.
# The commit and the tag are signed with git's user.name and user.email, or, where this
# repository has none, with GIT_COMMITTER_NAME and GIT_COMMITTER_EMAIL. TRAILER, if set,
# ends the commit's message (a Co-Authored-By line, say).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PLIST=packaging/Info.plist
fail() {
  echo "release: $1" >&2
  exit 1
}

LEVEL="${1:-}"
case "$LEVEL" in
  patch | minor | major) ;;
  *) fail "say which number goes up: patch, minor or major (README, Versions)" ;;
esac
if [ -z "$(git config user.email || true)" ]; then
  [ -n "${GIT_COMMITTER_NAME:-}" ] && [ -n "${GIT_COMMITTER_EMAIL:-}" ] || fail "git has no name to sign the commit and the tag with: set user.name and user.email, or GIT_COMMITTER_NAME and GIT_COMMITTER_EMAIL"
  export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-$GIT_COMMITTER_NAME}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-$GIT_COMMITTER_EMAIL}"
fi
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || fail "a release is made from main"
[ -z "$(git status --porcelain)" ] || fail "commit what has changed, or put it aside, first (git status)"
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "main here is not main on GitHub: push or pull first, so that what is released is what was tested and is there"

NOW="$(plutil -extract CFBundleShortVersionString raw -o - "$PLIST")"
BUILD="$(plutil -extract CFBundleVersion raw -o - "$PLIST")"
git rev-parse -q --verify "refs/tags/v$NOW" >/dev/null || fail "v$NOW, the version in $PLIST, has no tag: it was never released"
[ -n "$(git log --oneline "v$NOW..HEAD")" ] || fail "nothing has changed since v$NOW"
IFS=. read -r MAJOR MINOR PATCH <<<"$NOW"
case "$LEVEL" in
  major) NEXT="$((MAJOR + 1)).0.0" ;;
  minor) NEXT="$MAJOR.$((MINOR + 1)).0" ;;
  patch) NEXT="$MAJOR.$MINOR.$((PATCH + 1))" ;;
esac
! git rev-parse -q --verify "refs/tags/v$NEXT" >/dev/null || fail "v$NEXT is tagged already"

# The two numbers in Info.plist, and what is under "Unreleased" made the new version's.
python3 -I - "$PLIST" CHANGELOG.md "$NEXT" "$((BUILD + 1))" "$(date +%Y-%m-%d)" <<'EOF'
import re, sys
plist, changelog, version, build, day = sys.argv[1:]
text = open(plist).read()
for key, value in (('CFBundleShortVersionString', version), ('CFBundleVersion', build)):
    text, count = re.subn(r'(<key>%s</key>\s*<string>)[^<]*(</string>)' % key, r'\g<1>%s\g<2>' % value, text)
    if count != 1:
        sys.exit(f'release: {key} is not in {plist} once')
log = open(changelog).read()
found = re.search(r'^## Unreleased\n(.*?)(?=^## |\Z)', log, re.S | re.M)
if not found or not found.group(1).strip():
    sys.exit('release: CHANGELOG.md has nothing under "## Unreleased" to say what the release brings')
log = f'{log[:found.start()]}## Unreleased\n\n## {version} ({day})\n\n{found.group(1).strip()}\n\n{log[found.end():]}'
open(plist, 'w').write(text)
open(changelog, 'w').write(log)
EOF

MESSAGE=(-m "Version $NEXT")
[ -z "${TRAILER:-}" ] || MESSAGE+=(-m "$TRAILER")
git add "$PLIST" CHANGELOG.md
git commit -q "${MESSAGE[@]}"
git tag -a "v$NEXT" -m "Write_On $NEXT"
git push -q --atomic origin main "v$NEXT"
REPO="$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
echo "release: v$NEXT is on GitHub, which builds, tests and publishes it: https://github.com/$REPO/actions"
