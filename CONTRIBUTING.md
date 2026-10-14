# Contributing

Thank you for looking. This is a small project with one maintainer, so the most useful
things are a clear bug report and a small change that comes with its test.

## What the project is for

The aim is the tool in Jason Fried's clips, as closely as they allow: the design spec's
first section says so, and lists what is left out on purpose. Two kinds of change fit
without argument:

- one that brings the app closer to what the clips show;
- one that mends something broken.

What the clips do not show had to be decided, and those decisions are §9 of the
[spec](docs/superpowers/specs/2026-10-11-write-on-replica-design.md), one to a row so
that each can be challenged. If you think one is wrong, say which and why. A feature the
original does not have is a harder case: open an issue before you build it.

When he releases his own Write_On, the README will link to it, and that is the place for
ideas about the tool itself.

## Reporting a bug

Open an issue, and say:

- the version of macOS, whether the Mac is Apple silicon or Intel, the app's version
  (Write_On ▸ About Write_On) and the commit you built;
- what you did, step by step, and what happened in place of what you expected;
- for anything to do with a file, a small `.md` file that shows it;
- for a difference from the original, which clip and how far into it.

A problem that should not be public goes by [SECURITY.md](SECURITY.md) instead.

## Building and testing

You need macOS 13 or later, the Xcode Command Line Tools (Swift 5.9 or later) and, for the
tests, Node (22 or later should do). Nothing is installed from npm. The README's
[Build and run](README.md#build-and-run) says which versions it has actually been built
and run with.

```sh
npm test                    # unit tests for the document logic, in milliseconds
scripts/build-app.sh        # builds build/Write_On.app
scripts/check.sh            # everything: unit tests, a look for keys, a build, every UI scenario
scripts/ui-test.sh panel    # one scenario from tests/ui
```

`scripts/check.sh` takes about four minutes and has to end with `check: all green`.

The UI scenarios run the built app with nothing on screen. A run is never the active app,
its window is outside every display, and it leaves your keyboard, pointer, clipboard,
keychain and saved settings alone, so you can go on working while they run. They do need
someone logged in at the Mac. The README's
[Working on it](README.md#working-on-it) explains how a scenario is written.

If the app is open while you work, build and test a second copy and leave that one be:

```sh
WRITEON_APP=build/dev/Write_On.app scripts/check.sh
```

The app is built for Apple silicon and for Intel, as one universal app, and a run uses
the half that suits the Mac it is on. If you change `Sources/WriteOn`, it is worth running
the scenarios on the other half as well. On an Apple silicon Mac with Rosetta installed:

```sh
WRITEON_ARCH=x86_64 scripts/check.sh
```

## Making a change

1. **Write the test first, and watch it fail.** What decides what a document is lives in
   `web/src/doc` and `web/src/ai` and is tested in `tests/unit`. Anything that needs the
   page or the Mac is tested by a scenario in `tests/ui`.
2. **Make it pass** with the smallest change that does.
3. **Keep the documents in step.** The spec describes the app as it is. A change in
   behaviour changes the spec; a decision the clips do not settle goes in its §9; what a
   person using the app would notice goes in the README.
4. **Run `scripts/check.sh`.**

The page is plain ES modules with no build step, and neither the page nor the shell uses
a package or a library. Please keep it that way. Write code that reads like the code
around it, and comments that say why, not what.

Some things can only be checked by a person at the Mac. If your change touches one of
the items under [What a person has to check](README.md#what-a-person-has-to-check), try
it by hand and say so.

## The AI, and keys

No test needs a key or a network. Most scenarios are given a scripted provider, and the
client itself is tested against a stand-in gateway on your own Mac. Unless a run is a
live one, it is given nothing of what your shell says about the AI service, and its
client refuses every address that is not on your Mac.

One scenario asks a real service, with your key, and only when told to. The app speaks to
a service in one of two ways, and each is a run:

```sh
scripts/ui-test.sh ai-live --ai live
WRITEON_API_FORMAT=anthropic scripts/ui-test.sh ai-live --ai live
```

They are worth running if you change `Sources/WriteOn/AIClient.swift`, `AIWire.swift` or
the prompts in `web/src/ai`, and it is worth saying which service and model you ran them
against: so far the app has met only one of each (see [The AI](README.md#the-ai)).

**Never commit a key.** Keys belong in Settings, which keeps them in your keychain, or in
your shell's environment. `scripts/check.sh` looks for one, and you can ask on its own:

```sh
scripts/check-secrets.sh
```

It looks through every commit, every commit message and the working copy for anything
shaped like a key, and for the secrets in your own shell's environment by their values,
without printing them. It is a net, not a proof: a key with a beginning it does not
know, on a line with no name beside it, is caught only if it is yours. If it finds a
real one, taking it out of the file is not enough: it is in the history, and the key
itself has to be changed.

## What must stay out

- Jason Fried's clips, frames from them, and the essay he writes in them. The
  measurements were taken in a folder git ignores (`reference/`), and it stays ignored.
- Keys, tokens and passwords, in files or in commit messages.
- Packages and build output.

## Sending the change

Open a pull request against `main`. Say what it changes and why, how you tested it, and
anything you could not test. Small pull requests are read sooner.

Leave the app's version as it is: it changes when a release is made. If your change would
call for a new major or minor version by the README's [rules](README.md#versions), say
so.

By contributing you agree that your contribution is under the project's
[MIT licence](LICENSE), and that it is yours to give.

Everyone taking part is asked to keep to the [code of conduct](CODE_OF_CONDUCT.md).
