#!/bin/bash
# Look for a key, a token or a password in the repository: in the files as they stand, in
# every commit and in every commit message. Run it before pushing.
#   scripts/check-secrets.sh
# It looks for two things:
#   1. anything shaped like a secret: a private key, a token with one of the well-known
#      services' beginnings, a Bearer header with a token after it, something long and
#      mixed given to a name like api_key, secret, token or password;
#   2. the secrets of whoever runs it: the value of every variable in this shell's
#      environment whose name says it holds a key, a token, a secret or a password. They
#      are compared by value and never printed.
# That is a net, not a proof. A key with a beginning of its own, on a line with no name
# beside it, is caught only by the second way, and so only when the person running this
# holds that key. A key kept only in the keychain is not looked for: this does not read
# the keychain.
# It reads every object git holds, so a commit that is on no branch is looked through as
# well, and every file in the working copy that git does not ignore. What it finds it
# names by place, never by content. Exit status: 0 nothing found, 1 something found,
# 2 the looking itself did not work.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"
exec python3 -I - "$ROOT" <<'PY'
import os
import re
import subprocess
import sys
import traceback

def shapes():
    """What a secret looks like: (what it is, a pattern for it, made-up examples of it).

    The examples are put together here from pieces, so that nothing in this file, or in
    any other, is itself shaped like a secret.
    """
    mixed = "A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6"
    start = r"(?<![A-Za-z0-9])"
    return [
        ("a private key", rb"-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----", ["-----BEGIN " + "RSA PRIVATE KEY-----", "-----BEGIN " + "PGP PRIVATE KEY BLOCK-----"]),
        ("a key that begins sk-", (start + r"sk-(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}").encode(), ["sk" + "-proj-" + mixed]),
        ("a GitHub token", (start + r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})").encode(), ["gh" + "p_" + mixed + "S7t8"]),
        ("an AWS access key", rb"(?<![A-Z0-9])A[KS]IA[0-9A-Z]{16}(?![0-9A-Z])", ["AK" + "IA" + "ABCDEFGH12345678"]),
        ("a Google API key", (start + r"AIza[0-9A-Za-z_-]{35}").encode(), ["AI" + "za" + mixed + "S7t"]),
        ("a Slack token", (start + r"xox[baprs]-[A-Za-z0-9-]{10,}").encode(), ["xo" + "xb-" + "1234567890-abcdefghij"]),
        (
            "a token with a well-known beginning",
            (start + r"(?:gsk_|hf_|xai-|glpat-|npm_|[sr]k_(?:live|test)_)(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}").encode(),
            ["gs" + "k_" + mixed, "h" + "f_" + mixed, "xa" + "i-" + mixed, "glp" + "at-" + mixed, "np" + "m_" + mixed, "sk_" + "live_" + mixed],
        ),
        ("a signed web token", rb"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", ["ey" + "JhbGciOiJIUzI1NiJ9." + "ey" + "JzdWIiOiIxMjM0NTY3ODkwIn0." + "c2lnbmF0dXJlLWhlcmU"]),
        ("a Bearer header with a token after it", rb"(?i)Bearer\s+(?=[A-Za-z0-9._~+/-]*[0-9])[A-Za-z0-9._~+/-]{24,}", ["Bearer " + mixed, "authorization: bearer " + mixed]),
        (
            # Quoted or not: `export NAME=value`, a line of a .env file or of YAML, a header.
            "something long and mixed given to a name like a key's",
            rb"(?i)(?:api[_-]?key|secret(?:[_-][a-z]+)*|(?:access|private|auth|signing)[_-]?key|token|passw(?:or)?d)[\"']?\s*[:=]\s*[\"']?(?=[A-Za-z0-9._~+/=-]*[0-9])(?=[A-Za-z0-9._~+/=-]*[A-Za-z])[A-Za-z0-9._~+/=-]{24,}",
            ["api_" + "key = '" + mixed + "'", "export SERVICE_API_" + "KEY=" + mixed, "secret_access_" + "key: " + mixed, "x-api-" + "key: " + mixed, "PASS" + "WORD=" + mixed],
        ),
    ]

def own_secrets():
    """The secrets of whoever runs this, by the names their shell gives them."""
    named = re.compile(r"(?i)key|token|secret|passw|credential")
    found = {}
    for name, value in os.environ.items():
        value = value.strip()
        # Shorter than this and a value would turn up in ordinary text by chance. And the
        # keys the tests' stand-in gateway knows are in the tests, and are no secret.
        if named.search(name) and len(value) >= 12 and not value.startswith("fake-key-"):
            found[name] = value.encode()
    return found

def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout

def broken(why):
    print(f"check-secrets: BROKEN, {why}", file=sys.stderr)
    sys.exit(2)

def objects():
    """Every object git holds, reachable or not: (hash, kind, content)."""
    out = git("cat-file", "--batch-all-objects", "--batch")
    at = 0
    while at < len(out):
        end = out.index(b"\n", at)
        sha, kind, size = out[at:end].decode().split()
        start = end + 1
        yield sha, kind, out[start : start + int(size)]
        at = start + int(size) + 1

def where_from():
    """For every file's content git holds: a path it has had."""
    paths = {}
    for line in git("rev-list", "--all", "--objects").decode(errors="replace").splitlines():
        sha, _, path = line.partition(" ")
        if path:
            paths.setdefault(sha, path)
    return paths

def readable(content):
    """The content as text to look through, or None for a picture, a font and the like."""
    if content[:2] in (b"\xff\xfe", b"\xfe\xff"):
        # Text in two bytes to the letter, as some editors on other systems save it.
        return content.decode("utf-16", errors="replace").encode()
    return None if b"\0" in content[:8000] else content

def look(content, patterns, values):
    """What is in `content`: [(what it is, line number)]. Never the thing itself."""
    found = []
    text = readable(content)
    if text is not None:
        for what, pattern in patterns:
            for match in pattern.finditer(text):
                found.append((what, text.count(b"\n", 0, match.start()) + 1))
    # Nobody types a key into a picture, but its bytes are still compared.
    within = content if text is None else text
    for name, value in values.items():
        at = within.find(value)
        if at >= 0:
            found.append((f"the value of {name}", within.count(b"\n", 0, at) + 1))
    return found

def main(root):
    inside = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True)
    if inside.returncode != 0:
        broken("this folder is not a git repository, so there is no history to look through")
    if os.path.realpath(os.fsdecode(inside.stdout.rstrip(b"\n"))) != os.path.realpath(root):
        broken("this folder is inside another project's repository, and has none of its own")

    known = shapes()
    patterns = [(what, re.compile(pattern)) for what, pattern, _ in known]
    values = own_secrets()

    # The looking has to be seen to work before a clean answer from it means anything.
    for what, _, examples in known:
        for example in examples:
            if look(b"one line\n" + example.encode() + b"\n", patterns, {}) != [(what, 2)]:
                broken(f"it does not find its own example of {what}, and only that")
    if look(b"nothing of the kind here\n", patterns, {"A_KEY": b"a-value-that-is-not-there"}):
        broken("it finds what is not there")
    if look(b"first\nsecond has a-value-that-is-there in it\n", [], {"A_KEY": b"a-value-that-is-there"}) != [("the value of A_KEY", 2)]:
        broken("it does not find a value it was given")
    if look(("one line\n" + known[-1][2][0] + "\n").encode("utf-16"), patterns, {}) != [(known[-1][0], 2)]:
        broken("it does not read text saved two bytes to the letter")

    findings = []
    paths = where_from()
    counted = {"commit": 0, "blob": 0}
    for sha, kind, content in objects():
        counted[kind] = counted.get(kind, 0) + 1
        for what, line in look(content, patterns, values):
            if kind == "blob":
                place = f"{paths.get(sha, 'a file no commit has any more')}:{line} (content {sha[:10]})"
            elif kind == "commit":
                place = f"commit {sha[:10]}, in its message or its signature"
            else:
                place = f"{kind} {sha[:10]}"
            findings.append((what, place))

    # The working copy: what is tracked as it now stands, and what `git add` would pick up.
    files = [name for name in git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split(b"\0") if name]
    read = 0
    for name in files:
        try:
            with open(name, "rb") as handle:
                content = handle.read()
        except OSError:
            continue  # deleted but not yet committed, or a link that leads nowhere
        read += 1
        for what, line in look(content, patterns, values):
            findings.append((what, f"{os.fsdecode(name)}:{line} (working copy)"))

    print(f"check-secrets: looked through {counted['commit']} commits and {counted['blob']} versions of files, and {read} files in the working copy")
    if values:
        print(f"check-secrets: compared with the values of {len(values)} of this shell's variables ({', '.join(sorted(values))}), none of them printed")
    else:
        print("check-secrets: this shell has no variable named like a secret, so only shapes were looked for")
    if findings:
        seen = []
        for finding in findings:
            if finding not in seen:
                seen.append(finding)
                print(f"  ✖ {finding[0]}: {finding[1]}")
        print(f"check-secrets: FOUND {len(seen)}. If one is real, taking it out of the files is not enough: it is in the history, and the key itself has to be changed.")
        sys.exit(1)
    print("check-secrets: nothing found")

try:
    main(sys.argv[1])
except SystemExit:
    raise
except BaseException:  # git failing, a file that cannot be read: not the same as finding something
    traceback.print_exc()
    broken("it stopped before it had finished")
PY
