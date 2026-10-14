# Write_On for macOS Implementation Plan

> **Historical.** This is the plan the app was first built from, on 11 October 2026, task by task (steps use checkbox syntax). It has not been kept up to date. Where it and the code disagree, the code is right, and the design spec is the document that is kept in step with it.

**Goal:** Build `Write_On.app`, a macOS replica of the writing tool shown in Jason Fried's thread, matching its look, motion, sound, behaviour and file format.

**Architecture:** A Swift/AppKit shell owns the window, menus, files, secrets and network, and hosts the editor in a WKWebView. The editor is a dependency-free page of plain ES modules: pure document logic at the bottom (tested in Node), a thin `contenteditable` layer above it, features on top. The page talks to the shell over a small request/reply bridge and never sees the API key.

**Tech Stack:** Swift 6.3 toolchain in Swift 5 language mode, SwiftPM (no Xcode), AppKit, WebKit, Security; HTML/CSS/ES modules with no bundler and no packages; Web Audio; Canvas 2D; Node 26 built-in test runner; LunaRoute (OpenAI-compatible) with `glm-5.3-flash`.

**Spec:** `docs/superpowers/specs/2026-10-11-write-on-replica-design.md`. Measurements behind the spec: `reference/notes.md` (untracked). Reference clips and analysis scripts: `reference/videos/`, `reference/tools/`.

**How this plan is executed.** Natively, in the session that wrote it. For that reason it fixes the file map, the interfaces between tasks, the test cases and the order, and leaves the implementation code to be written test-first at execution time rather than transcribing it here first.

## Global Constraints

- App display name `Write_On`; bundle id `com.thesimhons.writeon`; executable and SwiftPM target `WriteOn`; minimum macOS 13.
- No Xcode: everything builds with `swift build` plus `scripts/build-app.sh`. Ad-hoc signing only.
- The page has no build step and no third-party code. Fonts are the only bundled third-party assets (IBM Plex Mono, Caveat; OFL, license files alongside).
- The API key never reaches the page. The web view loads only `writeon://app/…` and refuses other navigation.
- AI: base URL `https://gw.lunaroute.com/v1` (override `LUNAROUTE_BASE_URL`), model `glm-5.3-flash`, key from Keychain, then `LUNAROUTE_API_KEY` in the process environment, then the login shell. Alternatives use `"reasoning_effort": "low"`.
- Reference page size 1548×976 CSS px. Colours, type and geometry come verbatim from spec §4 and §6.2.
- File format exactly as spec §6.11: Markdown, `<!-- overflow -->`, `<!-- write_on {…} -->` with `version`, `html`, `groups`.
- Shortcuts are the Control combinations in spec §6.13, shown as "Ctrl+…" in the UI. The menu bar adds ⌘ equivalents.
- The author's essay and frames from his clips are never committed. `reference/` stays untracked.
- Copy shown in the UI is taken verbatim from the clips where it exists (spec §6).
- Commits go to branch `write-on-replica`, one per task, message ends with the session's co-author trailer.

## Review Focus

Failure modes the spec implies but does not spell out, most likely first. Each is pinned by a test in the task named.

1. **Pasting rich or multi-paragraph text** (from Pages, a browser, Slack) must arrive as plain paragraphs with no stray markup, colours or fonts, and blank lines preserved. — Task 8, UI scenario `paste.js`.
2. **Opening files the app did not write**: no metadata comment, CRLF line endings, tabs, a trailing `-->` inside the text, a damaged metadata block, a 50,000-word file. Text must survive an open-and-save round trip byte for byte apart from line-ending normalisation, and opening must not hang. — Task 4 unit tests; Task 21 timing check.
3. **Editing through a group**: Return, Backspace, select-all-and-type, and cut across word, sentence and paragraph groups and ghost runs must never leave duplicate ids, orphaned groups or a variant out of step with the text. — Task 8 unit tests on normalisation, UI scenario `group-edits.js`.
4. **Text that is not plain ASCII**: emoji and other surrogate pairs, combining marks, CJK input through an input method, right-to-left runs. Counts, caret mapping, word and sentence targeting must not split a character or throw. — Task 3 unit tests; Task 8 composition guard.
5. **AI that misbehaves**: 401, 429, 500, a stalled stream, a stream cut mid-line, empty output, numbered or quoted lines, Markdown fences round JSON, a trim that rewrites instead of deleting. The document must be untouched and one clear line shown. — Task 7 unit tests; Task 22 live and canned checks.

## File Map

```
Package.swift                      SwiftPM manifest (macOS 13, Swift 5 mode)
package.json                       "type": "module", test script (no dependencies)
Sources/WriteOn/
  main.swift                       NSApplication bootstrap
  AppDelegate.swift                lifecycle, window list, open-file events, launch arguments
  MainMenu.swift                   menu bar construction
  DocumentWindowController.swift   window, web view, per-document state, close/save flows
  Bridge.swift                     page ⇄ shell messages
  AssetSchemeHandler.swift         writeon://app/… → bundled web/
  FileStore.swift                  read/write, panels, recents, crash drafts
  AIClient.swift                   LunaRoute chat completions over SSE, cancellation
  Credentials.swift                Keychain / environment / login-shell lookup
  AppSettings.swift                UserDefaults-backed settings
  SettingsWindowController.swift   the small Settings window
  UITestHarness.swift              scripted scenarios and snapshots (launch-argument gated)
packaging/Info.plist               bundle metadata
scripts/
  build-app.sh                     swift build + assemble + sign build/Write_On.app
  make-icon.swift                  draws the app icon and writes AppIcon.icns
  fetch-fonts.sh                   records where the font files came from
  dev-server.sh                    serves web/ for browser development
  ui-test.sh                       runs tests/ui scenarios through the built app
web/
  index.html
  styles/base.css editor.css chrome.css panels.css popovers.css lab.css
  fonts/…                          woff2/ttf + licenses
  src/
    main.js                        boot and wiring
    native.js                      bridge wrapper; browser shim when not inside the app
    state.js                       UI state store and body classes
    sample.js                      the welcome document
    doc/ids.js text.js model.js format.js tone.js history.js trim.js      pure
    ai/prompts.js parse.js                                                 pure
    editor/wobble.js                                                       pure
    editor/dom.js selection.js editor.js decor.js
    features/readmode.js alternatives.js panel.js ai-alternatives.js ghost.js
             overflow.js contextmenu.js shortcuts.js tooltips.js lab.js
             sourceview.js share.js cards.js
    fx/sound.js explosion.js
tests/unit/*.test.js               node --test
tests/ui/*.js                      harness scenarios
README.md
```

Pure modules import nothing from the DOM. Feature modules import pure modules and `editor/*`; they do not import each other except through `main.js` wiring and `state.js`.

## Shared Interfaces

These names are used across tasks. A task that produces one implements exactly this.

```js
// doc/ids.js
newId(rand = Math.random): string                         // 7 base-36 chars

// doc/text.js
countWords(text): number                                  // whitespace-separated tokens
countChars(text): number                                  // UTF-16 length, spaces included
wordAt(text, offset): {start, end} | null                 // word (letters, digits, ' ’ -) touching offset
sentences(text): Array<{start, end}>                      // end excludes trailing whitespace
sentenceAt(text, offset): {start, end} | null
scopeOfSelection(text, start, end): 'word' | 'sentence' | 'paragraph'
articleFor(word): 'a' | 'an'
fixArticle(before, variant): string                       // returns `before` with its trailing a/an corrected

// doc/model.js      Group = {scope, variants: string[], active: number, ai?: string[]}
makeGroup(scope, text): Group
addVariant(group, text, {ai = false} = {}): number        // returns index, or -1 if empty/duplicate
removeVariant(group, index): {removed: string, active: number}
setVariantText(group, index, text): void                  // keeps `ai` honest
setActive(group, index): boolean                          // false if unchanged or out of range
isAI(group, index): boolean
cloneGroups(groups): Record<string, Group>

// doc/format.js     DocState = {html: string, groups: Record<string, Group>, overflow: string}
htmlToBlocks(html): Array<{kind: 'p'|'h'|'blank', level?, vid?, runs: Array<{text, vid?, ghost?}>}>
blocksToHtml(blocks): string
blocksToMarkdown(blocks): string
markdownToBlocks(markdown): blocks
serialize(state): string                                  // the file, "As saved"
readable(state): string                                   // the "Readable" tab
parse(fileText): {state: DocState, note: string | null}   // note explains anything dropped
plainText(state, {withoutGhost = false, headingMarker = true} = {}): string

// doc/tone.js
class ToneSession { constructor({idleMs}); begin(homeIndex, now); change(newIndex, now): 'high' | 'low'; end() }

// doc/history.js
class History { constructor(limit = 500); record(state, {coalesceKey, now, meta}); undo(current): entry | null; redo(current): entry | null; canUndo; canRedo }

// doc/trim.js
tokenize(text): string[]                                  // words, whitespace runs, single punctuation marks
alignDeletion(original, trimmed): null | {runs: Array<{start, end}>, caseFixes: Array<{start, end, text}>}
applyCuts(text, runs, caseFixes): string
tidy(text): string
wordStats(text, runs): {before, after, pct}

// ai/prompts.js
alternativesRequest({scope, paragraph, start, end, existing}): {messages, maxTokens, effort, count}
labRequest(kind, paragraphs, {percent} = {}): {messages, maxTokens, effort, schema}

// ai/parse.js
class LineStream { push(chunk): string[]; flush(): string[] }
cleanSuggestion(line): string
acceptSuggestions(lines, existing, count): string[]
parseLabResponse(kind, rawText, paragraphs): {items: Array<…>, rejected: number}

// editor/wobble.js
wobblePath({x0, x1, y, seed, amp = 0.3, period = 100, tilt = 0.4, step = 6}): string   // SVG path data

// native.js
native.call(method, params): Promise<any>
native.on(event, handler): void
native.inApp: boolean
```

## Order of Work

The shell skeleton and snapshot harness come second, before most of the page exists, so every later task can be checked in the real web view as well as in a browser.

---

### Task 1: Repository skeleton and the bare page

**Files:** Create `package.json`, `.gitignore`, `web/index.html`, `web/styles/base.css`, `web/styles/editor.css`, `web/fonts/*`, `scripts/fetch-fonts.sh`, `scripts/dev-server.sh`, `web/src/main.js`, `web/src/sample.js`, `README.md`.

**Produces:** a page that renders a static sample document with the spec's type, column and colours; `npm test` wired to `node --test tests/unit/`.

- [ ] Fetch IBM Plex Mono Regular/Bold woff2 and license from `@ibm/plex-mono@1.1.0`, Caveat variable TTF and OFL from `google/fonts`; write `fetch-fonts.sh` so the provenance is reproducible.
- [ ] `base.css`: `@font-face` rules, colour tokens from spec §4.1 as custom properties, page background, selection colour.
- [ ] `editor.css`: column 780 px centred, 20 px / line-height 1.82, padding 18vh / 45vh, edge mask (invisible to 53 px, full at 96 px), headings bold.
- [ ] `index.html` + `main.js` + `sample.js`: render the sample document into `#editor`.
- [ ] Verify in a browser at 1548×976: first text baseline 237.5 px, character advance 12.00 px, line pitch 36.40 px, left edge 384 px. Compare the handwriting face against `reference` crops and record the outcome in the README.
- [ ] Commit.

### Task 2: Shell skeleton, bridge and snapshot harness

**Files:** Create `Package.swift`, `Sources/WriteOn/{main,AppDelegate,DocumentWindowController,Bridge,AssetSchemeHandler,UITestHarness}.swift`, `packaging/Info.plist`, `scripts/build-app.sh`, `scripts/ui-test.sh`, `web/src/native.js`, `tests/ui/smoke.js`.

**Produces:** `build/Write_On.app` that opens the page in a blended-title-bar window; `native.call`/`native.on`; `scripts/ui-test.sh <scenario> [--zoom 2]` writing PNGs and a result JSON to `build/ui/<scenario>/`.

**Interfaces:**
- Bridge envelope page→shell `{method, params}` with a reply; shell→page `window.__writeon.emit(event, payload)`.
- Harness scenario API injected as `t`: `t.snap(name)`, `t.wait(ms)`, `t.until(fn, ms)`, `t.assert(cond, message)`, `t.key(key, {ctrl, shift, meta, alt})`, `t.type(text)`, `t.hover(x, y)`, `t.click(x, y, {button})`, `t.writeFile(name, bytesBase64)`, `t.log(…)`.
- Launch arguments: `--ui-test <file> --out <dir> [--size WxH] [--zoom N] [--ai mock]`.

- [ ] Window: content 1548×976 clamped to the screen, title hidden, title bar transparent over `#050a1c`, dark appearance, minimum 720×480.
- [ ] Scheme handler serving `web/` with correct MIME types, rejecting `..`.
- [ ] Navigation policy: allow `writeon://app/` only; open `http(s)` links externally.
- [ ] Harness: run the scenario after the page signals `app.ready`, 60 s overall timeout, exit code 0 only if no assertion failed.
- [ ] `tests/ui/smoke.js`: asserts the editor exists and the bridge answers `app.info`; snaps `smoke`.
- [ ] Run `scripts/build-app.sh && scripts/ui-test.sh smoke --zoom 2`; open the PNG and compare typography with `reference` frame `main.mp4@3.0s`.
- [ ] Commit.

### Task 3: Text utilities — `doc/text.js`

**Files:** Create `web/src/doc/text.js`, `tests/unit/text.test.js`.

Test cases (write first, watch them fail):
- `countWords`/`countChars`: the two selections read off the clips, one of 21 words / 110 characters and one of 34 / 182, each stood in for by a sentence written to the same counts. Empty string → 0 / 0. Runs of spaces and newlines count as one separator.
- `wordAt`: offsets at start, middle and end of a word; on a space between words picks the word to the left; apostrophes (`don’t`, `don't`) and hyphens (`trade-offs`) stay inside; punctuation is excluded; emoji and CJK do not throw and never return a range that splits a surrogate pair.
- `sentences`: splits on `.`, `?`, `!` followed by space and capital or quote; keeps closing quotes with their sentence; does not split on `e.g.`, `etc.` mid-sentence, decimals, or initials; a heading with no full stop is one sentence.
- `scopeOfSelection`: whole multi-sentence paragraph → `paragraph`; exactly one or two whole sentences → `sentence`; a whole single-sentence paragraph → `sentence`; anything else → `word`.
- `articleFor`: paperclip → a, eraser → an, hour → an, honest → an, user → a, unicorn → a, one-off → a, umbrella → an, FBI → an, 8-ball → an.
- `fixArticle`: `"like a "`+eraser → `"like an "`; `"An "`+thumbtack → `"A "`; `"banana "`+apple unchanged; `"a  "` (two spaces) unchanged.

- [ ] Tests, implementation, `npm test`, commit.

### Task 4: Groups and the file format — `doc/ids.js`, `doc/model.js`, `doc/format.js`

**Files:** Create those three and `tests/unit/model.test.js`, `tests/unit/format.test.js`.

Test cases:
- `newId`: 7 chars, `[0-9a-z]`, deterministic with a seeded `rand`.
- Model: adding a duplicate or empty variant returns −1; removing the active variant activates the same index, or the last when it was last; removing an AI variant removes it from `ai`; `setVariantText` on an AI variant drops it from `ai`; `ai` key absent when empty.
- `serialize` of a state modelled on the author's clip (heading group of scope `sentence`, word group with `ai`, paragraph group on the `<p>`, a blank first block, overflow of three paragraphs) produces: Markdown body with `# ` heading and one line per paragraph; `<!-- overflow -->` section; one `<!-- write_on {…} -->` line whose JSON has keys in the order `version`, `html`, `groups`, with `html` using `<p><br></p>`, `<p># <span data-vid="…">…</span></p>`, `<p data-vid="…">`.
- `parse(serialize(state))` deep-equals `state` for that fixture and for: empty document, document with no groups, ghost inside a group, a group inside ghost, text containing `-->`, `<`, `&`, quotes and emoji.
- `>` never appears inside the metadata comment body.
- `readable`: same Markdown and overflow; metadata pretty-printed with the HTML one block per line, as in the clip.
- Foreign files: CRLF input parses to the same blocks as LF; a file with no comment gives empty `groups`; a file whose Markdown was edited keeps only groups whose active text still occurs in the same paragraph, and returns a note; a truncated comment gives plain Markdown and a note.
- `plainText(…, {withoutGhost: true, headingMarker: false})` for the X path.
- Round trip of 50,000 generated words completes in under 500 ms.

- [ ] Tests, implementation, `npm test`, commit.

### Task 5: Tone rule, history, wobble — `doc/tone.js`, `doc/history.js`, `editor/wobble.js`

**Files:** Create those and `tests/unit/{tone,history,wobble}.test.js`.

Test cases:
- Tone, hover (idle 1750 ms), replaying the clips:
  - headline: home 0; changes at 0 ms→1, 1300→2, 2200→0 give high, high, low; then after 2700 ms →1 high, +2070 ms →2 high, +3300 ms →0 **high**.
  - follow-up word: home 2; →1 high, →0 high, →1 high, →2 low (gaps under 700 ms).
  - `end()` then a change starts a new session.
- Tone, panel (`idleMs: Infinity`): home 0; →6 high after 2 s; →7 high after 4 s; 7→6→5→4→3→2→1 high ×6; →0 low.
- History: typing with the same `coalesceKey` inside 700 ms is one step; a different key or a longer gap is a new step; undo then redo returns identical states; recording after undo clears redo; `meta` round-trips.
- Wobble: same seed gives the same path; different seeds differ; every y stays within `amp + tilt/2 + 0.05` of `y`; path starts at `x0` and ends at `x1`.

- [ ] Tests, implementation, `npm test`, commit.

### Task 6: Trim arithmetic — `doc/trim.js`

**Files:** Create `web/src/doc/trim.js`, `tests/unit/trim.test.js`.

Test cases:
- `tokenize("say, which")` → `["say", ",", " ", "which"]`; curly quotes, dashes and ellipsis are single tokens; `don’t` is one word.
- `alignDeletion`: a middle clause removed gives one run covering the clause and its comma; the result of `applyCuts` equals the trimmed text exactly.
- Leading words removed with the next word capitalised by the model ("Most of the struggle…" → "Struggle…") is accepted with one case fix.
- A reworded paragraph (any inserted or substituted word) returns `null`. Reordered words return `null`.
- Identical text gives zero runs. Empty trimmed text gives `null` (a paragraph cannot be cut entirely by a trim).
- Repeated words ("the big big dog" → "the big dog") gives one run of one word plus its space.
- `tidy`: doubled spaces collapse, a space before `,.;:!?` is removed, leading spaces go, the first letter of the text and of any sentence is capitalised.
- `wordStats`: 535 words with runs totalling 55 words → `{before: 535, after: 480, pct: -10}`.

- [ ] Tests, implementation, `npm test`, commit.

### Task 7: AI requests and responses — `ai/prompts.js`, `ai/parse.js`

**Files:** Create those and `tests/unit/ai.test.js`.

Test cases:
- `alternativesRequest` for each scope: target is marked in the paragraph, existing variants are listed, counts are 5 / 3 / 3, effort `low`, token caps 120 / 400 / 1500.
- `LineStream`: chunks split mid-line reassemble; `flush` returns a final unterminated line; blank lines are skipped.
- `cleanSuggestion`: strips `1. `, `- `, `• `, surrounding quotes and trailing full stop for word scope only.
- `acceptSuggestions`: drops case-insensitive duplicates of existing variants and of each other, caps at the count, drops lines over 12 words for word scope.
- `labRequest` for each kind returns a JSON schema with `additionalProperties: false`.
- `parseLabResponse`: accepts raw JSON and JSON inside a Markdown fence; rejects prose; for marks drops passages not found verbatim; for trims drops paragraphs where `alignDeletion` is `null`; for typos requires `find` verbatim and `replace` different from `find`; reports how many were rejected.

- [ ] Tests, implementation, `npm test`, commit.

### Task 8: The editing surface — `editor/dom.js`, `editor/selection.js`, `editor/editor.js`, `state.js`

**Files:** Create those; `tests/unit/normalise.test.js` (runs `normaliseBlocks` on block structures, no DOM); `tests/ui/{typing,paste,group-edits}.js`.

**Produces:**
```js
// editor/editor.js
createEditor(root): {
  getState(): DocState, setState(state, {caret} = {}),
  groups: Record<string, Group>,
  change(label, fn, {coalesceKey, meta} = {}),     // history + normalise + emit
  on('change' | 'selection', handler),
  undo(), redo(), blockElements(): HTMLElement[], elementFor(vid): HTMLElement | null
}
// editor/selection.js
getCaret(root): {block, offset} | null;  setCaret(root, pos);  getSelectionOffsets(root): {block, start, end} | null
rangeFor(root, block, start, end): Range;  pointToCaret(root, x, y): {block, offset} | null
// editor/dom.js
wrapRange(range, attrs): HTMLElement;  unwrap(el);  textOf(blockEl): string;  splitBlockAt(root, pos): HTMLElement
```

- [ ] Normalisation rules of spec §5.1 as a pure function over blocks, unit-tested: duplicate ids, orphaned groups, nested groups, empty spans, adjacent ghost runs merged, variant re-read from text.
- [ ] Input handling: Return and Shift+Return split the block without copying `data-vid` or heading level to the new block; Backspace at the start of a heading demotes it; `# ` promotes; typing at a span edge lands outside; nothing is normalised during composition.
- [ ] Paste and drop as plain text, split on newlines.
- [ ] History wired: typing coalesced, ⌘Z / ⇧⌘Z / Ctrl+Z / Ctrl+Shift+Z.
- [ ] UI scenarios assert the Review Focus cases 1 and 3 and snapshot the result.
- [ ] Commit.

### Task 9: Chrome, read mode and decorations — `features/readmode.js`, `features/tooltips.js`, `editor/decor.js`, `styles/chrome.css`

**Files:** Create those; `tests/ui/{readmode,marks}.js`.

- [ ] Word count (document and selection forms), click and Ctrl+Shift+R toggle, native title "Read (Ctrl+Shift+R)", mode stored through `native.call('settings.set')`.
- [ ] Icons as inline SVG at the positions in spec §4.3; alternates toggle; tooltips "Ctrl+S", "Ctrl+O", "Ctrl+Shift+P", "Ctrl+Shift+D".
- [ ] Decorations: word, sentence and paragraph marks with the geometry of spec §6.2, redrawn on change, resize and font load, hidden in read mode and when the toggle is off.
- [ ] Snap at 2× and compare with `main.mp4@12.0s`: underline offsets 4.3 and 9.6 px, dot pitch 5 px, bar 19 px left of the text.
- [ ] Commit.

### Task 10: Cycling, tones and article agreement — `features/alternatives.js`, `fx/sound.js`

**Files:** Create those; `tests/ui/{cycle,sound}.js`.

**Produces:** `alternatives.target(scope?)`, `alternatives.cycle(vid, dir)`, `alternatives.activate(vid, index, {session})`, `alternatives.remove(vid, index)`, `alternatives.dissolveIfSingle(vid)`; `sound.tick('high'|'low')`, `sound.boom()`, `sound.thump()`, `sound.render(name): Promise<Float32Array>`.

- [ ] Hover highlight, the armed-hover guard, arrow cycling with wrap, blur-in swap, caret to the end of the swapped text.
- [ ] Article agreement on word-scope swaps.
- [ ] Ticks through `ToneSession` for hover; View ▸ Sound Effects respected.
- [ ] `tests/ui/sound.js` renders each sound offline, writes WAVs through `t.writeFile`; analyse with `reference/tools`: 1900 ± 5 Hz, 1500 ± 5 Hz, tick audible 11–17 ms, boom fundamental 83–98 Hz.
- [ ] Commit.

### Task 11: The alternatives panel — `features/panel.js`, `styles/panels.css`

**Files:** Create those; `tests/ui/panel.js`.

- [ ] Slide-in panel, tabs, rows and markers, dimming of non-target paragraphs, pending-target underline, footer hint.
- [ ] Row behaviour of spec §6.5, including live typing, Return, emptying a row, ↑/↓, click, Esc, retarget on click in the page, tab retargeting, dissolve on close.
- [ ] Panel tone session.
- [ ] Scenario reproduces the clip: target a word, add "challenge", arrow to the top, assert the tick sequence high…low, snapshot against `main.mp4@91.0s`.
- [ ] Commit.

### Task 12: Context menu and shortcuts — `features/contextmenu.js`, `features/shortcuts.js`, `features/cards.js`, `styles/popovers.css`

**Files:** Create those; `tests/ui/menu.js`.

- [ ] Menu with the four items in both forms, labels and shortcuts verbatim, dimmed states, keyboard and click dismissal.
- [ ] All shortcuts of spec §6.13, each cancelling the WebKit default (assert Ctrl+O does not insert a line).
- [ ] Keyboard-icon card listing the shortcuts.
- [ ] Commit.

### Task 13: Explosions — `fx/explosion.js`

**Files:** Create it; `tests/ui/explode.js`.

- [ ] Particle system with the timeline of spec §6.12; stretched burst with flying letters for a word; reverse burst.
- [ ] Hover + Delete removes the showing variant with burst and boom; undo restores it with reverse burst and thump (history `meta`).
- [ ] Snap frames at 0, 50, 150, 400 ms (harness clock control) and compare with `follow.mp4@71.3s`.
- [ ] Commit.

### Task 14: AI alternatives — `features/ai-alternatives.js`

**Files:** Create it; extend `native.js` shim with a canned provider; `tests/ui/ai-alts.js`.

- [ ] `??` detection, the dance, minimum 750 ms, staggered arrival, robot markers, single undo step, caret back to the active row.
- [ ] "AI alternatives for selection" and Ctrl+Shift+G.
- [ ] Failure path: shake, one-line reason, no change.
- [ ] Commit.

### Task 15: Ghost — `features/ghost.js`

**Files:** Create it; `tests/ui/ghost.js`.

- [ ] Ghost and revive for a selection, a word, across paragraphs; runs split at group edges; flash on apply; menu label switches.
- [ ] Snapshot against `main.mp4@160s`; ghost text measures 11% of text colour over the background.
- [ ] Commit.

### Task 16: Overflow — `features/overflow.js`

**Files:** Create it; `tests/ui/overflow.js`.

- [ ] Panel, header, hint, toggle button state, Ctrl+Shift+D.
- [ ] Stash (selection, and paragraph when nothing is selected), Ctrl+Return use, drag into the page, all in the shared history.
- [ ] Commit.

### Task 17: Source view — `features/sourceview.js`

**Files:** Create it; `tests/ui/source.js`.

- [ ] Card, tabs, byte count with thousands separator, Copy, dimmed comment lines, Readable jumping to the metadata, Esc.
- [ ] Snapshot against `kepano.mp4@13.0s` and `@23.0s`.
- [ ] Commit.

### Task 18: The Lab, trims — `features/lab.js`, `styles/lab.css`

**Files:** Create those; `tests/ui/lab-trim.js`.

- [ ] Popover with verbatim copy; trim buttons with sub-labels; highlight of the pending level.
- [ ] Reading state: card text, scan line sweeping each block in 300 ms.
- [ ] Proposal: faded runs from `alignDeletion`, card numbers from `wordStats`, click to keep, Make the cuts (one undo step, case fixes, tidy only where something was kept), Done, replace on another level.
- [ ] Walk through: step card, Cut / Keep / Stop, scroll each passage into view.
- [ ] Any edit, undo or redo while a proposal is pending dismisses it.
- [ ] Commit.

### Task 19: The Lab, marks, typos and guide

**Files:** Modify `features/lab.js`, `styles/lab.css`; `tests/ui/lab-marks.js`.

- [ ] Five mark passes and the typo pass through `parseLabResponse`; `lab`-coloured underline; reason on hover; click dismisses; card with counts and buttons from spec §9 items 4 and 5.
- [ ] "The Lab guide…" card with a two-sentence explanation of each idea.
- [ ] Commit.

### Task 20: Sharing — `features/share.js`

**Files:** Create it; `tests/ui/linkedin.js`.

- [ ] X: compose link with the text, 4,000-character fallback to clipboard with a note.
- [ ] LinkedIn: flee inside 40 px, jump 45–120 px, clamp to the window, explode on the eighth approach, gone for the session, not focusable.
- [ ] Commit.

### Task 21: Menus, files and windows in the shell

**Files:** Create `Sources/WriteOn/{MainMenu,FileStore}.swift`; modify `AppDelegate.swift`, `DocumentWindowController.swift`, `Bridge.swift`, `packaging/Info.plist`; `web/src/features/files.js`.

- [ ] Menu bar per spec §6.13 and §9 item 30, including standard Edit ▸ Spelling and Substitutions, with autocorrect and smart punctuation defaulting to off.
- [ ] New, Open, Open Recent, Save, Save As, close and quit prompts, file name from the first heading, `.md` document type, files opened from Finder.
- [ ] Save icon accent while unsaved; crash snapshots every few seconds and recovery at launch.
- [ ] Open the 50,000-word fixture: interactive in under 2 s (Review Focus 2).
- [ ] Commit.

### Task 22: LunaRoute in the shell — `AIClient.swift`, `Credentials.swift`, `AppSettings.swift`, `SettingsWindowController.swift`

**Files:** Create those; modify `Bridge.swift`; `tests/ui/ai-live.js`.

- [ ] Streaming chat completions with idle timeout 20 s, cancellation, error mapping for 401 / 429 / 5xx / offline.
- [ ] Key lookup order and the Settings window with Test connection.
- [ ] `--ai mock` canned provider in the shell for scenarios.
- [ ] Live run with the real key: five word alternatives, three sentence versions, one Slight trim on the sample document; record timings and the trim percentage; raise Lab reasoning if the trim misses its target by more than half.
- [ ] Commit.

### Task 23: Packaging and fidelity pass

**Files:** Create `scripts/make-icon.swift`; modify `scripts/build-app.sh`, `README.md`, CSS as needed.

- [ ] App icon, Info.plist finalised, `build/Write_On.app` launches from Finder.
- [ ] Run every scenario at 2×; compare each snapshot with its reference frame; fix differences in position, size and colour.
- [ ] README: build, run, shortcuts, where the key comes from, the hands-on checklist of spec §10.5, and the list of inferred behaviour.
- [ ] `npm test` and all scenarios green; commit.

## Self-Review

- **Spec coverage:** §4 → Tasks 1, 9; §5 → 3–5, 8; §6.1 → 9; §6.2 → 5, 9; §6.3–6.4 → 5, 10, 13; §6.5 → 11; §6.6 → 7, 14, 22; §6.7 → 15; §6.8 → 16; §6.9 → 12; §6.10 → 6, 7, 18, 19; §6.11 → 4, 17, 20, 21; §6.12 → 10, 13; §6.13 → 12, 21; §7 → 2, 21, 22; §8 → 14, 18, 21, 22; §9 → each item lands in the task for its area; §10 → 2 and every task's scenario, 23.
- **Type consistency:** names in each task match "Shared Interfaces".
- **Review Focus:** each of the five lines names its owning task.
- **Deviation from the skill's template:** implementation code is not pre-written in this document; see "How this plan is executed".
