# Write_On for macOS, an unofficial replica

Inspired by [Jason Fried's post on X](https://x.com/jasonfried/status/2105403067793584590),
where he shows Write_On, a writing tool he built for himself. This is a Mac app made to
look and behave like the one in his three clips.

> **The original is Jason Fried's, and it is not out yet.** In the first clip he says he
> hopes to release it, open source and free. As of October 2026 he has not. When he does,
> I'll link to it here, and that is the one to use.

It keeps the other ways you tried to say something: alternatives for a word, a sentence or
a whole paragraph stay in place, under the text, and you flip through them where they
stand. Around that: ghosted text, an Overflow panel, AI suggestions, a Lab that marks and
trims without rewriting, and one plain Markdown file that holds all of it.

![The welcome piece with the tools on, and the pointer resting on a word that has alternatives](docs/images/tools.png)

**This is not his Write_On.** The idea, the design and the name are Jason Fried's. He had
no part in this project and has not endorsed it. No code, recording or picture of his is
in this repository, and the essay he writes in the clips is not here either. What it takes
from him is what the three clips in the post's thread show: how the tool looks, moves,
sounds and saves, and the wording of its labels.

The look, motion, sound and file format were measured from those clips. What the clips do
not show had to be decided; those decisions are listed
[below](#decisions-the-clips-do-not-settle).

- Design: `docs/superpowers/specs/2026-10-11-write-on-replica-design.md`
- Plan it was built from: `docs/superpowers/plans/2026-10-11-write-on-replica.md`
- How it is built, with diagrams: `docs/architecture.html` (open it in a browser)

The app was written by Claude, in Claude Code, working from that design and that plan
([what that cost](#what-it-cost-to-build)).

## Build and run

Build it yourself, which is the surer way, or download a built copy (below).

- macOS 13 or later is what the app is built for. It has been built and run on macOS 26
  only.
- Either kind of Mac. The app is universal: one executable with a half for Apple silicon
  and a half for Intel. It has been built and run on Apple silicon only. Every UI scenario
  passes on the Intel half too, but under Rosetta: no Intel Mac has run it.
- To build it: the Xcode Command Line Tools (`xcode-select --install`), with Swift 5.9 or
  later (it has been built with 6.3 only). Xcode itself is not needed.
- For the tests only: Node. They have been run with Node 26; 22 or later should do, since
  the test command leaves its `*.test.js` pattern to Node. Nothing is installed from npm.

```sh
scripts/build-app.sh        # builds build/Write_On.app
open build/Write_On.app     # or double-click it in Finder; drag it to Applications to keep it
```

The first build takes about a minute, since the app is built twice, once for each kind of
Mac; after that only what changed is built again.

**A built copy** is attached to each
[release](https://github.com/joeysim/write-on-replica/releases) as
`Write_On-<version>.zip`: unzip it and drag Write_On to Applications. macOS will refuse to
open it the first time, and may call it damaged. It is not: it is signed ad hoc, by the
Mac that built it, and not notarized, as Apple asks of anything passed from one Mac to
another. Take off the mark the download put on it, and it opens:

```sh
xattr -dr com.apple.quarantine /Applications/Write_On.app
```

System Settings ▸ Privacy & Security may offer to open it anyway as well. Nobody has yet
opened a downloaded copy on another Mac (see
[What a person has to check](#what-a-person-has-to-check)).

The first window shows a short welcome piece. The app opens as a bare editor, text and a
word count: **click the word count** (top left) to turn the tools on, and again to turn them
off. Every window after the first starts blank; Help ▸ The Welcome Piece brings it back.

## Using it

| Shortcut | What it does |
| --- | --- |
| Ctrl+Shift+R, or click the word count | Read mode: just the text |
| Ctrl+Shift+A | Alternatives for the selection, or the word at the caret; with the caret on no word, the word under the pointer |
| Ctrl+Shift+G | AI alternatives, for the same |
| Ctrl+/ | Ghost it, or revive it |
| Ctrl+Shift+X | Stash the selection (or the paragraph) in Overflow |
| Ctrl+Shift+D | Overflow panel |
| Ctrl+Return, in Overflow | Use the selection in the page |
| Ctrl+U, or the M↓ icon | The piece as Markdown, to copy; and the file as saved |
| Ctrl+S, Ctrl+O | Save, Open |
| Ctrl+Shift+P | Post to X |
| ⌘N, ⌘O, ⌘S, ⇧⌘S, ⌘W, ⌘Z, ⇧⌘Z, ⌘, | New, Open, Save, Save As, Close, Undo, Redo, Settings |

As in the original, the app's own shortcuts use Control, on the Mac too. Everything is also
in the menu bar, and a right-click on the text gives Alternatives, AI alternatives, Ghost
and Stash.

- **Under the pointer.** Rest the pointer on anything underlined and press the arrow keys to
  flip through its versions; Delete removes the one showing (and blows it up). Each change
  ticks, and the tick is lower when you land back on the version you started from.
- **The panel.** Alternatives opens a panel on the left with a row for each version. Type a
  new one in the empty row; type `??` there to have the AI suggest some. A robot marks the
  ones it wrote. ([Picture](docs/images/panel.png).)
- **The Lab** (bottom center) reads the page and marks what it finds: weak or long
  sentences, filler, typos, or what could go to make the piece 10, 20, 30 or 50 percent
  shorter. It fades and underlines; it never rewrites. Nothing is cut until you say so.
  A trim is read once, and all four levels are then there at once: the AI says what each
  sentence could lose and how much the piece needs it, and the app does the counting.
- **Edit ▸ Spelling and Grammar, Substitutions.** Spell checking, autocorrection and smart
  quotes are all off until you turn them on there, whatever the system's settings say.

### The file

One Markdown file. Any other tool sees ordinary Markdown, as the piece currently reads.
Overflow follows a `<!-- overflow -->` line, and the alternatives, with which one is
showing and what is ghosted, are in a `<!-- write_on {…} -->` comment at the end. A piece
with no alternatives and nothing ghosted is saved as plain Markdown with no comment at all.
A file edited elsewhere opens with its text as it now is, and keeps the alternatives whose
words are still there.

To take the piece somewhere else, press Ctrl+U or click the M↓ icon. The card opens on
**Markdown**: the piece as it reads now, with the version of each thing that is showing,
nothing ghosted, nothing from Overflow and no comment, and a Copy button. The other two
tabs, As saved and Readable, show the file itself.

The format follows what the third clip shows of the original's, down to the `write_on`
comment. That is 52 seconds of one file: whether his tool would open a file saved here,
or this one a file of his, has never been tried.

Saving replaces the file's text and nothing else (its permissions and Finder tags stay,
and a link stays a link). If something else has changed the file since the window read or
wrote it, saving asks before writing over it.

Unsaved work is copied to `~/Library/Application Support/Write_On/Drafts` every few seconds
and comes back as an unsaved document if the app is ever killed.

### The AI

AI alternatives and the Lab ask a language model. Everything else works without one.

The app can speak to a service in either of two ways: OpenAI's chat completions
(`POST …/chat/completions`), which most services and gateways speak, or Anthropic's
messages (`POST …/v1/messages`). Either way the answer is streamed. So it can ask any
service, or any server on your own Mac, that speaks one of them. Out of the box it asks
LunaRoute (`https://gw.lunaroute.com/v1`) for `glm-5.3-flash`, OpenAI's way.
**Settings (⌘,) is where you point it somewhere else:**

- **API key.** Paste it and it is saved in your keychain, and nowhere else.
- **Address.** The service's base address: `https://api.openai.com/v1`, say, or
  `https://api.anthropic.com`, or `https://openrouter.ai/api/v1`, or
  `http://localhost:11434/v1` for a model served locally. The whole address of where
  its requests go will do as well.
- **Format.** Which of the two ways the service is spoken to. Left on Automatic it goes
  by `WRITEON_API_FORMAT` if your environment sets that, and otherwise by the address:
  Anthropic's way for Anthropic's own service and for an address that ends `/messages`,
  OpenAI's for anything else. A gateway that speaks both, as LunaRoute does, is spoken to
  OpenAI's way unless you choose the other here.
- **Model.** The name the service knows the model by.
- **Test connection** tries them together and says how it went: that the model
  answered, how long it took, and which key went with the question.

Left empty, Address and Model show what is in force, and Automatic says which way it
comes to.

All four can come from the environment as well: `WRITEON_API_KEY`, `WRITEON_BASE_URL`,
`WRITEON_API_FORMAT` (`openai` or `anthropic`) and `WRITEON_MODEL`. (`LUNAROUTE_API_KEY`
and `LUNAROUTE_BASE_URL`, the names the first two had to begin with, are still read.)
The app looks for each in this order:

1. Settings: the key saved in your keychain, and the Address, Format and Model there;
2. the app's own environment;
3. your login shell, so that what `~/.zshrc` sets is found when the app is opened from
   Finder. For this the app runs your login shell once, as a terminal would start it, the
   first time it has to look further than Settings and its own environment, and reads
   those six variables from it.

**Which key goes where.** The key the app finds is sent to the address in force, as a
bearer token OpenAI's way and in the `x-api-key` header Anthropic's, with one exception:
a key under LunaRoute's name (`LUNAROUTE_API_KEY`) is LunaRoute's, and no other service
is sent it. So a service you name needs a key of its own, pasted in Settings or set as
`WRITEON_API_KEY`. A key saved in Settings goes with whatever address is there, so
change the two together. A server that wants no key, as a model on your own Mac usually
does not, is asked without one. Only LunaRoute's own address is never asked without a key.

Plain `http` is for this Mac and its own network (a name ending `.local` or with no dot in
it, a private address). For anywhere else the app refuses it, as macOS does, so a key does
not cross the internet in the clear. And a request goes where you said and no further: if
a service answers that it has moved, the app does not follow.

The key never reaches the editor's page: the native side of the app makes the request and
hands back text.

**What a service has to take.** Spoken to OpenAI's way:

- The key as a bearer token (`Authorization: Bearer …`).
- `max_tokens` and `reasoning_effort` on every request. A service that refuses one of them
  is asked again in its own way: with `max_completion_tokens`, which OpenAI's models that
  reason want, or without `reasoning_effort`, which models that do not reason refuse.
- From the Lab, a JSON schema that the answer has to fit (`response_format`). There is no
  way round this one: spoken to this way, the Lab needs a model that can keep to a schema.
  AI alternatives need only text.

Spoken to Anthropic's way:

- The key in the `x-api-key` header, and `anthropic-version: 2023-06-01`.
- `max_tokens` on every request, the system prompt apart from the messages, and in
  `output_config` the effort and, from the Lab, the JSON schema. A service that refuses
  the effort or the schema, or has not heard of `output_config`, is asked again without.
- The Lab asks for the shape of its answer in words as well, so a model that is not held
  to the schema can still give it.

Either way:

- Which parts of a request a service turns out not to take is remembered, for that
  address and model, until the app is quit or that way of asking stops working.
- Room. A trim's answer is every sentence of the piece over again, and a model that
  reasons may think first, so a trim asks for room for both: eight to fourteen tokens for
  every word of the piece, by the length of its words and sentences, and 2,400 besides,
  up to 32,000. That is more than 8,192 from somewhere between 500 and 750 words and more
  than 16,384 from between 1,200 and 1,700, and a model that may not write so much will
  refuse a longer piece. If a model's thinking uses its room up
  before it has said a word, the app asks again with twice as much, twice at most, for
  that request only.
- An answer that begins within a minute and never falls silent for longer. The app gives
  up on one that does. A model that thinks in silence for longer than that, or a server
  still loading its model, may be given up on.

**How far this has been tried.** For real, with LunaRoute and `glm-5.3-flash` only, in
both ways: LunaRoute speaks both. **Anthropic's own service has not been asked.** The
Anthropic way was written to Anthropic's documentation and is tested against a stand-in
on this Mac (`tests/ui/ai-anthropic.js`) that sends what the documentation says the
service sends, and refuses a request with no version, no `max_tokens` or a system message
among the messages, as it says the service does. How the real service words its refusal
of an effort or a schema nobody here has seen, and the asking again goes by the names of
those fields. It was also tried against LunaRoute's endpoint, which is not the same
thing: LunaRoute takes no notice of where Anthropic puts the effort and the schema. So
to LunaRoute, and only to LunaRoute, the app gives the effort under OpenAI's name as
well; without that the model thinks at its full length. Everything about
other services OpenAI's way is likewise tested against the stand-in
(`tests/ui/ai-gateway.js`), and not yet against the services themselves.
[The live scenario](#ui-scenarios) will try one of yours.

**What leaves your Mac.** Nothing, until you ask the AI for something. A request for
alternatives carries the paragraph the word is in and the versions you already have. The
Lab sends the page's paragraphs, without the headings and without what is ghosted. A trim
sends them once, whichever level you choose and however many you then look at, until the
piece changes; an answer that leaves most of the piece out is asked for once more. All of
it goes to the address in force, with the key in force, and nowhere else,
and Overflow is never sent. There is no telemetry and nothing checks for updates. The
only other thing that goes anywhere is Post to X, which opens X's compose page in your
browser with the piece in the link.

Alternatives come back in a second or two. **A trim takes longer with `glm-5.3-flash`:**
4 to 26 seconds for the 170-word welcome piece (mostly under 11) and 8 to 25 for a
500-word draft, in either way of speaking, and 40 to 50 for 1,600 words, where the
original takes a second or two. Where sentences have words to lose, the first cuts fade about two seconds in, and
once the answer is in, every level is immediate. Now and then the model thinks before it
answers, and the 500-word draft takes a minute. Each level comes to within a point or two
of what it says: 10, 20, 30 and 50% of that draft. (The lighter levels never take a
sentence the model says the piece does not work without, so where it says that of most of
them one can fall short; the card says what it came to.) The measurements, and the first
way trims were asked, which took minutes and missed, are in the spec, §6.10 and §7.1.

## What a person has to check

Everything else is tested by script with nothing on screen (see [Working on it](#working-on-it)).
These need someone at the Mac:

1. **It opens.** Double-click `build/Write_On.app`: one window, the welcome piece, the app
   in front. Click the Dock icon with no window open: one new blank window.
2. **Real hover.** With the tools on, the icons light and show their shortcuts under the
   pointer. Rest the pointer on an underlined word and press the arrow keys: the word flips
   through its versions, with the ticks. Click the word first and they still do.
3. **The pointer and typing.** Type with the pointer resting on an underlined word: its
   tint goes and the arrow keys move the caret, not the word. Move the pointer and the
   tint is back and they flip it again.
4. **Shortcuts once.** Ctrl+Shift+R turns the tools off, and again on: once per press, not
   twice. (Each Control shortcut is also a menu item; the page is meant to get the key
   first.) The same for Ctrl+Shift+D and Ctrl+U.
5. **Drag from Overflow.** Open Overflow, select some of its text and drag it into the page.
6. **The LinkedIn button.** Chase it with the pointer. It should bolt six times and blow up
   on the seventh approach.
7. **How it sounds.** The two ticks, the boom, and the sound of undoing a delete. Settings ▸
   Play sounds turns them off in every window.
8. **Panels.** ⌘S on a new document drops a save panel from the window, offering the
   heading as the name. ⌘O, Open Recent. Close with unsaved changes: Save, Cancel, Don't Save.
   Quit with two unsaved windows: asked about each in turn. Change an open file in another
   editor and then save it here: asked before it is written over.
9. **From Finder.** Right-click a `.md` file ▸ Open With ▸ Write_On.
10. **After a crash.** Type something, wait five seconds, `killall -9 WriteOn`, open the app
    again: the work is back, unsaved, with a note by the Save icon.
11. **Settings.** Paste a key: the line under the field says "Using the key saved here."
    Test connection answers in about a second. (After rebuilding the app, macOS may ask
    once for permission to read the saved key, because a locally built app is signed anew
    each time.)
12. **Edit menu.** Check Spelling While Typing puts the red marks under a misspelled word, and
    Smart Quotes curls the quotes; both are off to begin with.
13. **Full screen** (the green button, or fn F): the layout then matches the clips exactly,
    with no title bar above the page.
14. **Post to X** (the X icon): the browser opens X's compose window with the piece in it.
15. **About.** Write_On ▸ About Write_On: the version as three numbers, with the build in
    brackets after it (see [Versions](#versions)), and under them a line saying that this
    is an unofficial replica, inspired by Jason Fried's.
16. **Another AI service.** In Settings give the address, the model and the key of a
    service other than LunaRoute, and press Test connection. Then ask for alternatives
    (Ctrl+Shift+G) and run a pass from the Lab. Nobody has yet, OpenAI's way or
    Anthropic's (see [The AI](#the-ai)).
17. **An Intel Mac.** Build the app on one, or take a copy to one, and go through this
    list. Nobody has yet: the Intel half has run only under Rosetta (see
    [Build and run](#build-and-run)).
18. **A downloaded copy.** Download the zip from a release, unzip it and open the app.
    macOS should refuse it once, and open it after the command in
    [Build and run](#build-and-run). Then open a `.md` file with File ▸ Open: it should
    not be grayed out. On the first other Mac it was tried on, every one was, until
    that was mended.

## Decisions the clips do not settle

The full list, 54 items with the reasoning, is §9 of the spec. In short:

**Alternatives.** Groups do not nest: making a larger group over smaller ones turns the
smaller ones back into text (undo restores them). A selection's scope follows what it
covers: a whole paragraph of several sentences is a paragraph group, one or more whole
sentences a sentence group, anything else a word group. Under the pointer → and ↓ go
forward, ← and ↑ back, and they wrap. The arrows are the underlined text's while the
pointer is what you last used: it has moved, clicked or scrolled since you last typed.
The text is tinted while that is so. Typing gives the arrows back to the caret until the
pointer moves again. Which version shows is not a step to undo. Five AI suggestions
for a word, three for a sentence or paragraph. In the panel, ↑ and ↓ do not wrap, an
emptied row removes its version, and the last version cannot be removed.

**Ghost, Overflow, the Lab.** Ghost with no selection takes the word at the caret. Stash
with no selection takes the paragraph, and stashed text goes to the end of Overflow.
Ctrl+Return moves text out of Overflow rather than copying it. "Walk through" steps through
a trim one cut at a time (Cut, Keep, Stop). How much a trim takes is counted by the app
from what the AI says of each sentence: first the words sentences could lose, then whole
sentences, the least needed first; a sentence the piece does not work without goes only
in Cut in half, and last; and each level holds everything the lighter ones take.
The marking passes underline in the Lab's crimson and give their reason on hover; a click
dismisses a mark, and an edit takes away only the marks on the words it changes. The typo
pass shows each fix on hover and has Fix all; walking through it makes each fix as you go.
The Lab guide and the keyboard icon open cards.

**Files and the Mac.** Everything about being a Mac app: the blended title bar, the menu
bar, Save As, Open Recent, the unsaved-changes question, drafts against a crash, several
windows, the file's name coming from its first heading, the Settings window. The Save icon
being lit means unsaved changes, and saving is always explicit. A file opens in the window
that already has it, else in one nobody has written in, else in its own.

**Sharing.** Post to X opens X's compose window with the piece as it reads (no heading
mark, nothing ghosted, nothing from Overflow) and does not use X's API; a piece too long
for a link goes to the clipboard instead, with a note. The M↓ card opens on the same
text with its heading marks, as Markdown to copy. The LinkedIn button's numbers are
measured from the clip.

**Typing.** `# ` at the start of a line makes a heading and hides the mark. Spell checking,
autocorrection and smart punctuation are off by default.

### Known differences from the original

- Lines are 36 px apart, not 36.4, and Overflow's 22, not 22.5: WebKit sets lines of text a
  whole number of pixels apart, and the original runs in a browser that does not.
- A selection that runs past the end of a line is drawn a little differently by WebKit.
- The Lab's trims take longer (see [The AI](#the-ai)): four to twenty-five seconds for the
  first level of a piece against two in the clip. The cuts are faded as the answer
  arrives, from about two seconds in. Going to another level is immediate, as it is in
  the clip, since the one answer serves all four.
- How a trim decides what goes is this replica's own: the clip shows words and whole
  sentences fading and the card counting them, not how they were chosen. Here the AI says
  what each sentence could lose and how much the piece needs it, and the app takes the
  level's share of that, the least needed first.
- Two things the original does when it scrolls are not copied, because they look like
  slips: closing the panel jumps the page to the top, and the wheel scrolls the page
  behind the source view once the view reaches its end.
- The proposal card's width for "Even sharper" and "Cut in half" is extrapolated; the clips
  show only the first two levels.
- The M↓ card has a tab the original's does not: Markdown, ahead of As saved and Readable,
  and the one it opens on. The original's card shows only the file, record and all.

## Working on it

```sh
npm test                     # unit tests for the document logic (Node's own runner, no packages)
scripts/build-app.sh         # build build/Write_On.app with SwiftPM
scripts/package.sh           # make the copy a release carries: build/releases/<version>/
scripts/release.sh patch     # make a release: see Versions
scripts/check.sh             # everything: unit tests, a look for keys, a build, every UI scenario
scripts/ui-test.sh files     # one scenario from tests/ui, in the app's own web view
scripts/ui-test.sh smoke --zoom 2
scripts/launch-check.sh      # start the real app once, hidden, and see that it comes up
scripts/bench.sh typing      # one measurement from tests/perf, out of sight (see Speed)
scripts/dev-server.sh        # serve the page at http://127.0.0.1:4173 for work in a browser
scripts/screenshots.sh       # take the pictures in docs/images again, out of sight
scripts/check-secrets.sh     # look for keys in the repository and its history
swift scripts/make-icon.swift  # draw packaging/AppIcon.icns again
```

The scripts that run scenarios use `python3` to print their results; it comes with the
Command Line Tools.

Everything built or left behind goes in `build/`, which git ignores:

```
build/
├── Write_On.app        the app as the working copy builds it: the one to open
├── dev/Write_On.app    a second copy, for runs while the first is open (below)
├── releases/<version>/ Write_On-<version>.zip and the app in it, one folder a version
└── results/            what runs leave: ui/<scenario>/, bench/<name>/, screenshots/
```

A version's folder is made by `scripts/package.sh` and is left alone by the next version's.
Once a release is published, the zip there is the one downloaded from its page. SwiftPM's
own build folders are in `.build/`, beside it.

The app is two parts. `Sources/WriteOn` is a small AppKit shell: windows, the menu bar,
files, the key, the network. `web/` is the editor, a page of plain ES modules with no build
step and no third-party code, shown in a `WKWebView`: `src/doc` and `src/ai` are pure
functions (the document model, the file format, prompts and the checking of answers) and
are what `npm test` covers; `src/editor`, `src/features` and `src/fx` sit on top. The two
talk over a small request-and-reply bridge.

### UI scenarios

`scripts/ui-test.sh <name>` launches the built app with `--ui-test`, runs
`tests/ui/<name>.js` inside the page and writes snapshots and `result.json` to
`build/results/ui/<name>/`. The page is read from `web/` in the working copy, so page-only changes
need no rebuild. `--zoom 2` makes the page lay out and paint as it does on a 2x display,
whatever display the Mac has, which is the scale of the source clips. A scenario can ask
for launch options of its own on its first line (`// launch: --setting read=false`).

A scenario is the body of an async function with a helper `t` in scope
(`tests/ui/_harness.js`): assertions, snapshots and input. Clicks, drags, typing and
shortcuts are native events handed straight to the app's web view.

**Scripted runs are headless.** A run is a background process with no Dock icon that is
never the active app. Its window is parked far outside every display, and is transparent,
click-through and unable to take the keyboard. Nothing you type or click reaches it and it
takes nothing from you. It also leaves the rest of the Mac as it found it:

- save and open panels and alerts are never shown: the scenario says how each is to be
  answered, and files go in the run's own folder;
- the menu bar is read and chosen from without being shown;
- the clipboard, the keychain, the list of recent documents and the speakers are left
  alone (a run has its own of each, in memory);
- the browser is never opened: the run notes what it was asked to open;
- nothing is written to the app's saved settings, and a run that changes them fails;
- it cannot reach the real AI service, or any other. Most scenarios get a scripted
  provider; the client itself is tested over HTTP against a stand-in gateway on this Mac
  (`tests/ui/support/fake-gateway.mjs`), which speaks both ways, with a key the stand-in
  knows; and the client of a run that is not a live one refuses every address that is
  not on this Mac.

`tests/ui/smoke.js` checks the first part on every run, and the harness fails any run that
came to the front, took the keyboard or changed the saved settings. Inside, the harness
makes WebKit treat the page as visible and focused, so scenarios run the same whether the
Mac is in use, locked or unattended. They do need a window server session (someone logged
in at the console, even if locked), because WebKit will not lay out a page without one.
Pointer moves and turns of the wheel are native events too, sent the way WebKit's own
test runner sends them, so WebKit itself finds what is under the pointer and repeats the
pointer's place when the page scrolls beneath it, as it does for a person.

The harness is compiled into the app and does nothing unless the app is started with
`--ui-test`. To move the pointer, set the display's scale and wait for a frame, a scripted
run calls methods of `WKWebView` that Apple does not publish: `_simulateMouseMove:` and a
few like it in `UITestHarness.swift`, and one in `DocumentWindowController.swift`. They
are the ones WebKit's own tests use, and they may change with any release of macOS.
Outside scripted runs the app uses one unpublished setting of the web view,
`drawsBackground`. An app with these in it cannot go on the App Store as it stands.

`WRITEON_APP=build/dev/Write_On.app` in front of `scripts/build-app.sh`, `check.sh`,
`ui-test.sh` or `bench.sh` builds and tests a second copy, so the one in `build/` can stay
open while you work.

`WRITEON_ARCH=x86_64` in front of `scripts/check.sh` or `ui-test.sh` runs the scenarios on
the app's Intel half. On an Apple silicon Mac that is under Rosetta, which has to be
installed. `tests/ui/smoke.js` checks on every run that the app has both halves, and that
a half that was asked for is the one running.

One scenario does ask a real service, and steps aside unless told to run:

```sh
scripts/ui-test.sh ai-live --ai live                              # with your key, OpenAI's way
WRITEON_API_FORMAT=anthropic scripts/ui-test.sh ai-live --ai live # the same, Anthropic's way
```

It asks for five other words, three other sentences, the hedges in the welcome piece, a
trim of that piece and of a 500-word draft at every level, and the slips in a page that
has some. It asks what
your shell names: LunaRoute and `glm-5.3-flash`, or the service and model in
`WRITEON_BASE_URL` and `WRITEON_MODEL`, in the way `WRITEON_API_FORMAT` or the address
says. The key has to come from your login shell too (`WRITEON_API_KEY` or
`LUNAROUTE_API_KEY`), since a scripted run does not read the keychain; without one it
fails. A run takes about a minute, or two when the model thinks before it answers.

Two things in the app are there for working on it and are on in every copy. Safari's Web
Inspector can attach to the page (Develop menu), and `WRITEON_WEB_ROOT` in the app's
environment makes it read the page from that folder and not from its own bundle, which is
how the scripts above run a built app against the working copy.

### Speed

`scripts/bench.sh <name>` runs a measurement from `tests/perf` the way a scenario is run,
with nothing on screen, and prints what it found:

| | |
| --- | --- |
| `typing` | From a key being sent to the frame that shows the letter, in pieces of up to 50,000 words |
| `interact` | The same for the tint under the pointer, flipping a word, moving the caret, Return; and whether every frame of the panel sliding and of the page scrolling is drawn |
| `launch` | How long opening takes, the memory the app and WebKit's processes hold, and what five idle seconds cost |
| `wasm` | The same word count three ways: as the app does it, as a plain loop, and in WebAssembly |

`node tests/perf/doc.bench.mjs` times the document's own functions away from any browser,
and `swift -O tests/perf/native-baseline.swift` does the typing measurement in AppKit's own
text view, as a yardstick. On a Mac mini (M4 Pro) with a 1x display at 60 Hz:

| Piece | Key to frame, this app | AppKit text view |
| --- | --- | --- |
| The welcome piece | 1.9 ms | 0.9 ms |
| 5,000 words | 2.2 ms | 1.1 ms |
| 50,000 words | 3.3 ms | 1.2 ms |

A display at 60 Hz shows a new frame every 16.7 ms. The app is ready 0.3 s after it is
started. With a caret in the text it and WebKit's processes hold about 210 MB, of which
120 MB is WebKit's graphics process; a page with nothing on it but a caret holds the same.
The document's own work is a few hundredths of a millisecond a keystroke, which is why
WebAssembly has nothing to offer here: in the trial a WebAssembly loop is no faster than
the same loop in JavaScript, and three times slower once the text has been handed to it.

## Versions

The app's version is three numbers, as [Semantic Versioning](https://semver.org) writes
them: major, minor, patch. Write_On ▸ About Write_On shows it. What each number promises:

- **Major** goes up when something you rely on stops working as it did: a file an earlier
  version saved no longer opens with all that was in it, a setting or a name read from the
  environment (`WRITEON_API_KEY` and the others) goes or changes its meaning, or the app
  needs a newer macOS than it did.
- **Minor** goes up when the app can do something it could not, and all of that still
  holds.
- **Patch** goes up for a mend that adds nothing and takes nothing away.

The number is kept in one place, `CFBundleShortVersionString` in `packaging/Info.plist`,
and `tests/ui/smoke.js` checks on every run that the built app reports three plain
numbers. `CFBundleVersion` beside it is the build: a whole number, one more with each
release. The version changes when a release is made, not with each commit, and a release
is the commit tagged with it, as `v1.0.0`, with a built copy of the app attached to it on
GitHub.

Between releases the numbers stay as the last release left them, so a build says where it
came from instead. `scripts/build-app.sh` writes down what git calls the commit it builds
(`git describe`), and About shows that for any build that is not a release's: "Version
1.0.1-3-g0ce718c (development)" is three commits after 1.0.1, at commit `0ce718c`, and
`-dirty` on the end means the working copy had changes not yet committed. A build made at a
release's tag, as the release workflow makes them, shows the version and, where the build
number was, the commit it was built from (from 1.0.3 on). The build number itself stays in
the app, where macOS reads it.

`scripts/package.sh` makes that copy. It builds the app afresh, zips it, and opens the zip
again to see that the signature holds, that both halves are there, and that nothing of the
Mac that built it is in it: a release build has the entries a debugger would use taken
out, because they name every source file by its full path, home folder and all. It will
not package a working copy with changes that are not committed.

What each release changed is in [CHANGELOG.md](CHANGELOG.md). A change a person using the
app would notice gets a line there, under "Unreleased", in the commit that makes it. Once
it is tested and on GitHub, `scripts/release.sh patch` (or `minor`, or `major`) makes the
release: it gives what is under "Unreleased" the new version's number, raises both
numbers in `packaging/Info.plist`, commits, tags, and pushes the commit and the tag. It
will not release a working copy with changes, or a `main` that is not the same as on
GitHub.

Pushing the tag is what publishes the release. On GitHub's own Mac, the
[release workflow](.github/workflows/release.yml) builds the app from the tagged commit,
runs the unit tests, packages it with `scripts/package.sh`, opens the zip and runs the app
from it through two scenarios, and publishes it with what CHANGELOG.md says of that
version, its size and its checksum. A release that went wrong can be published again from
the Actions tab, once what went wrong is mended.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) says how to build, test and send a change, and what
does not belong here. [SECURITY.md](SECURITY.md) says how to report a problem that
should not be reported in public. Everyone taking part is asked to keep to the
[code of conduct](CODE_OF_CONDUCT.md).

## What it cost to build

The app, its tests and these documents were made in one Claude Code session, October 11
to 14, 2026, with Claude Opus 5.5 (and Claude Fable 5.1 for one of the reviews). At
Anthropic's [API list prices](https://platform.claude.com/docs/en/about-claude/pricing)
that came to about **$470**: Claude Code's own count (`/cost`) was $468.88 near the end. On
a Claude subscription the same work is not billed by the token, so read this as what it
would cost on the API.

The 2,600 requests recorded in the session's transcript account for $414 of that:

| | Tokens | Cost |
| --- | --- | --- |
| Reading the conversation back from the prompt cache | 1.14 billion | $228 |
| Writing, thinking included | 4.6 million | $94 |
| Adding new context to the cache | 12.7 million | $92 |

By day, that was $126, $156, $112 and $20. Seven subagents (five reviews, an audit of the
app against the clips, and a second reading of the thread) came to $62 of it. Without
prompt caching the same requests would have cost about $4,700: most of a request's price
is the conversation it carries, and the cache sells it back at a twentieth of the input
price.

## Credits and what is whose

- **Write_On is Jason Fried's**: the idea, the design, the name and the wording of the
  interface. This project is not connected with him and he has not endorsed it.
- **The fonts** in `web/fonts` are IBM Plex Mono (© IBM Corp.) and Caveat (© The Caveat
  Project Authors), each under the SIL Open Font License 1.1. Their licenses sit beside
  them and go into the app with them. `scripts/fetch-fonts.sh` records where the files
  came from and checks them against what was published.
- **The marks on two buttons** are their owners': X's logo, and LinkedIn's redrawn in
  outline, both in `web/index.html`. They are trademarks, used here only to say where a
  button would post.
- **Two well-known algorithms**, both in the public domain, are in
  `web/src/editor/wobble.js`: the FNV-1a hash and the mulberry32 random number generator.
- **The rest was made for this project.** There are no packages and no libraries. The
  sounds are made in code, the icon is drawn by `scripts/make-icon.swift`, and the welcome
  piece was written for it.
- **The clips are not here**, nor frames from them, nor the essay he writes in them. The
  tests do use words the clips show, since they check the same behavior: the versions
  he tries for one word, and the paperclip that becomes an eraser. Some of their
  sentences are also built the way his opening one is. `reference/`, which git ignores,
  is where the measurements were made.

## License

The code and documents here are under the [MIT license](LICENSE), © 2026 Joey Simhon.
The fonts keep their own, and so does the code of conduct, which is the Contributor
Covenant's (CC BY 4.0). The license covers what was made for this project: Write_On's
name and design are not this project's to give.
