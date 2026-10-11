# Write_On for macOS — replica design

- **Date:** 2026-10-11
- **Status:** Draft, awaiting review
- **Source:** Jason Fried's thread, <https://x.com/jasonfried/status/2105403067793584590>

## 1. Goal

Build a macOS app that reproduces Write_On, the writing tool Jason Fried demonstrated, as
closely as the published material allows: same layout, colours, type, motion, sounds, file
format and behaviour.

**Success looks like this.** Put the app next to the videos and run the same steps. The
screen looks the same, the ticks and booms sound the same, the same things happen. A file
saved by the app has the structure shown in his file-format clip. The AI features work
against LunaRoute with `glm-5.3-flash`.

**Decisions already made by the user**

| Decision | Choice |
| --- | --- |
| Platform | macOS app |
| Editor core | WebKit editor (WKWebView) inside a native Swift/AppKit shell |
| AI backend | LunaRoute API, model `glm-5.3-flash` |
| Process | Written spec, then implementation plan, each reviewed before code |

### Non-goals

- Other platforms, collaboration, sync, accounts.
- Version history. The author says "There are no versions"; this is alternative control.
- Rich Markdown rendering. Only headings are styled; everything else is literal text.
- Really posting to LinkedIn. The button exists to be impossible to click.
- Posting to X through the X API. The app opens X's compose window instead (§6.11).
- Notarisation or distribution. The app is built and ad-hoc signed for this Mac.

## 2. Evidence and how far "exact" can go

The original is not released, so the videos and the author's replies are the whole
specification. Each behaviour below is one of three kinds:

- **Observed** — seen in a video frame or measured from the audio track.
- **Stated** — said by the author in the thread.
- **Inferred** — not shown anywhere; designed here to fit what is shown. Every inferred
  behaviour is listed in §9 so it can be challenged in one place.

Material used:

| Clip | Length | Covers |
| --- | --- | --- |
| Main walkthrough (root post) | 6:55 | Everything except `??` and the file format |
| Follow-up ("Plus more explosions!") | 1:26 | `??` in the panel, delete-explosion, undo |
| Reply to @kepano | 0:52 | Ctrl+U source view and the saved file |

All three were recorded at 3096×1952 px, 60 fps, which is a 1548×976 pt page at 2×. Every
measurement in this document is in CSS px on that 1548×976 page. Text positions were
measured by pixel projection (character pitch 12.00 ± 0.01 px, line pitch 36.40 ± 0.05 px);
sounds by narrow-band analysis of the audio track.

The author's essay used in the demo is his writing and is **not** bundled. The app ships
with a short sample document written for this project.

## 3. Product walkthrough

Write_On is a single-document writing surface with five ideas layered on a plain editor.

1. **Alternatives.** Any word, sentence or paragraph can carry several versions. One is
   showing; the others are a keystroke away, in place, in context.
2. **Ghost.** Dim a passage to about 11% so you can read the piece without it, without
   deleting it.
3. **Overflow.** A side panel for writing you want nearby but not in the piece.
4. **Lab.** AI passes that mark things or dim what could be cut. They never rewrite.
5. **One file.** Text, overflow and alternatives live in a single Markdown file.

It opens as a bare editor. Clicking the word count turns the rest on.

## 4. Visual system

### 4.1 Colour

| Token | Value | Used for |
| --- | --- | --- |
| `bg` | `#050a1c` | Page |
| `text` | `#f5d1c0` | Body text, caret |
| `accent` | `#817cd4` | Active icons, active tab, active row marker, word-scope active dot |
| `panel` | `#0a0f1f` | Side panels |
| `popover` | `#131623` | Context menu, Lab popover, trim card, source view |
| `dim-icon` | `text` at 36% | Inactive icons |
| `dim-text` | `text` at 53% | Inactive tabs, inactive rows, shortcut labels, hints |
| `faint` | `#3a3e52` | Word count |
| `selection` | `accent` at 28% | Text selection |
| `hover` | `accent` at 11% | Hover highlight on a group |
| `word-line` | `#474c74` | Word-scope underline |
| `sentence-line` | `#5b4d68` | Sentence-scope underline |
| `sentence-dot` | `#c29abe` | Sentence-scope active dot |
| `paragraph-bar` | `#805448` | Paragraph-scope margin bar |
| `lab` | `#c81042` | Scan line, Lab marks |

Opacity states: ghost text 11%; paragraphs other than the panel's target 35%.

### 4.2 Type

- **Editor:** IBM Plex Mono, 20 px, weight 400; headings weight 700 at the same size.
  Character advance 12.00 px. Line pitch 36.40 px (line-height 1.82).
- **Panels and menus:** IBM Plex Mono at 15 px (panel rows, overflow text), 13 px (menus,
  Lab), 12 px (trim card), 10 px (word count, hints, tooltips).
- **Labels:** a handwriting face, believed to be Caveat, ~22 px, for the panel tabs
  ("Word", "Sentence", "Paragraph"), "Overflow", "As saved", "Readable" and "Copy". To be
  confirmed against frames during implementation; if it does not match, the closest
  open-licensed face is substituted and the choice recorded.
- Both families are OFL-licensed and bundled with their licence files.

### 4.3 Page layout

- Text column: 780 px wide (65 characters), centred. It does not move when panels open.
- Top padding 18vh (175.7 px at 976), bottom padding 45vh.
- The text is masked near the top and bottom edges of the page so lines dissolve rather
  than collide with the chrome: invisible within 53 px of either edge, rising linearly to
  full strength at 96 px.
- The top row of chrome is centred 32 px from the top; the bottom row 32 px from the bottom.

| Element | Position (1548×976) | Notes |
| --- | --- | --- |
| Word count | left 24 px, top row | "535 words 3115 chars"; with a selection "34 words 182 chars selected". Words are whitespace-separated; chars include spaces (both readouts in the clips check out against the selected text). |
| Alternates toggle | top centre, left of centre | Three dots over a short bar; accent when on |
| Source icon | top centre, right of centre | "M↓" in a rounded rectangle |
| Keyboard icon | top right, 24 px inset | |
| Save, Open, X, LinkedIn | bottom left, centres at x = 30, 65, 100, 136 | 18 px icons |
| LAB | bottom centre | Dashed rounded rectangle, letter-spaced caps |
| Overflow toggle | bottom right, 24 px inset | "XYZ" in a box; accent when open |

Exact icon geometry is drawn as SVG from 4–10× enlargements of the frames.

### 4.4 Window

A standard macOS window, default content size 1548×976, with the title bar blended into the
page colour and the title text hidden. The traffic lights remain. Page content starts below
the title bar, so every control is clickable and the layout inside the page matches the
video. In full screen the title bar disappears and the match is exact.

## 5. Document model

### 5.1 Structure

The document is an ordered list of blocks. A block is a paragraph, a heading, or a blank
line. Inside a block, text can be wrapped in:

- an **alternative group** of scope `word` or `sentence` (an inline span), or
- a **ghost** run (an inline span).

A whole block can be a group of scope `paragraph`.

A group is `{ scope, variants: string[], active: number, ai?: string[] }`:

- `variants` are plain strings. `variants[active]` is always exactly the text showing in
  the document; editing that text in place edits the active variant.
- `ai` lists the variants that came from the AI. A variant the user then edits no longer
  matches and counts as theirs.
- Ids are seven random base-36 characters, e.g. `h00a0dg`.

Rules that keep the model sound:

- **Groups do not nest.** Variants are plain strings, so a group cannot contain another.
  Creating a larger group over smaller ones dissolves the smaller ones to their current
  text (one undo step restores them). Asking for alternatives inside an existing group
  targets that group.
- **A group needs at least two variants.** A group left with one variant dissolves back to
  plain text once it is no longer the panel's target. This is why the underline disappears
  when the last alternative is undone.
- **Ghost and groups never straddle.** A ghost run may sit inside a group or around one,
  but a run that would cross a group's edge is split at the edge, so ghosting dims exactly
  what was selected. Because variants are plain strings, ghost marking inside a group
  belongs to the variant that was showing; switching variants drops it.
- After every edit the document is normalised: duplicate ids produced by splitting a
  paragraph are resolved (the first keeps the group), orphaned groups are dropped, the
  active variant is re-read from the text.

### 5.2 Editing surface

One editable region whose children are paragraphs only. Paste is plain text, split into
paragraphs on newlines. Typing at the very edge of a group or ghost run lands outside it;
typing strictly inside edits it.

Headings: typing `# ` (up to `###### `) at the start of a line turns it into a heading and
hides the marker. Backspace at the start of a heading turns it back into a paragraph. All
levels look the same: bold, same size.

Spelling and grammar checking, autocorrect, smart quotes and smart dashes are off by
default (the demo shows typed straight apostrophes preserved, and no squiggles). The
standard Edit ▸ Spelling and Substitutions menus are present to turn them on.

### 5.3 Undo

One history for the whole document: text, groups, ghost runs and overflow together.
Typing is coalesced into bursts. Each command is one step: adding an AI batch, deleting an
alternative, ghosting, stashing, making trim cuts. ⌘Z / ⇧⌘Z, and Ctrl+Z / Ctrl+Shift+Z.

## 6. Features

### 6.1 Read mode and the alternates toggle

- **Read mode** is the launch state: only the text and the word count are visible. Chrome,
  panels, underlines, dots and margin bars are hidden; hover-cycling and the custom
  context menu are off. Ghost text stays dim, because that is content, not chrome.
- Clicking the word count, or Ctrl+Shift+R, toggles Read mode. The word count's tooltip
  is "Read (Ctrl+Shift+R)". Chrome fades in over about 200 ms.
- Using any feature shortcut leaves Read mode.
- The **alternates toggle** hides or shows only the underlines, dots and margin bars, "so
  you can look at the document without any of that formatting". Behaviour is unchanged.
- The last-used mode is remembered between launches. First launch is Read mode.

### 6.2 How alternatives are drawn

Each scope has its own mark, so the three can sit near each other without confusion.

| | Word | Sentence | Paragraph |
| --- | --- | --- | --- |
| Mark | Underline | Underline | Vertical bar in the left margin |
| Colour | `word-line` | `sentence-line` | `paragraph-bar` |
| Thickness | 1.25 px | 1.2 px | 1.5 px |
| Position | 4.3 px below the baseline | 9.6 px below the baseline | 19 px left of the text, from the first line's ascenders to the last line's descenders |
| Dots | Under the line, centred on the word, 8.5 px below the baseline | Inline at the right end; the line stops 3 px short of them | Stacked top to bottom, centred on the bar's middle, 6 px to its left |
| Active dot | Filled `accent` | Filled `sentence-dot` | Filled, a lighter `paragraph-bar` |

- One dot per variant, in variant order. 3 px diameter, 5 px pitch. The active one is
  filled; the rest are hollow rings.
- The lines are drawn like an editor's pen: a slow wobble of about ±0.3 px over roughly
  100 px, a slight tilt, and a stroke that fades in over its first few pixels. The wobble
  is seeded from the group id, so a given line always looks the same.
- An underline that wraps continues on each line. Sentence dots sit at the very end;
  word dots centre under the last line of the wrapped phrase.

### 6.3 Cycling in place

- Hovering a group tints it with `hover`. For a paragraph group the whole block tints.
- While hovering, **→ or ↓** shows the next variant and **← or ↑** the previous, wrapping
  at the ends. The new text arrives with a ~150 ms blur-and-fade, the line reflows, and
  the caret lands at the end of the swapped text. The mouse pointer may hide; cycling
  keeps working.
- **Delete or Backspace** while hovering removes the variant that is showing, with an
  explosion (§6.12), and shows the next one. Undo brings it back with a small reverse
  burst and a thump. A group cannot be reduced below one variant this way.
- **Article agreement.** For word scope, an "a" or "an" directly before the group follows
  the new variant: "like a thumbtack" becomes "like an eraser". Capitalisation of the
  article is preserved. A short exception list covers silent h and "you"-sounds.
- **Guard against accidents.** Arrows and Delete act on a hovered group only when the
  pointer moved onto it since the last click or typed character. Clicking into a group to
  edit its text therefore gives normal caret keys until the pointer leaves and returns.

### 6.4 The two tones

A tick plays on every change of active variant, from any route.

- **High tick, 1900 Hz:** the usual sound.
- **Low tick, 1500 Hz:** you have landed back on the variant you were on when you began
  playing.

"Began playing" is defined per session:

- **Hover session:** starts at the first change, with the variant showing at that moment
  as home. It ends after 1.75 s without a change, or when the pointer leaves the group.
  (Observed: gaps up to 1.45 s keep the session; gaps of 2.07 s and more start a new one.)
- **Panel session:** starts when the panel targets the group, with the variant active at
  that moment as home. It lasts until the panel closes or targets something else.

Both rules were checked against every tick in the three clips.

### 6.5 The alternatives panel

A 268 px panel that slides in from the left over the margin.

- **Opening.** Right-click ▸ "Alternatives for selection" / "Alternatives for “word”", or
  Ctrl+Shift+A. With no selection the target is the word at the caret.
- **Scope of a selection.** A whole multi-sentence paragraph is `paragraph`; one or more
  complete sentences (including a heading) is `sentence`; anything else is `word`, which
  also covers short phrases such as "tough stuff". A selection that crosses paragraphs
  cannot become a group; the menu item is dimmed.
- **Tabs** "Word · Sentence · Paragraph" show the target's scope. Clicking another tab
  retargets to the word, sentence or paragraph around the same spot.
- **While open,** the target's paragraph stays at full strength and every other paragraph
  drops to 35%. The target shows its scope's underline even before it has alternatives.
  Clicking a word in the page retargets the panel to it, silently.
- **Rows.** One per variant: a marker and editable text. The active row is full-strength
  text with an accent marker; the rest are `dim-text`. Markers: a small square for the
  user's variants (a filled dot when active), a robot head for AI variants.
- **Keys and clicks.**
  - Clicking a row makes it active: tick, and the page text swaps.
  - ↑ / ↓ move the active row, no wrap.
  - Typing in the empty row creates a variant at the first character and makes it
    active, so the page updates as you type.
  - Return adds an empty row. Emptying a row removes that variant; the previously active
    one returns.
  - Esc closes the panel.
- A new target with no alternatives opens with one row (its current text) and an empty
  row already focused. An existing group opens with the caret at the end of its active row.
- Footer hint: "return adds · esc closes".

### 6.6 AI alternatives

- **`??` in a row.** A row whose whole content is `??` becomes a request. The two question
  marks turn accent, go bold and dance (each bobs and tilts on its own) while the request
  runs, for at least 750 ms. Suggestions then arrive one after another above the `??`
  row, which disappears with the last one. The caret returns to the active row.
- **Right-click ▸ "AI alternatives for selection"**, or Ctrl+Shift+G, opens the panel and
  starts a `??` request at once.
- Suggestions per request: five for a word, three for a sentence, three for a paragraph.
- Suggestions are in context: the request carries the target, its sentence, its paragraph
  and the variants already present, and asks for replacements that fit the grammar and
  tone of the sentence as written. It is not a synonym lookup.
- A batch is one undo step. Undoing it removes all of its rows.
- Failure (no key, network, bad response): the `??` row stops dancing and shakes once,
  the footer shows a one-line reason for a few seconds, and nothing else changes.

### 6.7 Ghost

- Select text, then right-click ▸ "Ghost it" or Ctrl+/. With no selection it applies to
  the word at the caret. The text drops to 11% and stays in the flow; a highlight flashes
  over it and fades.
- With the caret or selection in ghosted text the command reads "Revive it" and restores
  every ghost run it touches.
- Ghosted text remains editable and is counted in the word count.

### 6.8 Overflow

- A 282 px panel on the right, toggled by the "XYZ" button or Ctrl+Shift+D. Header
  "Overflow". A plain editable text area. Footer hint "ctrl+↵ or drag into the page to
  use". The page does not dim.
- **Stash:** right-click ▸ "Stash this in Overflow", or Ctrl+Shift+X, moves the selection
  out of the page and appends it to Overflow as its own paragraph, opening the panel.
  With no selection it moves the whole paragraph at the caret.
- **Use:** Ctrl+Return in Overflow moves the selection (or the paragraph at the caret)
  into the page at the page's last caret position. Dragging selected text from Overflow
  into the page does the same.

### 6.9 Context menu

Replaces the system menu outside Read mode. A dark rounded card with a label on the left
and its shortcut on the right.

| With a selection | With no selection |
| --- | --- |
| Alternatives for selection — Ctrl+Shift+A | Alternatives for “word” — Ctrl+Shift+A |
| AI alternatives for selection — Ctrl+Shift+G | AI alternatives for “word” — Ctrl+Shift+G |
| Ghost it / Revive it — Ctrl+/ | Ghost it / Revive it — Ctrl+/ |
| Stash this in Overflow — Ctrl+Shift+X | Stash this in Overflow — Ctrl+Shift+X |

### 6.10 The Lab

The dashed "LAB" button opens a popover above it.

```
The Lab guide…                         what each idea does
──────────────────────────────────────────────────────────
Fix punctuation and typos
Mark the weakest sentences
Mark sentences that run long
Mark convoluted sentences
Mark words that don’t fit the tone
Mark hedges and filler
──────────────────────────────────────────────────────────
[ Original ] [ Slight trim ] [ Tighten more ] [ Even sharper ] [ Cut in half ]
                  ~10%            ~20%             ~30%            ~50%
```

**Trims** (observed in full):

1. Choosing a trim closes the popover and shows a card at the bottom centre:
   "**Slight trim** Reading…", then "Faded words would go. Click one to keep it.", with
   buttons "Make the cuts" and "Done".
2. While it reads, a crimson line the width of the text column sweeps down each
   paragraph in turn, 300 ms per paragraph, top to bottom of the block.
3. When the answer arrives the proposed cuts fade to ghost strength where they stand,
   and the card's first line becomes "**Slight trim** 535 → 480 words · −10%". A
   "Walk through" button appears between the other two.
4. Clicking a faded passage keeps it. "Make the cuts" deletes what is still faded, as one
   undo step. "Done" dismisses the proposal and the text returns to normal.
5. Choosing another level replaces the pending proposal. "Original" is highlighted when
   nothing is pending.

A proposal is temporary. It is not saved to the file and is not the same thing as ghost
text, though it looks the same. Text the user has already ghosted is treated as already
out: it is not offered for cutting and is left out of both word counts on the card. A
cut inside an alternative group edits that group's active variant; a cut that removes
all of it removes the group.

After "Make the cuts" the app does only mechanical tidying: collapse doubled spaces,
remove a space left before punctuation, and capitalise a sentence whose first words were
cut. It changes no other words.

**Mark passes and the typo pass** are named in the video but not run, so their results
are inferred (§9): the same card and scan line, with marked passages underlined in `lab`
and a short reason shown on hover.

**AI contract.** Each pass sends the document as numbered paragraphs and gets back a
fixed JSON shape. What the app accepts is narrow by construction:

- **Trims:** the AI returns each paragraph with words removed. The app compares it with
  the original and accepts a paragraph only if the result can be reached by deletion
  alone (a change of capital at a new sentence start is allowed). The deleted words
  become the proposal. A paragraph that was reworded is ignored.
- **Marks:** the AI returns verbatim passages with a short reason. Any passage that does
  not occur in its paragraph is discarded.
- **Typos:** as marks, plus a replacement for each passage. A replacement is applied
  only when the user accepts it.

So for trims and marks the AI can only point at text. Only the typo pass can change a
word, and only with consent.

### 6.11 Files, source view, sharing

**The file** is one UTF-8 Markdown file:

```
# Heading

Paragraph text on one line.

Another paragraph.

<!-- overflow -->

Overflow text, as plain paragraphs.

<!-- write_on {"version":1,"html":"<p># <span data-vid=\"kswdaew\">Heading</span></p>…","groups":{"kswdaew":{"scope":"sentence","variants":["…","…"],"active":0}}} -->
```

- The visible Markdown is the document as it currently reads, so any other tool sees a
  normal file. Ghosted text is included as ordinary text.
- `<!-- overflow -->` and everything after it up to the metadata comment is the overflow.
  It is omitted when overflow is empty.
- The `write_on` comment holds the editor state: `html` (one `<p>` per block, `<p><br></p>`
  for a blank line, headings as `<p># …</p>`, inline groups as `<span data-vid="id">`,
  paragraph groups as `<p data-vid="id">`, ghost runs as `<span data-ghost>`) and `groups`.
  `ai` appears only on groups that have AI variants. `>` is escaped inside the JSON so the
  comment cannot be closed early.
- **Opening.** If the comment is present and the text of its `html` equals the Markdown
  above it, the editor state is restored from it. If the Markdown was changed in another
  editor, the Markdown wins: a group is kept only where its active text can still be
  found in the same paragraph, and ghost marking is dropped. A file with no comment opens
  as plain Markdown.
- Save (Ctrl+S, ⌘S), Save As (⇧⌘S), Open (Ctrl+O, ⌘O), New (⌘N), Open Recent. The
  suggested file name comes from the first heading. The Save icon is accent while there
  are unsaved changes.
- Closing or quitting with unsaved changes asks first. Unsaved work is also snapshotted
  to Application Support every few seconds and offered back after a crash.

**Source view** (Ctrl+U, or the M↓ icon): a centred card over the dimmed page.

- Tabs "As saved" and "Readable"; on the right the byte count ("9,344 bytes") and "Copy".
- "As saved" shows exactly what Save would write. "Readable" pretty-prints the metadata,
  with the HTML unescaped one block per line, and jumps to it.
- Comment and metadata lines are dimmed; text is full strength. Read-only. Esc closes.

**Post to X** (X icon, Ctrl+Shift+P): opens X's compose window in the default browser
with the document text filled in, heading marker and ghosted text removed. If the text is
longer than 4,000 characters it is copied to the clipboard instead and the compose
window opens empty, with a note saying so.

**LinkedIn:** the fourth icon runs from the pointer. Whenever the pointer comes within
40 px it jumps 45–120 px away, staying inside the window. After seven escapes the next
approach blows it up, with the explosion and boom. It stays gone until the next launch.

### 6.12 Sound and explosions

All sound is synthesised; there are no audio files.

| Sound | Recipe |
| --- | --- |
| High tick | Triangle wave, 1900 Hz. Gain 0 → 0.3 in 3 ms, then exponential decay, τ ≈ 4.7 ms. About 14 ms audible. |
| Low tick | The same at 1500 Hz. |
| Boom | Sine at a random 83–98 Hz, starting from ~230 Hz and dropping within 10 ms; peak 0.9, τ ≈ 70 ms. Plus a noise burst centred on 1–6 kHz that peaks at ~35 ms, τ ≈ 60 ms, gone by 300 ms. |
| Undo of a delete | Noise rising for 140 ms and cut off, then a 98 Hz thump, τ ≈ 55 ms. |

Explosion, drawn on a canvas over the page:

- 0 ms: white-yellow flash with a red-orange glow, ~45 px radius, and short white streaks.
- 50 ms: several fireballs (yellow-white core to orange), white spark lines, white debris.
- 100–300 ms: sparks reach ~145 px; debris falls under gravity; fire breaks into embers.
- 400 ms on: grey-brown smoke, gone by about 1.3 s.

For a deleted alternative the burst is stretched along the word, and the word's letters
fly apart. For the LinkedIn icon it is centred on the icon.

View ▸ Sound Effects turns sound off.

### 6.13 Shortcuts

As shown in the original, including on the Mac, these use Control.

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+R | Read mode |
| Ctrl+Shift+A | Alternatives for selection or word |
| Ctrl+Shift+G | AI alternatives for selection or word |
| Ctrl+/ | Ghost it / Revive it |
| Ctrl+Shift+X | Stash in Overflow |
| Ctrl+Shift+D | Overflow panel |
| Ctrl+U | Source view |
| Ctrl+S, Ctrl+O | Save, Open |
| Ctrl+Shift+P | Post to X |
| Ctrl+Return (in Overflow) | Use in the page |

The Mac menu bar adds the usual ⌘ equivalents: ⌘N, ⌘O, ⌘S, ⇧⌘S, ⌘W, ⌘Z, ⇧⌘Z, ⌘, and ⌘Q.
Tooltips on the chrome show the Control shortcuts, as in the video.

## 7. Architecture

```
Write_On.app
├── Native shell (Swift, AppKit)
│   ├── App            lifecycle, menu bar, open-file events
│   ├── DocumentWindow one per document: window, web view, file URL, dirty flag
│   ├── Bridge         typed request/reply and events between page and shell
│   ├── Files          open/save panels, reading and writing, recents, crash snapshots
│   ├── AIClient       LunaRoute chat completions, streaming, cancellation
│   ├── Credentials    API key lookup
│   ├── Assets         serves the bundled page on a private URL scheme
│   └── UITestHarness  runs a scripted scenario and writes snapshots (debug only)
└── Page (plain ES modules, no build step, no dependencies)
    ├── doc/      model, file format, text utilities, history      ← pure, unit-tested
    ├── ai/       prompt builders and response parsers             ← pure, unit-tested
    ├── editor/   editing surface, selection, normalisation, decorations
    ├── features/ alternatives, panel, ghost, overflow, menu, lab, source view, sharing
    └── fx/       sound, explosions
```

**Why this split.** Everything that decides what the document *is* lives in pure modules
with no DOM, so it can be tested in Node in milliseconds. Everything that touches
`contenteditable` is thin and sits on top. The shell knows nothing about writing; it does
files, windows, secrets and network.

**The page never sees the API key.** It asks the shell to run a request and receives
text. The web view loads only the bundled page and refuses every other navigation;
external links open in the default browser.

**Bridge.** Page to shell: `doc.state`, `file.save`, `file.open`, `draft.write`,
`ai.start`, `ai.cancel`, `clipboard.write`, `url.open`, `settings.get`. Shell to page:
`menu.command`, `file.opened`, `ai.delta`, `ai.done`, `ai.error`.

**Build.** This Mac has the Command Line Tools but no Xcode, so the app is a Swift
package built with `swift build`, and a script assembles and ad-hoc signs
`Write_On.app` (Info.plist, resources, fonts, icon). Minimum macOS 13.

### 7.1 LunaRoute

Verified against the live gateway on 2026-10-11:

- Base URL `https://gw.lunaroute.com/v1`, OpenAI-compatible. `glm-5.3-flash` is listed,
  with chat completions, streaming and JSON-schema output.
- With default reasoning a five-word request takes 2–4 s and the answer arrives all at
  once at the end. With `"reasoning_effort": "low"` it takes 0.5–0.65 s. Alternatives
  therefore use `low`. Lab passes start at `low` and are raised if quality testing during
  implementation shows the cuts are poor.
- Alternatives stream as one suggestion per line. Lab passes use JSON-schema output,
  which was tested: a small trim request returned valid JSON in 1.4 s. At `low` it cut
  about twice the requested amount and left one clumsy sentence, which is why Lab
  reasoning is expected to go up and why the trim contract in §6.10 checks the result
  rather than trusting it.

**Key lookup**, in order: a key saved in the Keychain from Settings; `LUNAROUTE_API_KEY`
in the app's own environment; `LUNAROUTE_API_KEY` read once from the user's login shell
(apps launched from Finder do not inherit shell variables, so a key set in `~/.zshrc`
would otherwise go unfound). A key found in the environment is held in memory only and never written
anywhere. Base URL and model follow the same pattern (`LUNAROUTE_BASE_URL`; default
model `glm-5.3-flash`) and can be changed in Settings.

**Settings window** (⌘,): API key, base URL, model, a "Test connection" button that
reports where the key came from, and the sound toggle. Nothing else.

## 8. Errors

| Situation | Behaviour |
| --- | --- |
| No API key | AI commands show one line in place: "No LunaRoute key — add one in Settings (⌘,)". Nothing else is blocked. |
| Network or gateway error, timeout (20 s) | The pending animation stops, a one-line reason shows for a few seconds, the document is untouched. |
| AI returns text it was not asked for | Lines that are empty, duplicate an existing variant, or (for Lab) do not occur verbatim in the document are discarded. If nothing usable remains it is treated as an error. |
| File cannot be read or written | A standard alert with the system's reason. The document stays open and unsaved. |
| File has a damaged metadata comment | Opens as plain Markdown; a one-line note says the alternatives could not be read. The file is not modified until the user saves. |
| Crash or forced quit | On next launch the snapshot is offered as an unsaved document. |

## 9. Inferred behaviour

None of this is shown in the clips. Each item is a decision made here; say if any should
go another way.

| # | Area | Decision |
| --- | --- | --- |
| 1 | Keyboard icon | Opens a card listing the shortcuts in §6.13. |
| 2 | "The Lab guide…" | Opens a card with a two-sentence explanation of each idea. |
| 3 | "Walk through" | Steps through the proposal one passage at a time with Cut / Keep / Stop, showing "3 of 9". |
| 4 | "Mark…" passes | Marked passages get a `lab`-coloured underline; hovering shows a short reason; clicking a mark dismisses it; "Done" clears them. Never saved. |
| 5 | "Fix punctuation and typos" | Proposed fixes are marked the same way, with the correction shown on hover. Card buttons: "Fix all", "Walk through", "Done". Clicking a mark keeps the original. |
| 6 | Stash with no selection | Moves the whole paragraph at the caret. |
| 7 | Where stashed text lands | Appended to the end of Overflow. |
| 8 | Ctrl+Return in Overflow | Moves text into the page (rather than copying it). |
| 9 | Post to X | Opens X's compose window with the text; does not use the X API. Ghosted text is left out. |
| 10 | Save icon colour | Accent means unsaved changes. Saving is always explicit. (The file-format clip hints the original may autosave once a file exists.) |
| 11 | Scope of a selection | The rules in §6.5. |
| 12 | Suggestions per AI request | Five for words (observed), three for sentences and paragraphs. |
| 13 | Groups do not nest | §5.1. |
| 14 | Hover guard | §6.3; the original may cycle on any hover. |
| 15 | Heading entry | Typing `# ` converts the line; the marker is hidden. Only the hidden marker is observed. |
| 16 | Spelling, autocorrect, smart quotes | Off by default. |
| 17 | Several windows | ⌘N opens another window; each window is one document. The original shows one. |
| 18 | Settings window | Exists only for the LunaRoute key, URL, model and sound. |
| 19 | Sample document | An original short piece that carries one group of each scope, a ghost run and some overflow, and tells the reader to click the word count. |
| 20 | App identity | Display name "Write_On"; bundle id `com.thesimhons.writeon`. |
| 21 | Ghost text in the saved Markdown | Written as ordinary text; the ghost marking lives only in the metadata. |
| 22 | Whole-document character count | Characters of every block, spaces included, line breaks and the hidden heading marker excluded. (Only the selection readout could be checked exactly.) |
| 23 | Trim tidy-up | The mechanical whitespace and capital fixes in §6.10 after "Make the cuts". |
| 24 | Arrow keys while hovering | → and ↓ go forward, ← and ↑ go back. The clips show both directions and wrap-around, not which key is which. |
| 25 | Panel details | Clicking a tab retargets at that scope; ↑ / ↓ do not wrap; a group cannot be deleted down to nothing. |
| 26 | Lab popover while a proposal is pending | The pending level is highlighted; choosing "Original" dismisses it, like "Done". |
| 27 | Source view details | "As saved" reflects the document as it would be saved now; "Copy" copies the tab that is showing. |
| 28 | Read mode details | Feature shortcuts leave Read mode; the mode is remembered between launches. |
| 29 | Ghost with no selection | Applies to the word at the caret, like the alternatives commands. |
| 30 | Mac shell additions | Blended title bar, menu bar with ⌘ equivalents, Save As, Open Recent, unsaved-changes prompt, crash snapshots, file name suggested from the first heading, a sound toggle. None of these are in the clips. |
| 31 | Error presentation | Everything in §8. |

## 10. Verification

1. **Unit tests** (Node's built-in runner) on the pure modules: file format round-trips,
   including the structure in the author's clip; opening files edited elsewhere;
   normalisation; scope detection; sentence and word boundaries; article agreement; the
   tone rule replayed against the tick sequences recorded from the clips; history;
   prompt building and response parsing, including hostile responses.
2. **Scripted UI runs in the real web view.** A debug-only harness launches the app,
   drives a scenario and writes PNG snapshots of the page. Scenarios follow the clips:
   read mode, each scope's marks, hover-cycling, the panel, `??`, ghost, overflow, the
   context menu, the Lab popover, a trim, the source view. Snapshots are compared with
   the corresponding frames for position, size and colour. The reference frames stay out
   of the repository.
3. **Sound.** Each sound is rendered offline to a WAV and put through the same analysis
   used on the clips. Pass: tick frequencies within 5 Hz, envelope times within 20%.
4. **Live AI smoke test** against LunaRoute for alternatives at each scope and for one
   trim, plus the same flows against a canned provider so tests run without a network.
5. **Hands-on pass** with a real mouse and keyboard, following the main clip from start
   to finish. The page is driven this way in a browser during development. The built app
   comes with a short checklist for the things only a person at the Mac can confirm:
   real hover in the app window, pointer hiding, drag from Overflow, the LinkedIn chase,
   and how it sounds.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| `contenteditable` edge cases: splitting and merging paragraphs through groups, input methods, drag and drop | One normalisation pass after every input; group invariants unit-tested; scripted editing scenarios. |
| WebKit maps some Control keys to Emacs-style editing (Ctrl+O inserts a line) | The page handles its shortcuts on key-down and cancels the default; covered by a scripted run. |
| This Mac's display is 1× while the clips are 2× | Geometry is compared in CSS px; glyphs look lighter at 1×. For a pixel-level comparison the page is snapshotted at 2× zoom. |
| `glm-5.3-flash` at low reasoning may choose poor cuts or miss the target length | Raise reasoning for Lab passes only; the card always reports the real numbers. |
| The handwriting face may not be Caveat | Compare glyphs early; substitute and record. |
| The original may differ wherever §9 guesses | All guesses are in one table and cheap to change. |
