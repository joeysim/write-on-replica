# Write_On for macOS — replica design

- **Date:** 2026-10-11
- **Status:** Built. Kept in step with the app since; §9 lists what the clips left to be decided.
- **Source:** Jason Fried's post on X and the thread under it, <https://x.com/jasonfried/status/2105403067793584590>

## 1. Goal

Build a macOS app that reproduces Write_On, the writing tool Jason Fried demonstrated, as
closely as the published material allows: same layout, colours, type, motion, sounds, file
format and behaviour.

**Success looks like this.** Put the app next to the videos and run the same steps. The
screen looks the same, the ticks and booms sound the same, the same things happen. A file
saved by the app has the structure shown in his file-format clip. The AI features work
against LunaRoute with `glm-5.3-flash`.

**Decisions made at the start**

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
- Notarisation or distribution. The app is built and ad-hoc signed on the Mac that runs it.

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
| `popover` | `#121522` | Context menu, Lab popover, trim card, source view |
| `popover-edge` | `#232735` | The hairline around them |
| `dim-icon` | `#635b62` | Inactive icons |
| `lit-icon` | `text` at 56% | An icon under the pointer |
| `dim-text` | `#857b82` | Inactive tabs, inactive rows, shortcut labels, hints |
| `edge` | `#1f2334` | The hairline at the edge of a panel |
| `faint` | `#26293c` | Word count |
| `faint-lit` | `#575763` | Word count under the pointer |
| `tip` | `#5a5b6a` | Shortcut tooltips |
| `lab-label`, `lab-dash` | `#847c83`, `#605f69` | The LAB button's letters and dashed outline |
| `selection` | `accent` at 28% | Text selection |
| `hover` | `rgb(152, 168, 226)` at 10% | Hover highlight on a group |
| `word-line` | `accent` at 50% | Word-scope underline |
| `sentence-line` | `sentence-dot` at 45% | Sentence-scope underline |
| `sentence-dot` | `#c29abe` | Sentence-scope active dot |
| `paragraph-bar` | `#805448` | Paragraph-scope margin bar |
| `paragraph-dot` | `#c88d6c` | Paragraph-scope active dot |
| `ring` | `#6c6879` | The dots of variants that are not showing |
| `lab` | `#c81042` | Scan line, Lab marks |

Opacity states: ghost text 11%; paragraphs other than the panel's target 35%.

### 4.2 Type

- **Editor:** IBM Plex Mono, 20 px, weight 400; headings weight 700 at the same size,
  with antialiased smoothing (measured stroke weights match the clips to within 6%).
  Character advance 12.00 px.
- **Line pitch:** the clips average 36.40 px, with lines landing on alternate half
  pixels, which is how a Chromium-based app lays out a fractional line height. WebKit
  places line boxes on whole pixels, so the app uses 36 px. The first line sits exactly
  where the clips have it; each line after it is 0.4 px higher than in the clips. The
  alternative, scaling the whole page by 1.011, would soften the text on a 1× display.
- **Panels and menus:** IBM Plex Mono at 15 px (panel rows, overflow text), 13 px (menus,
  Lab), 12 px (trim card), 10 px (hints).
- **Small labels are letter-spaced.** Word count 10.72 px with 0.055 em; tooltips 9.92 px
  with 0.045 em; "LAB" 10 px with 1.74 px; "XYZ" 10 px bold, unspaced. (Cap height and
  character pitch were measured separately in the clips; these are the sizes that satisfy
  both.)
- **Labels:** Caveat, 20.2 px, for the panel tabs ("Word", "Sentence", "Paragraph"),
  "Overflow", "As saved", "Readable" and "Copy". Compared word by word with the clip at 2x
  (the three tabs and "Overflow"): widths and heights agree to about a quarter of a pixel.
- Both families are OFL-licensed and bundled with their licence files.

### 4.3 Page layout

- Text column: 780 px wide (65 characters), centred. It does not move when panels open.
- Top padding 18vh (175.7 px at 976) plus the 0.85 px that puts the first text baseline
  at 237.5 px, as measured; bottom padding 45vh.
- The text is masked near the top and bottom edges of the page so lines dissolve rather
  than collide with the chrome: invisible within 53 px of either edge, rising linearly to
  full strength at 96 px.
- The caret is never left in that fade. When the page scrolls to follow it (arrowing,
  typing past the bottom), it stops with the caret's line clear of the faded bands: at
  least 132 px from the top of the window and 168 px from the bottom.
- The top row of chrome is centred 32 px from the top; the bottom row 32 px from the bottom.

| Element | Position (1548×976) | Notes |
| --- | --- | --- |
| Word count | left 24 px, top row | "535 words 3115 chars"; with a selection "34 words 182 chars selected", and one of either is singular: "1 word 1 char selected". Words are whitespace-separated; chars include spaces (both readouts in the clips check out against the selected text). Lights up under the pointer. |
| Alternates toggle | centre (753, 32) | Three 7 px dots (ring, disc, ring) over a 24.4 px bar; accent when on |
| Source icon | centre (795, 32) | "M↓" in a 24.45 × 16.95 rounded rectangle |
| Keyboard icon | centre (1513, 32) | Same rectangle; rows of four and five dots over a bar |
| Save, Open, X, LinkedIn | centres at x = 31, 65.5, 101, 136, y = 944 | 16.9 px of ink each, 1.7 px strokes; X is the solid logo |
| LAB | 45.4 × 26 at (751.4, 937) | 1 px dashed outline, radius 5, dashes of 3 with gaps of 2; letter-spaced caps |
| Overflow toggle | centre (1513, 944) | "XYZ" in the same rounded rectangle; accent when open |

Icon geometry was measured from the frames to about a twentieth of a pixel and is drawn as
inline SVG. WebKit paints an inline SVG from a whole pixel, so each control is laid out on
whole pixels and any half pixel in a drawing's position is written into the drawing.

An icon brightens under the pointer, and one that has a shortcut shows it in a small label
centred 25.5 px above the icon's middle, kept 22 px inside the window's edge. Labels seen
in the clips: "Ctrl+S", "Ctrl+O", "Ctrl+Shift+P", "Ctrl+Shift+D". The label stays for as
long as the pointer rests on the control, through a press on it.

### 4.4 Window

A standard macOS window, default content size 1548×976, with the title bar blended into the
page colour and the title text hidden. The traffic lights remain. Page content starts below
the title bar, so every control is clickable and the layout inside the page matches the
video. In full screen the title bar disappears and the match is exact.

The window goes down to 720×480. The text column keeps its 780 px wherever there is room
and narrows where there is not, leaving 44 px either side for the marks that stand beside
the text.

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
- Ids are seven random base-36 characters, e.g. `h00a0dg`. Read from a file, an id is
  taken only if it is one to sixteen lower-case letters and digits; a mark with any other
  id is read as plain text, and the file's note says so (§6.11).

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

The keyboard is in the text from the moment a window opens, with the caret at the start
of the piece, so a new window can be typed in without a click. A press on the bare page
beside the column or below the piece goes to the text: the caret lands at the nearer end
of the line the press is level with, at the end of the piece from below it, at its start
from above.

### 5.3 Undo

One history for the whole document: text, groups, ghost runs and overflow together.
Typing is coalesced into bursts. Each command is one step: adding an AI batch, deleting an
alternative, ghosting, stashing, making trim cuts. ⌘Z / ⇧⌘Z, and Ctrl+Z / Ctrl+Shift+Z.

A paragraph an edit did not touch is the same object before and after it. A step
therefore holds only the paragraphs that changed, and whatever is worked out per
paragraph (how it is drawn, its word count) is worked out once, however long the piece.

## 6. Features

### 6.1 Read mode and the alternates toggle

- **Read mode** is the launch state: only the text and the word count are visible. Chrome,
  panels, underlines, dots and margin bars are hidden; hover-cycling and the custom
  context menu are off. Ghost text stays dim, because that is content, not chrome.
- Clicking the word count, or Ctrl+Shift+R, toggles Read mode. The word count's tooltip
  is "Read (Ctrl+Shift+R)". The chrome and the marks are there at once: in the clip every
  icon and mark is at full strength in the frame after the click.
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
| Thickness | 1.3 px | 1.2 px | 2 px |
| Position | 3.8 px below the baseline | 9.8 px below the baseline | 19.1 px left of the text, from 16.75 px above the first baseline to 2.4 px below the last |
| Dots | Under the line, centred on the word, 7.9 px below the baseline | Inline at the right end, 0.75 px above the line; the line stops 3 px short of them | Stacked top to bottom around the bar's middle, 5.65 px to its left |
| Active dot | Filled `accent` | Filled `sentence-dot` | Filled `paragraph-dot` |

- One dot per variant, in variant order. 3 px diameter, 5 px pitch. The active one is
  filled; the rest are rings in `ring`, their line one pixel of the display thick: 0.5 px
  on the 2x display of the clips, 1 px on a display with one pixel to the px.
- Each dot is seated on the display's own pixels, its edges on pixel edges. The positions
  below are where the clips have them; a dot is drawn at the nearest such seat, at most
  half a display pixel away. (Drawn between pixels a 3 px dot is smeared into its
  neighbours; on a 1x display the rings could not be seen at all.)
- Each dot sits at the start of a 5 px cell (3 px of dot, 2 px of air). A word's row of
  cells is centred under the word, so the dots themselves sit 1 px left of centre; a
  sentence's row ends at the end of its text, so the last dot ends 2 px before it.
- The lines are drawn like an editor's pen: a slow wobble of about ±0.3 px over roughly
  100 px, a slight tilt, and a stroke that fades in as the pen touches down and out as it
  lifts. The wobble is seeded from the group id, so a given line always looks the same.
- The marks are drawn above the text, so a selection does not cover them.
- An underline that wraps continues on each line. Sentence dots sit at the very end;
  word dots centre under the last line of the wrapped phrase.

### 6.3 Cycling in place

- Hovering a group tints it with `hover`. A word or sentence is tinted from the top of its
  line of text to just under its underline (9.3 px below the baseline for a word, 13 px
  for a sentence), and the two ends of the tint fade out over 8 px (word) or about 13 px
  (sentence). For a paragraph group the whole block tints, with 4 px corners. The
  underlines are translucent, so they brighten over the tint.
- While hovering, **→ or ↓** shows the next variant and **← or ↑** the previous, wrapping
  at the ends. The new text arrives with a ~150 ms blur-and-fade and the line reflows.
  The mouse pointer may hide; cycling keeps working.
- **The caret.** A caret in the group, or at its edge, goes to the end of the new text,
  and so does the caret when the text had none. A caret anywhere else stays among the
  words it was in: in the clip eight flips of "tension" leave the caret resting in
  "obvious", later in the same paragraph.
- **Not a step to undo.** Which variant shows is the state of the document, not an edit to
  it. In the clip three suggestions are tried in turn and one undo then takes the whole
  batch away. The one exception is a flip that would lose something: words of the showing
  variant that are ghosted. That flip is a step, so that undo has them back.
- **Delete or Backspace** while hovering removes the variant that is showing, with an
  explosion (§6.12), and shows the next one. Undo brings it back with a small reverse
  burst and a thump. A group cannot be reduced below one variant this way.
- **Article agreement.** For word scope, an "a" or "an" directly before the group follows
  the new variant: "like a thumbtack" becomes "like an eraser". Capitalisation of the
  article is preserved. A short exception list covers silent h and "you"-sounds.
- **Whose the keys are.** The arrows belong to the group under the pointer for as long as
  the pointer is what the writer last used: it has moved, pressed, or turned its wheel
  since the last character was typed. A click on the group leaves them the group's; so
  does text changing under a pointer at rest (a shorter variant can leave the pointer
  beside its word, and the next arrow still flips it). Typing, and any key with a modifier
  held, gives the arrows back to the caret until the pointer moves again, however little.
  The tint says which it is: a tinted group will flip, and the tint goes when the keys do.
- **The page moving under the pointer.** When the page scrolls under a pointer at rest
  (the caret walked down a long piece, a line typed past the bottom), what was under the
  pointer is no longer hovered, and what arrives under it is not armed until the pointer
  moves: the arrows stay the caret's. Scrolling with the pointer's own wheel is the pointer
  at work, and what it brings under itself is hovered and armed.
- **Delete is more careful.** Delete and Backspace blow up a variant only while the writer
  is looking through them: the pointer has come onto the group, or an arrow has just
  flipped it, with no press and no typing since. After a click into the text they delete
  text, as anywhere.
- With text selected the keys are the text's for that press, whatever the pointer rests
  on: an arrow closes the selection up, Delete removes what is selected.

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

A 280 px panel (279 px and a hairline) that slides in from the left over the margin in
200 ms on the browser's default curve (`ease`); the clip's frames fit that to within 2 px,
opening and closing. The text column does not move; the word count and the bottom-left
icons stay in view over it. Going into Read mode closes it.

- **Opening.** Right-click ▸ "Alternatives for selection" / "Alternatives for “word”", or
  Ctrl+Shift+A. With no selection the target is the word at the caret, whatever the
  pointer is on: in the clip the pointer rests on "tension", the caret is in "obvious",
  and the panel opens on "obvious". When the caret is on no word (the blank first line a
  window opens on), or the text has no caret (the keyboard is somewhere else), the target
  is the group or the word the pointer is resting on. Ctrl+Shift+G goes by the same rule.
- **Scope of a selection.** A whole multi-sentence paragraph is `paragraph`; one or more
  complete sentences (including a heading) is `sentence`; anything else is `word`, which
  also covers short phrases such as "tough stuff". A selection that crosses paragraphs
  cannot become a group; the menu item is dimmed.
- **Tabs** "Word · Sentence · Paragraph" show the target's scope. Clicking another tab
  retargets to the word, sentence or paragraph around the same spot.
- **While open,** the target itself stays at full strength, the rest of its paragraph
  drops to 66% and every other paragraph to 36%. Only the text dims; underlines, dots and
  bars keep their strength. The target shows its scope's underline even before it has
  alternatives. Clicking a word in the page retargets the panel to it, silently.
- **Rows.** One per variant: a marker and editable text, 15 px, 31.8 px apart, the first
  on the line of the page's first text. The active row is full-strength text with an
  accent marker; the rest are `dim-text`. Markers: a 3 px square for the user's variants
  (a 6 px dot when active), a robot head for AI variants. A long variant wraps.
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
- A batch is one undo step. Undoing it removes all of its rows and leaves the list as it
  was before the asking: for a word that had no alternatives, the word and an empty row
  with the caret in it. The "?" typed on the way to "??" is never an alternative and
  leaves no step behind.
- **The empty row is a step.** A second undo, in the clip, takes the empty row and nothing
  else: the word stays underlined and the panel stays on it. So each empty row the panel
  opens (on a new target, on Return) is a step of its own that changes nothing in the
  document. The steps go with the list: when the panel lets the target go they are
  forgotten, and looking at a word leaves nothing to undo.
- **Dots follow the list.** While the panel is on a group, the word in the page has a dot
  for every row of the list: the empty row, the row that is asking, each suggestion as it
  lands. (Two under a new target, 3, 5, 7 as a batch arrives.)
- When the panel takes another target its rows come up from dark over 0.13 s. The pointer
  is an I-beam over a row's words and an arrow beside them.
- Failure (no key, network, bad response): the `??` row stops dancing and shakes once,
  the footer shows a one-line reason for a few seconds, and nothing else changes.

### 6.7 Ghost

- Select text, then right-click ▸ "Ghost it" or Ctrl+/. With no selection it applies to
  the word at the caret. The text drops to 11% at once, with no transition, and stays in
  the flow.
- The selection is kept, and is dimmed along with the words it lies on. In the clip that
  is the faint highlight left over the passage after ghosting: it is there from the frame
  the text dims, unchanged for three seconds, and gone on the frame of the next click,
  when the word count stops reading "selected". There is no separate flash.
- With the caret or selection in ghosted text the command reads "Revive it" and restores
  every ghost run it touches, each of them whole and at once. In the clip a right-click
  inside a four-line ghosted passage, with nothing selected, brings back all of it.
- Ghosted text remains editable and is counted in the word count.

### 6.8 Overflow

- The same 280 px panel (279 px and a hairline) down the right of the window, toggled by
  the "XYZ" button or Ctrl+Shift+D, sliding as the alternatives panel does. Header
  "Overflow" where the other panel has its tabs. A plain editable text area, 15 px, 26
  characters wide, starting 22 px inside the hairline; its caret is the accent colour.
  Footer hint "ctrl+↵ or drag into the page to use". The page neither moves nor dims, and
  the keyboard icon and the "XYZ" button stay in reach over the panel.
- The clip sets the lines of that text 23 and 22 px apart by turns (22.5 px, each line
  snapped to a whole pixel). WebKit sets every line of a field the same whole number of
  pixels apart, so the replica uses 22 px, as the alternatives panel's rows do; the first
  line is where the clip has it and a paragraph of eight lines ends 4 px higher.
- The return arrow in the hint is drawn. IBM Plex Mono has no such glyph, and the clip's
  (a thin stem and bar with an open head, one character wide) comes from a font macOS does
  not ship; it was traced from the clip to within a quarter of a pixel.
- In Read mode the panel steps out of sight without being closed, and is back when the
  tools are. Asking for it while it is put away (Ctrl+Shift+D) brings it back.
- Its text is part of the document: it is saved with it and its edits are steps in the
  one history, so undo works the same with the caret in the panel.
- **Stash:** right-click ▸ "Stash this in Overflow", or Ctrl+Shift+X, moves the selection
  out of the page and appends it to Overflow as its own paragraph, opening the panel and
  scrolling it to the new paragraph. With no selection it moves the whole paragraph at
  the caret.
- **Use:** Ctrl+Return in Overflow moves the selection (or the paragraph at the caret)
  into the page at the page's last caret position. Dragging selected text from Overflow
  into the page moves it to where it is dropped. Either is one step to undo.

### 6.9 Context menu

Replaces the system menu outside Read mode. A dark rounded card, 376 × 136 px with its
corner at the pointer (12 px radius, hairline edge), holding four 31 px rows: a label on
the left and its shortcut, dimmer, on the right, in 13 px type set 15 px in. The row
under the pointer is a lighter band with 8 px corners. The first row is lit as the menu
opens, before the pointer is on any, and the row last pointed at stays lit when the
pointer leaves the menu (both as in the clip).

A right-click inside the selection is about the selection. Anywhere else it puts the
caret there and is about the word under it; inside an existing group, about that group.

| With a selection | With no selection |
| --- | --- |
| Alternatives for selection — Ctrl+Shift+A | Alternatives for “word” — Ctrl+Shift+A |
| AI alternatives for selection — Ctrl+Shift+G | AI alternatives for “word” — Ctrl+Shift+G |
| Ghost it / Revive it — Ctrl+/ | Ghost it / Revive it — Ctrl+/ |
| Stash this in Overflow — Ctrl+Shift+X | Stash this in Overflow — Ctrl+Shift+X |

### 6.10 The Lab

The dashed "LAB" button opens a popover that stands on the button's bottom edge and
covers it: 620 × 327 px, centred. It opens outwards from the button, a reveal that takes
about 270 ms and slows as it goes; its shadow arrives when the reveal is over. It closes
the same way in reverse, faster and fading.

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

The first line is lit when the popover opens; the line under the pointer is lit, and
stays lit while the pointer is on the trims below. "Original" is outlined in the accent
colour while nothing is proposed; otherwise the level that is.

**Trims** (observed in full, except "Make the cuts" and "Walk through", which are only
pointed at):

1. Choosing a trim closes the popover and at once shows a card at the bottom centre,
   500 × 88 px, 55 px above the bottom of the window: "**Slight trim** Reading…", then
   "Faded words would go. Click one to keep it.", with buttons "Make the cuts" and "Done".
2. While it reads, a crimson line the width of the text column sweeps down each block of
   text in turn, the heading included, 300 ms to a block whatever its height, at a steady
   speed from its top to its bottom.
3. When the answer arrives the proposed cuts drop, in one frame, to 22% where they stand:
   twice the strength of ghosted text (the clip measures 0.226 against ghost's 0.112).
   The card's first line becomes "**Slight trim** 535 → 480 words · −10%" and a "Walk
   through" button appears between the other two. The card is now wider than its words
   need: 601.5 px for "Slight trim", 608.5 px for "Tighten more". Nothing visible in the
   clip accounts for that width, so the replica takes it as measured, 7 px for each
   further letter in the name.
4. Clicking a faded passage keeps it. "Make the cuts" deletes what is still faded, as one
   undo step. "Done" dismisses the proposal and the text returns to normal.
5. Choosing another level replaces the pending proposal. "Original" is highlighted when
   nothing is pending.
6. **The cuts arrive with the answer.** The answer is every sentence over again and takes
   a while to come. What the sentences that have arrived could lose is faded while the
   card still reads "Reading…", and "Walk through" joins the other buttons with the first
   of them, as in the clip. Nothing can be cut or walked until the whole answer is in:
   only then can the amount be counted (below), and what is faded becomes what the level
   comes to.
7. **One answer, every level.** In the clip "Tighten more", chosen twenty seconds after
   "Slight trim" was read, is there at once: no reading, no line through the text. The
   model is asked once, whichever level is chosen first, and all four are counted out
   from what it says; the answer is kept until the piece changes. Done, Original or
   another pass calls off an answer still on its way, and nothing is kept of one that
   never came.

A proposal is temporary. It is not saved to the file and is not ghost text: it is drawn
at twice ghost's strength and lives beside the document, not in it. Text the user has
already ghosted is treated as already out: it is not offered for cutting and is left out
of both word counts on the card. Headings are not offered either, though their words are
counted. A cut inside an alternative group edits that group's active variant; a cut that
removes all of it removes the group. Any change to the document while a pass is out
(an edit, an undo, a redo) puts the pass away, since it was about the text as it was.

After "Make the cuts" the app does only mechanical tidying: collapse doubled spaces,
remove a space left before punctuation, and capitalise a sentence whose first words were
cut. A paragraph left with nothing goes, and a blank line with it, so that the paragraphs
around it stay one blank line apart. The tidying is done in the paragraph as it stands
on the page, ghosted words and all: they are left a space from what remains either side
of them, and no space is left at the end of the paragraph. It changes no other words,
and that does not rest on the answer being well formed: nothing outside a faded passage
is ever removed but a space beside one, and of a word that now starts a sentence only
the capital of its first letter is taken from the AI, never its spelling or its
apostrophe.

**How much a trim takes** is counted by the app, not the model. The model says of every
sentence what words it could lose and, from 1 to 5, how much the piece needs it (the
contract is below). A level then takes its tenth, fifth, 30% or half of the words the
card counts, by stages:

1. what sentences could lose, and any sentence the piece is "better without" (1);
2. then whole sentences of which "little would be lost" (2);
3. then those that "add something, but the piece stands without" (3);
4. then those the piece "would be poorer without" (4).

Each stage is taken whole while the amount allows. Of the stage it runs out in, as much
is taken as comes nearest, evenly from first sentence to last, so the cuts are spread
through the piece and the count lands within about half a sentence of what was asked;
and nothing is taken of the stages after it, so no sentence goes while one the piece
needs less still stands. Where that would leave a level with nothing, because the least
there is to take is more than it asked for, it takes that: a level is empty only when
the answer gives it nothing to cut. If everything up to the fourth stage is still short,
the card says what it came to. A paragraph may go whole; the piece may not, and a
sentence that may not go for that reason can still lose its padding.

A sentence the piece "does not work without" (5) goes only in "Cut in half": to halve a
piece, something it needs may have to go. There it goes last, to make up what the four
stages could not, and only where the whole of it is still wanted, so the count is never
carried past what was asked for its sake. The lighter levels never take one. (The model
is asked to say this of one sentence in three at most. Of the welcome piece's fifteen
it once said it of eight, and "Cut in half" came to 29%, which is why the rule is not
"never".)

Each level holds everything the lighter ones take: "Tighten more" is "Slight trim" and
more. It is reached by going through the lighter amounts first, each adding to the last.

While the answer is still arriving nothing can be counted, so what fades meanwhile is
judged a sentence at a time, to a depth of one stage for "Slight trim", two for "Tighten
more" and three for the others: a passage once faded is not unfaded by what arrives
after it, only by the count at the end.

This is the second way trims were asked for, and the reason is measured. At first each
level was a request of its own: cut the piece from so many words to so many, and send
the paragraphs back. `glm-5.3-flash` reasoned its way to the number, counting words one
at a time. On the 170-word welcome piece that took 24 to 131 seconds a level; on a
498-word draft "Slight trim" took 39 s and came to 7%, "Tighten more" 142 s, "Even
sharper" had not answered after five minutes, and "Cut in half" took 208 s and came to
8%, the model's own answer being 13% short of half and three of its eight paragraphs
refused for a changed word. Asked the present way the same model answers the same draft
in 8 to 25 seconds, mostly without thinking at all, and the four levels come to 10, 20,
30 and 50% (§7.1).

**Mark passes and the typo pass** are named in the video but not run, so their results
are inferred (§9 items 4 and 5): the same card and scan line, with marked passages
underlined in `lab` at full strength, and a small label by the passage under the pointer
giving the reason, or for a typo the fix ("Teh → The · Misspelt."). They are passes like a
trim: only one is out at a time, a new one puts the last away, and so does any change to
the document.

**AI contract.** Each pass sends the document as numbered paragraphs and gets back a
fixed JSON shape. What the app accepts is narrow by construction:

- **Trims:** the piece is offered a sentence at a time, numbered through, with a blank
  line between paragraphs. For every sentence the AI returns the sentence with what it
  could lose removed, and how much the piece needs it at all, from 1 to 5. The app
  compares each with the original and accepts what the sentence could lose only if the
  result can be reached by deletion alone (a change of capital at a new sentence start
  is allowed). A sentence that was reworded loses nothing, though it may still go
  whole. What is proposed is chosen from this by the app (above). The AI is not told
  how much to cut. A long list of numbers is easily miscounted, so the numbers are
  checked against the words: where fewer than half of what comes back are their own
  sentences with words deleted, and reading every number as so many too high or too low
  (up to six) explains at least two of them and more than twice as many, they are read
  that way. One sentence that could pass for its neighbour moves nothing. An answer
  that speaks of fewer than half the sentences is asked for once more; a second such is
  used as it is.
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
  normal file. Ghosted text is included as ordinary text. Blank lines at the top of the
  document are written as they stand (the clip's "As saved" view begins with the
  document's blank first line); blank lines at its end are not. Opening does not mind
  either way.
- `<!-- overflow -->` and everything after it up to the metadata comment is the overflow.
  It is omitted when overflow is empty.
- The `write_on` comment holds the editor state: `html` (one `<p>` per block, `<p><br></p>`
  for a blank line, headings as `<p># …</p>`, inline groups as `<span data-vid="id">`,
  paragraph groups as `<p data-vid="id">`, ghost runs as `<span data-ghost>`) and `groups`.
  `ai` appears only on groups that have AI variants. Inside the JSON, `-->` and `--!>`
  are written with an escaped `>`, so text can never close the comment early.
- A document with no groups and no ghost runs has nothing to record, so it is saved as
  plain Markdown with no metadata comment.
- **Opening.** If the comment is present and the text of its `html` equals the Markdown
  above it, the editor state is restored from it. If the Markdown was changed in another
  editor, the Markdown wins: a group is kept only where its active text can still be
  found in the same paragraph, and ghost marking is dropped. A file with no comment opens
  as plain Markdown.
- Save (Ctrl+S, ⌘S), Save As (⇧⌘S), Open (Ctrl+O, ⌘O), New (⌘N), Open Recent. A document
  with no file is offered the name of its first heading, less what a file name cannot
  hold and cut at a word to 80 characters, or "Untitled". The window goes by the same
  name until the document has a file, and then by the file's.
- The Save icon is accent while the document differs from its file, and follows it both
  ways: in the main clip it is grey whenever the heading shows the version that was
  saved. It changes 0.42 s after the change that decides it, over 0.13 s. The shell is
  told of a change at once, so a window closed in that moment still asks. A change taken
  back (undone, or typed out again as it was) dims it.
  The panel looking at a word is not a change: a group of one is never written (§5.1).
- A file opens in the window that already has it; failing that in a window nobody has
  written in (no file, no changes), in place of what is there; failing that in a window
  of its own. Files from Finder, the Dock and Open Recent go the same way. The app
  declares itself an editor of Markdown files without claiming to be the one that opens
  them all.
- What a file could not give (a damaged record, text changed elsewhere, §8) is said in
  one line by the Open icon, the way a control's note is (see Post to X below). A file
  that is not UTF-8 is read all the same, UTF-16 by its mark and anything else as
  Latin-1, and is saved as UTF-8.
- Saving replaces the file's text and nothing else: its permissions and what Finder has
  attached to it (tags, comments) stay, and a link stays a link to the file written.
- A file that something else has changed since this window read or wrote it is not
  written over unasked: saving says so and offers Cancel or Save Anyway.
- Closing or quitting with unsaved changes asks first: Save, Cancel, Don't Save. One
  question at a time: while a panel or alert about a document is up, saving it again
  waits, and so does a second Open panel.
- Unsaved work is copied to Application Support (`Write_On/Drafts`) within three seconds
  of a change. The copy goes when the document is saved, taken back to what was saved, or
  let go. After a crash each copy comes back at the next launch as an unsaved document,
  with a note by the Save icon, and saving it starts from the name and folder it had. If
  only the page fails, it starts over from the copy.
- A new window is a blank page. The first window the app ever opens has the welcome
  piece instead (§9 item 19), and Help ▸ The Welcome Piece opens it again.

**Source view** (Ctrl+U, or the M↓ icon): a card over the page, 900 px wide and 70 px
clear of the top and bottom of the window. The page behind is not dimmed: in the clip the
ground and the icons measure the same with the card up as without it. The card has a
hairline edge, 7 px corners and a soft shadow that falls mostly below it.

- A 52 px header: tabs in the hand, accent for the one showing; on the right the byte
  count ("9,344 bytes", 13 px, dim) and "Copy". The clip's tabs are "As saved" and
  "Readable", 16.5 px apart. The replica puts a third ahead of them, "Markdown", the same
  distance from the next (see below).
- Under it the file scrolls: 13 px type, 22 px in from either side, nothing above its
  first line, and 16 px of card below the scrolling area.
- The clip's lines are 20.8 px apart (13 px at 1.6), each rounded to a device pixel.
  WebKit sets the lines of a block a whole number of pixels apart, so the text is set at
  21 px and each line of the file is made as tall as its lines would be at 20.8 px. Every
  paragraph then starts on the clip's pixel; inside a paragraph the third and fourth lines
  are half a pixel low.
- "As saved" shows exactly what Save would write. "Readable" pretty-prints the metadata,
  with the HTML unescaped one block per line, four spaces in and keeping that indent
  where it wraps, and jumps to it: the comment's first line lands just under 8 px below
  the top of the scrolling area.
- **"Markdown" is the replica's own** (§9 item 53): the piece as it reads now, for taking
  elsewhere. It is the document's lines with the version of each group that is showing,
  heading marks kept, and without what is not the piece: ghosted text (the gap it leaves
  closed up to one space, and a line with nothing else in it left out), Overflow, the
  `write_on` comment, and the blank lines at either end. No line has space at its ends
  and there is never more than one blank line together. It is the text Post to X sends, with the
  heading marks. Nothing in it is dimmed. With this tab showing the byte count is the
  size of what it shows, and "Copy" copies exactly that, with no line break added at the
  end. It is the tab the card opens on.
- Comment and metadata lines are dimmed; text, the overflow included, is full strength.
  Read-only. Esc closes.
- It comes back as it was left: on the same tab, at the same place in the file (the clip
  puts it away on Readable and brings it back there). Another document is looked at from
  the top.
- The page around the card still answers to the pointer: in the clip the Overflow button
  shows its shortcut with the card up, and one click on it swaps the card for Overflow. A
  press off the card puts it away and is still a press on whatever it lands on.

**Post to X** (X icon, Ctrl+Shift+P): opens X's compose window in the default browser
(`https://x.com/intent/post?text=…`) with the document text filled in, heading marker and
ghosted text removed. If the text is longer than 4,000 characters it is copied to the
clipboard instead and the compose window opens empty, with a note by the X icon saying
so: "Too long to fill in: it is on the clipboard, ready to paste." The same happens when
the link itself would run past 8,000 characters, which text outside the Latin alphabet
does much sooner: X's servers refuse a request much past 14,000 bytes (measured), and the
browser's own headers count towards that.

The note is the control's label put to another use (§4.3): in the colour of a lit
control, shown in Read mode too, for four seconds counted from when the window is next in
front, since the browser has just covered it. A press anywhere puts it away. If the
browser cannot be opened, the note says that instead. With no text on the page the
command does nothing. The shell will open that one address and no other.

**LinkedIn:** the fourth icon runs from the pointer. Whenever the pointer comes within
25 px of its middle it hops 90–120 px straight away from the pointer, give or take 10°,
turning aside rather than leave the window (its middle stays 18 px inside). The hop takes
280 ms on `cubic-bezier(0.35, 1.2, 0.2, 1.02)`, a quick start and a slight overshoot;
caught in the air it is off again from where it is. After six escapes the next approach
blows it up, with the explosion and boom. It stays gone until the next launch. It cannot
be reached from the keyboard, is hidden from assistive technology, shows no label, and
does not move in Read mode. These numbers are measured from the clip.

### 6.12 Sound and explosions

All sound is synthesised; there are no audio files.

| Sound | Recipe |
| --- | --- |
| High tick | Triangle wave, 1900 Hz. Gain 0 → 0.3 in 3 ms, then exponential decay, τ ≈ 4.7 ms. About 14 ms audible. |
| Low tick | The same at 1500 Hz. |
| Boom | Sine at a random 83–98 Hz, starting from ~230 Hz and dropping within 10 ms; peak 0.9, τ ≈ 70 ms. Plus a noise burst, mostly 1–3.5 kHz, that peaks at ~40 ms, τ ≈ 75 ms, gone by 300 ms. |
| Undo of a delete | Noise (1–3 kHz) rising for 140 ms and cut off, then a 98 Hz thump, peak 0.93, τ ≈ 55 ms. |

Explosion, drawn on a canvas over the page:

- 0 ms: white-yellow flash with a red-orange glow, ~45 px radius, and short white streaks.
- 50 ms: several fireballs (yellow-white core to orange), white spark lines, white debris.
- 100–300 ms: sparks reach ~145 px; debris falls under gravity; fire breaks into embers.
- 400 ms on: grey-brown smoke, gone by about 1.3 s.

For a deleted alternative the burst is stretched along the word, and the word itself
flies apart: at the first instant it stands there broken into 2 px pieces, which then
scatter, cooling from cream through yellow to orange. The next variant rises under the
fire over about 420 ms. A paragraph burns along every one of its lines. For the LinkedIn
icon the burst is centred on the icon.

Undo of such a delete runs the first 330 ms of the same burst backwards in 280 ms (what
an explosion leaves closes in to fire, then to the word in pieces) and the word then
blurs in; the thump's thud lands as the burst closes. Redo blows it up again.

Settings ▸ Play sounds turns sound off, in every window.

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

The menu bar holds every command, the page's under the Control shortcuts they have above:

| Menu | Items |
| --- | --- |
| File | New, Open…, Open Recent ▸ (newest first, Clear Menu), Close, Save…, Save As…, Post to X |
| Edit | Undo and Redo (the document's own history, §5.3), Cut, Copy, Paste, Delete, Select All, and the standard Spelling and Grammar ▸, Substitutions ▸ and Speech ▸ |
| View | Read Mode, Alternates, Overflow, Source, Enter Full Screen; the first three are ticked while on |
| Tools | Alternatives, AI Alternatives, Ghost or Revive, Stash in Overflow, The Lab |
| Window | Minimize, Zoom, Bring All to Front |
| Help | Keyboard Shortcuts, The Welcome Piece |

A command chosen from the menu does what its shortcut does, turning the tools on where
the shortcut would. Checking and correcting (spelling, grammar, autocorrection, smart
quotes and dashes, text replacement) are all off until turned on in the Edit menu, whatever
the system's own settings say; what is turned on there is remembered.

## 7. Architecture

```
Write_On.app
├── Native shell (Swift, AppKit)
│   ├── App            lifecycle, menu bar, open-file events
│   ├── DocumentWindow one per document: window, web view, file URL, dirty flag
│   ├── Bridge         typed request/reply and events between page and shell
│   ├── Files          open/save panels, reading and writing, recents, crash snapshots
│   ├── AIClient       asks LunaRoute, or the service named: streaming, cancellation, asking again
│   ├── AIWire         the two ways a service is spoken to: OpenAI's chat completions, Anthropic's messages
│   ├── Credentials    the key, the address, the format and the model: where each is found
│   ├── Assets         serves the bundled page on a private URL scheme
│   └── UITestHarness  runs a scripted scenario and writes snapshots (only when launched with --ui-test)
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
nothing the page does is handed to the browser. The one page the app opens there is X's
compose window, asked for by name and checked by the shell (§6.11).

**Bridge.** Page to shell: `doc.start` (what this window opens with), `doc.state`
(unsaved or not, the name, what the menu bar needs), `file.save`, `file.open`,
`draft.write`, `ai.start`, `ai.cancel`, `clipboard.write`, `browser.open`, `settings.get`,
`settings.set`. Shell to page: `menu.command`, `file.opened`, `ai.delta`, `ai.done`,
`ai.error`. The shell also asks the page one thing and waits for the answer: `save`, on
the way out of a window with unsaved changes.

An AI request is `ai.start { id, messages, maxTokens, effort, schema? }`. The answer comes
back as `ai.delta { id, text }` events while it streams, then `ai.done { id }`, or
`ai.error { id, message }` with one line a person can read. `ai.cancel { id }` calls it
off.

**Build.** The Command Line Tools are enough, without Xcode: the app is a Swift
package built with `swift build`, and a script assembles and ad-hoc signs
`Write_On.app` (Info.plist, resources, fonts, icon). Minimum macOS 13.

### 7.1 The AI service

The service is LunaRoute unless the person names another (below). Verified against the
live gateway on 2026-10-11:

- Base URL `https://gw.lunaroute.com/v1`, OpenAI-compatible. `glm-5.3-flash` is listed,
  with chat completions, streaming and JSON-schema output.
- With default reasoning a five-word request takes 2–4 s and the answer arrives all at
  once at the end. With `"reasoning_effort": "low"` it takes 0.5–0.65 s. Alternatives
  therefore use `low`. Live in the app: five words in 1.5–2.3 s, three versions of a
  sentence in 1.2 s.
- Alternatives stream as one suggestion per line. Lab passes use JSON-schema output;
  without the schema the model's JSON took other shapes and could not be read. The
  trim contract in §6.10 checks the result rather than trusting it.
- What the model thinks before it answers is counted against `max_tokens` along with
  the answer, and it may think a good deal even at `low`: a marking pass over 164 words
  for up to 400 tokens; alternatives for 1. So a Lab pass asks for its answer and room
  to think besides (a trim 2,000 tokens and 6 a word; the other passes 1,000 and 4 a
  word), up to 32,000 in all.
- Lab passes stay at `low`. **A trim is asked so that the model has nothing to count**
  (§6.10). The first way of asking gave it a number of words to cut to, a request for
  each level, and it reasoned its way there: to cut 570 words by a tenth it thought for
  1,300 to 3,300 tokens, by 30% for 6,300, at fifty tokens a second, and given only room
  for the answer it came back empty every time. A slight trim of the welcome piece then
  took 9 to 67 s, by the hour and the asking, and landed within a point or two of a
  tenth; the deeper levels and a longer draft did far worse (the figures are in §6.10),
  which is what was found when the app was first used on real writing, on 13 October.
  Asked by proportion it answered in 5 s and cut 2–4%; with thinking switched off it
  cut nothing. Other shapes of answer were tried that day against the service: passages
  quoted with a level each, or tagged in the text (fast, but about one deletion in six
  left a sentence broken, "The format was."); the paragraph cut up into parts (the
  full stops went with the cuts); one request for each paragraph (no faster in all,
  and the service refuses many at once). What held up was the model writing each
  sentence as it would read, so that it sees its own result, and the app doing the
  arithmetic. Live that way, through the app, on 13 October: the welcome piece read in
  4 to 26 s, mostly under 11, and the levels came to 9–11%, 18–22%, 28–33% and 48–52%;
  a 498-word draft
  read in 8 to 25 s, once in 58 s when the model thought first, and came to 10–11%,
  19–21%, 27–31% and 47–52%; and 1,575 words of the README's own prose, 85 sentences,
  read in 38 and 49 s and came to 10, 20, 30–31 and 50%. The first cuts fade about two
  seconds in, where a sentence has something to lose. Two things went wrong in some
  twenty askings, and each is now allowed for: one answer spoke of a single sentence
  and stopped, which is why a thin answer is asked for again; and one came back with
  each of 81 sentences under the number of the sentence four on, which is why a
  sentence is known by its words.
- While it thinks the stream keeps coming (the longest silence measured was 1.4 s), so
  the limit is on silence, not on the answer. The limit was 20 s until 13 October,
  when at a busy hour the same stream fell silent for 9 s, and for 18.5 s asked
  Anthropic's way (below). It is now 60 s.

**Key lookup**, in order: a key saved in the Keychain from Settings; the app's own
environment; the user's login shell, read once (apps launched from Finder do not inherit
shell variables, so a key set in `~/.zshrc` would otherwise go unfound). In the
environment and the shell the key is `WRITEON_API_KEY` or `LUNAROUTE_API_KEY`, the name
it had first. A key found there is held in memory only and never written anywhere. The
address follows the same pattern (Settings, then `WRITEON_BASE_URL` or
`LUNAROUTE_BASE_URL`, then the default), and so does the model (Settings, then
`WRITEON_MODEL`, then `glm-5.3-flash`). The shell is asked for each name in a way that
survives a profile which makes an unset variable an error (`nounset`).

**Plain `http`** is for this Mac and its own network (a `.local` name, a name with no
dot in it, a private address written the usual way, as four numbers), where a model
may be served. For anywhere else the app
refuses it before anything is sent: "Only an address on this Mac or its own network
may be plain http. Use https." macOS refuses the same (tried on macOS 26 with addresses
nobody answers at: a public name and a public address were refused, the local kinds
were tried), but the rule is the app's own, so it does not depend on the version of
macOS.

**Two ways of speaking.** A service is spoken to in one of two ways. OpenAI's chat
completions (`POST …/chat/completions`, the key as a bearer token) is what LunaRoute
is asked in and what most services and gateways speak. Anthropic's messages
(`POST …/v1/messages`, the key in `x-api-key`, `anthropic-version: 2023-06-01`) was
added on 13 October. The page knows nothing of the difference: it asks in its own
terms (`ai.start`), and the shell words the request and reads the answer.

Which way: as Settings says (Format); else as `WRITEON_API_FORMAT` says (`openai` or
`anthropic`); else as the address is taken to say: Anthropic's way for an address at
`anthropic.com` or one that ends `/messages`, OpenAI's for one that ends
`/chat/completions` and for everything else. A gateway that speaks both has to be told.

Anthropic's way, a request differs in these respects. The system messages are gathered
into one `system` prompt, apart from the messages. `max_tokens` is always sent (4,096
if the page gave none). The effort goes in `output_config.effort` and a Lab pass's
schema in `output_config.format`. The answer is read from `text_delta` events; thinking,
pings and events of any kind not known are passed over; `stop_reason: max_tokens` is
the model run out of room, `refusal` and `model_context_window_exceeded` are failures
with a line of their own, and `message_stop` is the end. An address is taken as
Anthropic's own is given, stopping short of `/v1`, though one that has the `/v1` is
taken too.

A Lab pass spoken this way also asks for the shape of its answer in words, at the end
of the system prompt, with the schema to go by. Tried against LunaRoute on 13 October,
`output_config.format` was not held to: without the words a marking pass came back as
prose. With them it came back as the JSON asked for, and the page's reading of an
answer already allowed for a code fence or a stray sentence round it. (OpenAI's way the
prompts are as they were, since there the schema is held to.)

LunaRoute's endpoint for this way also took no notice of `output_config.effort`: a
slight trim of the welcome piece, as trims were then asked, thought for a minute and
ran out of room. It does take the effort under OpenAI's name, `reasoning_effort`, which
Anthropic's own service would refuse as a field it has not heard of. So to LunaRoute,
and only to LunaRoute (its own domain, or the address `LUNAROUTE_BASE_URL` gives), the
effort is given under both names. Live that way on 13 October: five words in 1.5 to
3.6 s, three versions of a sentence in 1.2 to 2.0 s, hedges marked in 4 to 24 s, two
planted slips found in 2 to 9 s; and, once trims were asked a sentence at a time, the
welcome piece read in 4 to 10 s and a 498-word draft in 8 to 25 s, the levels coming to
within the same few points of 10, 20, 30 and 50% as they do asked OpenAI's way.

Anthropic's own service has not been asked. What is said of it here is from its
documentation, and the stand-in the tests use refuses what that documentation says it
refuses: a request with no version header, with no `max_tokens`, or with a system
message among the messages. How the real service words its refusal of an effort or a
schema has not been seen: the asking again (below) goes by the names of those fields
in whatever it says.

**Another service.** The app asks whatever address it is given, for whatever model, with
whatever key it finds. None of what follows is in the clips; it is what makes a service
other than the usual one work in practice.

- *The address* is a base address, and the rest of where requests go is added to it:
  `chat/completions` OpenAI's way, `v1/messages` Anthropic's. One that ends that way
  already is used as it stands. One that ends as the other way's requests do, the
  format having been changed since it was typed, is taken back to the base first.
- *No key.* A service named in place of the usual one is asked without a key when none
  is found, since a model served on the same Mac wants none. If it answers 401 or 403
  the line says that the service wants a key. Only the usual service is never asked
  without one: there the line is the one in §8 and nothing is sent.
- *Parts of a request a service refuses.* OpenAI's way, every request carries
  `max_tokens` and `reasoning_effort`. OpenAI's own service refuses the first from its
  models that reason, which want `max_completion_tokens`, and the second from its
  models that do not. When a refusal (400 or 422) names the effort, the app asks again
  without it.
  When one names `max_tokens` and says it does not know or take it, or gives the other
  name, the app asks again under the other name. (A refusal that names it for another
  reason, more room being asked for than the model can give, is passed on as it came:
  another name would not cure it.) Once asking in a service's way has worked, the app
  asks that way first, for that address and model, until it is quit. If that way is
  then refused, what was learnt is forgotten and the request is asked once more as the
  app words it: the same name may have come to mean another model. The last refusal is
  the one shown. OpenAI's way, the JSON schema a Lab pass carries has no such
  fallback, because without it the answers could not be read (above). Anthropic's way
  there is more that may be refused, and all of it can be done without: the effort, the
  schema (the shape is asked for in words as well), `output_config` as a whole by a
  service that has not heard of it, and LunaRoute's name for the effort by one that
  takes nothing it does not know. A refusal is taken to be of a part only if it names
  the part as a word of its own: "best-effort" and "information" name nothing.
- *Room.* What a model thinks is counted against the room it is given, and a model may
  think more than the page allowed for: asked Anthropic's way through LunaRoute, a trim
  to a fifth, as trims were then asked, ran out. An answer cut off before a word of it has come is asked
  for again with twice the room, twice at most and never more than 32,000. If the
  service refuses the wider room, the line is the one for running out of room, since
  that is what happened. Nothing of this is kept for the next request: what one request
  needed says little about another of a different size, and a model refuses more room
  than it can give. An answer cut off after it has begun is not asked for again: what
  came of it is with the page already.
- *Which key goes where.* The key that is found goes to the address in force, with one
  exception. A key under LunaRoute's name is LunaRoute's: it is sent to LunaRoute's own
  domain, or to the address `LUNAROUTE_BASE_URL` gives, where it comes before the app's
  own, and to no other service. Otherwise someone with that key in their shell would
  send it to the first other address they typed. Settings says when a key is being
  kept back. A key saved in Settings is not tied to an address: it goes with whatever
  address is there.
- *Nowhere else.* A request is not sent on to wherever an answer says the service has
  moved (a 307, say): the person's words go to the address they named. The line says so.
- *What a service still has to do.* Take the key the way its format carries it; begin
  its answer within the minute the app allows a silence, and not fall silent for
  longer; give a trim the room it asks for (up to 32,000 tokens); and, for the Lab
  spoken to OpenAI's way, hold an answer to a schema.

Only LunaRoute and `glm-5.3-flash` have been asked for real. The rest is tested against
a stand-in that answers and refuses as those services are documented to (§10).

**Settings window** (⌘,): API key, address, format, model, a "Test connection" button,
and the sound toggle. Nothing else. Format is a choice of three: Automatic, which says
which way it comes to ("Automatic: OpenAI-style"), OpenAI-style and Anthropic-style. A
key typed in is saved to the Keychain and the field emptied; a line under it says where
the key in use comes from ("saved here", "from the app's environment", "from your login
shell") and offers to remove a saved one. While
they are empty the address and model fields show the ones in force: the environment's,
or the usual ones. Test connection asks a one-word question and answers in a line:
"Connected: glm-5.3-flash answered in 0.6 s, with the key from your login shell." (or
"with no key"), or the reason it failed; an answer with nothing in it is a failure
("The service answered, but said nothing. Check the model in Settings (⌘,)."). The
sound toggle reaches every open window at once.

## 8. Errors

| Situation | Behaviour |
| --- | --- |
| No API key, and the service is the usual one | AI commands show one line in place: "No API key — add one in Settings (⌘,)". Nothing is sent and nothing else is blocked. (Another service is asked without a key, §7.1.) |
| Network or gateway error, timeout (60 s of silence) | The pending animation stops, a one-line reason shows for a few seconds, the document is untouched. The lines: "The key was not accepted (401). Check it in Settings (⌘,)."; "This service wants a key (401). Add one in Settings (⌘,)." when none was sent; "Only an address on this Mac or its own network may be plain http. Use https."; "The address in Settings (⌘,) sends requests on elsewhere (307), and they are not followed."; "Too many requests, or out of quota (429). Try again in a moment."; "The AI service had a problem (503). Try again in a moment."; "The request was refused (400): …" with the service's own first line; "Could not reach the AI service. Check the network, and the address in Settings (⌘,)."; "The connection was lost before the answer was complete."; "The AI took too long to answer."; "The AI ran out of room before it finished its answer. Try again." A key the service quotes back is taken out before the line is shown. |
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
| 2 | "The Lab guide…" | Opens a card, in the look of the shortcut card, headed "The Lab": each of the six ideas and the trims with two sentences on what it does, and a closing line that the AI never rewrites. |
| 3 | "Walk through" | Steps through the proposal one passage at a time with Cut / Keep / Stop, showing "3 of 9" where the numbers were. The passage in question is underlined in the Lab's crimson and scrolled into view. Cut and Keep only decide; nothing is cut until "Make the cuts". After the last passage, or on Stop or Esc, the summary is back. |
| 4 | "Mark…" passes | Marked passages get a `lab`-coloured underline; hovering shows a short reason; clicking a mark dismisses it, and dismissing the last puts the card away; "Done" clears them. The card names the pass and counts ("Mark hedges and filler 2 marked") over the line "Hover a mark to see why. Click one to dismiss it." A quote the model made up, or changed, is dropped; if nothing is left the card says "The AI marked nothing." Never saved. |
| 5 | "Fix punctuation and typos" | Proposed fixes are marked the same way, with the correction shown on hover. The card counts them ("4 found") over "Hover a mark to see the fix. Click one to keep the original." Card buttons: "Fix all", "Walk through", "Done". Clicking a mark keeps the original and drops the fix. "Fix all" makes every fix still marked, as one step to undo. "Walk through" shows each fix on the card in turn with Fix / Keep / Stop; as for a trim they only decide, and "Fix all" then makes what was not kept. A fix inside an alternative group changes what the group is showing. A clean page gets "The AI found no slips." |
| 6 | Stash with no selection | Moves the whole paragraph at the caret. |
| 7 | Where stashed text lands | Appended to the end of Overflow. |
| 8 | Ctrl+Return in Overflow | Moves text into the page (rather than copying it). |
| 9 | Post to X | Opens X's compose window with the text; does not use the X API. Ghosted text is left out. |
| 10 | Save icon colour | Accent means unsaved changes. Saving is always explicit. (The file-format clip hints the original may autosave once a file exists.) |
| 11 | Scope of a selection | The rules in §6.5. |
| 12 | Suggestions per AI request | Five for words (observed), three for sentences and paragraphs. |
| 13 | Groups do not nest | §5.1. |
| 14 | Whose the keys are | §6.3. The clips show hovering and arrowing, and the arrows going on working after the pointer hides. That typing gives the arrows back to the caret, that a scroll under a resting pointer does not arm what arrives, and Delete's stricter rule are decisions made here; the original may flip on any hover. |
| 15 | Heading entry | Typing `# ` converts the line; the marker is hidden. Only the hidden marker is observed. |
| 16 | Spelling, autocorrect, smart quotes | Off by default. |
| 17 | Several windows | ⌘N opens another window; each window is one document. The original shows one. |
| 18 | Settings window | Exists only for the AI service's key, address, format and model, and for sound. |
| 19 | Sample document | An original short piece that carries one group of each scope, a ghost run and some overflow, and tells the reader to click the word count. |
| 20 | App identity | Display name "Write_On"; bundle id `com.thesimhons.writeon`. |
| 21 | Ghost text in the saved Markdown | Written as ordinary text; the ghost marking lives only in the metadata. |
| 22 | Whole-document character count | Characters of every block, spaces included, line breaks and the hidden heading marker excluded. (Only the selection readout could be checked exactly.) |
| 23 | Trim tidy-up | The mechanical whitespace and capital fixes in §6.10 after "Make the cuts". |
| 24 | Arrow keys while hovering | → and ↓ go forward, ← and ↑ go back. The clips show both directions and wrap-around, not which key is which. |
| 25 | Panel details | Clicking a tab retargets at that scope; ↑ / ↓ do not wrap; a group cannot be deleted down to nothing. |
| 26 | Lab popover while a proposal is pending | The pending level is highlighted; choosing "Original" dismisses it, like "Done". |
| 27 | Source view details | "As saved" reflects the document as it would be saved now. "Copy" copies the tab that is showing and reads "Copied" for a second and a half. Esc, Ctrl+U again, the M↓ icon or a click off the card closes it, and so does going into Read mode. While it is open the keys scroll it and none reach the page; afterwards the caret is where it was. What shows the first time the view opens on a document is item 53's. |
| 28 | Read mode details | Feature shortcuts leave Read mode; the mode is remembered between launches. |
| 29 | Ghost with no selection | Applies to the word at the caret, like the alternatives commands. |
| 30 | Mac shell additions | Blended title bar, menu bar with ⌘ equivalents, Save As, Open Recent, unsaved-changes prompt, crash snapshots, file name suggested from the first heading, a sound toggle. None of these are in the clips. |
| 31 | Error presentation | Everything in §8. |
| 32 | Plain documents | A document with no groups and no ghost runs is saved without the metadata comment. The clips only show a file that has groups. |
| 33 | Line pitch | 36 px instead of the measured 36.4 px; see §4.2. |
| 34 | Other tooltips | The source icon shows "Ctrl+U". An icon in the top row has no room above it, so its label goes below. The alternates toggle, keyboard icon, LAB and LinkedIn show none. |
| 35 | Alternates toggle when off | Drawn in the inactive icon colour. The clips only show it on. |
| 36 | A target with no alternatives | While the panel looks at a word that has none, the word is a group of one. Making and unmaking that group is not an undo step, and it is never left behind: closing the panel, moving it on, undo, redo or opening a file turns a group of one back into plain text. |
| 37 | Rows | The empty row is always the last. Emptying a row in the middle removes its variant and puts the caret in the empty row at the end. A row typed into the same words as another row does not become a second copy; the row it repeats shows instead. The only variant of a group cannot be emptied away. |
| 38 | Typing an alternative and undo | The letters of an alternative typed in one go are one undo step. Undo and redo in the panel are the document's. That an empty row opened with Return is a step like the first, and that a flip which loses ghosted words is one, are decisions made here. |
| 40 | Context menu states | Items that cannot apply are dimmed and do nothing: the two alternatives items for a selection across paragraphs or where there is no word (they then read just "Alternatives" and "AI alternatives"), Ghost with nothing to ghost, Stash on a blank line. Arrow keys and Return work in the menu; Esc, a click elsewhere, scrolling or any other key puts it away. Near the window's edge it opens on the other side of the pointer. |
| 41 | Shortcut card | The keyboard icon opens a centred card listing the shortcuts of §6.13 and the keys that work under the pointer; Esc, a click outside or the icon again closes it. It has the look of the source view's card, the one card the clips show: the same edge, corners and shadow, and the page behind is not dimmed. |
| 42 | Which shortcuts leave Read mode | The feature shortcuts (alternatives, AI alternatives, ghost, stash, Overflow, source view) and any context-menu item. Save, Open, Post to X, undo and redo do not. |
| 43 | Undo keys | ⌘Z and Ctrl+Z (with Shift to redo) undo the document wherever the focus is, except in a plain text field, which keeps its own history. |
| 44 | While the AI is asked | The row of `??` cannot be typed in while it dances. Closing the panel or moving it to another target calls the request off, and nothing arrives. Suggestions show as they come but become variants together, when the answer is complete; a request that fails part-way leaves none of them. After a failure the row keeps its `??`, still, with the caret in it: deleting a mark and typing it again asks again. The reason replaces the footer hint for four seconds. |
| 45 | Ghost at the edges | A run of ghosted text is what runs on unbroken within one paragraph; where the edge of a group splits it, it is still one. A caret on a ghosted word revives even at the very edge of the run, and a caret inside ghosted spaces or punctuation revives too. A selection with no words in it, a blank line and a caret among plain spaces give the command nothing to do, and the menu item is dimmed. A word beside ghosted text is ghosted in its own right. |
| 46 | Stash and use, in detail | Stashed text is trimmed, and marks do not travel: a group or ghosted words go as the words that were showing. Where a stash empties a paragraph, the paragraph goes and a blank line with it, so the page stays one blank line between paragraphs. Taking whole lines out of Overflow closes it up the same way. Used text goes in as a paste would, the caret goes to the page and stands after it, and the page scrolls to show it; where the page has had no caret yet it is added at the end as a paragraph of its own. A blank line, or a selection with no words, gives either command nothing to do. |
| 47 | Trims, in detail | A click on a faded passage keeps it and a second click lets it go again. Choosing another level, or "Original", puts a pending proposal away first. If the request fails the card keeps the trim's name, gives the reason in one line and offers only "Done"; the same if the answer holds nothing that is the text with words deleted ("The AI found nothing it could cut without rewording."), or nothing at all ("The AI found nothing to cut."). A sentence that came back reworded is left as it is while the others are proposed. An answer that could not be read is not kept: the next trim asks again. Going into Read mode puts the popover and any pass away. Arrow keys are not needed in the popover; Esc and a click elsewhere close it. |
| 48 | Post to X, in detail | The clip only hovers the X icon, so everything past "opens X's compose window" is a choice: the address (`x.com/intent/post`), the text sent (the page as it reads: no heading mark, nothing ghosted, nothing from Overflow, nothing of the other versions), the two limits and the clipboard fallback, the wording and behaviour of the note, and doing nothing for an empty page. |
| 49 | Documents and windows | Where a file opens (the window that has it, else one nobody has written in, else its own); a new window being blank and the welcome piece shown once; unsaved work coming back after a crash as an unsaved document rather than being offered in a dialog; one question at a time; Undo and Redo in the menu being the document's; which commands the menus hold and what they are called. |
| 50 | A shortcut with the caret on no word | With the caret on no word, or no caret in the text, Alternatives and AI alternatives act on what the pointer is resting on: the group, or the word. The clip only shows the case with the caret in a word, which wins over the pointer. |
| 51 | Where the caret is | A window opens with the caret at the start of the piece; a press on the bare page beside or below the text lands in the text; and the page never scrolls the caret into its faded edges (§4.3, §5.2). None of it is shown in the clips. |
| 52 | Dots on a 1x display | The clips are of a 2x display. On a display with one pixel to the px the dots are seated on whole pixels and a ring's line is one pixel (§6.2). |
| 39 | Tabs | A tab reads the spot the panel was opened on at another scope. Inside a real group of a larger scope the answer stays that group, since groups do not nest. |
| 54 | How a trim is asked for, and how much it takes | Everything under "How much a trim takes" in §6.10: that the model is asked once about every sentence and not once a level for an amount; the scale of 1 to 5 and the four stages; that a level's share is reckoned on the words the card counts, headings included; that a stage is taken part-way evenly through the piece; that a level can fall short and says so; that no sentence goes while one needed less stands, and that a level is never empty where something could go; that a sentence the piece "does not work without" goes only in "Cut in half", last, and never past the amount; that each level holds what the lighter ones take; that a paragraph may go whole, with a blank line; what fades while the answer is arriving; that a thin answer is asked for once more; and that the numbers are checked against the words. The clip shows only that a trim fades words and whole sentences, that the card counts them, and that a second level is there at once. |
| 53 | A Markdown tab in the source view | Not in the clip, and not inferred from it: asked for by the replica's owner, who opened the card to copy the piece and found the file's record in the way. The source view has a third tab, "Markdown", ahead of the clip's two and the one it opens on, showing the piece as it reads now (§6.11). The clip's card opens on "As saved". |

## 10. Verification

1. **Unit tests** (Node's built-in runner) on the pure modules: file format round-trips,
   including the structure in the author's clip; opening files edited elsewhere;
   normalisation; scope detection; sentence and word boundaries; article agreement; the
   tone rule replayed against the tick sequences recorded from the clips; history;
   prompt building and response parsing, including hostile responses.
2. **Scripted UI runs in the real web view.** A harness built into the app, which does
   nothing unless the app is started with `--ui-test`, launches it,
   drives a scenario and writes PNG snapshots of the page. Clicks, drags, typing and
   shortcuts are native events handed straight to the app's web view. A scripted run is
   headless and must not disturb whoever is using the Mac: it is a background process
   with no Dock icon, never the active app, and its window is parked outside every
   display, transparent, click-through and unable to take the keyboard; it leaves the
   clipboard, saved settings, speakers, file panels and default browser alone. The first
   scenario checks this on every run, and the harness fails any run that came to the
   front or took the keyboard. Inside, WebKit
   is told to treat the page as visible and focused, so runs behave the same whether the
   Mac is in use, locked or unattended. Pointer moves and turns of the wheel are native
   events too, sent the way WebKit's own test runner sends them, so WebKit itself finds
   what is under the pointer, keeps `:hover`, and repeats the pointer's place when the
   page scrolls beneath it, as it does for a person. Scenarios follow the clips:
   read mode, each scope's marks, hover-cycling, the panel, `??`, ghost, overflow, the
   context menu, the Lab popover, a trim, the source view. Snapshots are compared with
   the corresponding frames for position, size and colour. The reference frames stay out
   of the repository.
3. **Sound.** Each sound is rendered offline to a WAV and put through the same analysis
   used on the clips. Pass: tick frequencies within 5 Hz, envelope times within 20%.
4. **Live AI smoke test** against LunaRoute for alternatives at each scope, a marking
   pass, the typo pass, and a trim at every level of the welcome piece and of a
   500-word draft, plus the same flows against a canned provider so tests run without
   a network.
   The client itself is tested over HTTP against a stand-in gateway on the same Mac,
   which speaks both ways and also plays another service: one at a second address, one
   that wants no key, one that refuses parts of a request as OpenAI's does or as
   Anthropic's is expected to, one that changes its ways, one that runs out of room
   thinking, one that may give no more room, and one that says it has moved. The live
   test is run both ways against LunaRoute. A scripted run that is not the live one cannot ask
   anything else: it is given nothing of what the tester's shell says about the AI
   service, and its client refuses every address that is not on this Mac.
5. **Measurements.** `scripts/bench.sh` runs the scenarios in `tests/perf` the same way,
   out of sight: how long a keystroke takes to reach the frame that shows it in pieces of
   up to 50,000 words, how long the app's gestures take, what the app costs standing
   still, and whether WebAssembly would help. `tests/perf/native-baseline.swift` measures
   the same typing in AppKit's own text view as a yardstick, and
   `tests/perf/doc.bench.mjs` the document's functions on their own.
6. **Hands-on pass** with a real mouse and keyboard, following the main clip from start
   to finish. The page is driven this way in a browser during development. The built app
   comes with a short checklist for the things only a person at the Mac can confirm:
   real hover in the app window, pointer hiding, drag from Overflow, the LinkedIn chase,
   and how it sounds.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| `contenteditable` edge cases: splitting and merging paragraphs through groups, input methods, drag and drop | One normalisation pass after every input; group invariants unit-tested; scripted editing scenarios. |
| WebKit maps some Control keys to Emacs-style editing (Ctrl+O inserts a line) | The page handles its shortcuts on key-down and cancels the default; covered by a scripted run. |
| The display it was built on is 1× while the clips are 2× | Geometry is compared in CSS px; glyphs look lighter at 1×. For a pixel-level comparison the page is snapshotted at 2× zoom. |
| `glm-5.3-flash` at low reasoning may choose poor cuts or miss the target length | Raise reasoning for Lab passes only; the card always reports the real numbers. |
| A service other than LunaRoute may not take the requests as they are worded, or may not hold an answer to a schema | The two parts known to be refused are asked for again in the service's way (§7.1); the rest is on the hands-on checklist until someone has tried a second service for real. |
| The handwriting face may not be Caveat | Compare glyphs early; substitute and record. |
| The original may differ wherever §9 guesses | All guesses are in one table and cheap to change. |
| A script cannot move the real pointer on a Mac that is in use, or locked | Scenarios send native pointer moves straight to the web view (§8), so WebKit itself finds what is under them; the pointer in a person's hand is on the hands-on checklist. |
