# Write_On for macOS

A replica of the writing tool Jason Fried showed in
[this thread](https://x.com/jasonfried/status/2105403067793584590): alternatives for
words, sentences and paragraphs kept in place, ghosted text, an overflow panel, AI passes
that mark and trim without rewriting, and everything saved in one Markdown file.

- Design: `docs/superpowers/specs/2026-10-11-write-on-replica-design.md`
- Plan: `docs/superpowers/plans/2026-10-11-write-on-replica.md`

## Working on it

```sh
npm test                          # unit tests for the document logic (Node, no dependencies)
scripts/build-app.sh              # build build/Write_On.app (SwiftPM; Xcode is not needed)
scripts/ui-test.sh smoke --zoom 2 # run a scenario from tests/ui in the app's own web view
scripts/dev-server.sh             # serve the page at http://127.0.0.1:4173 for browser work
```

### UI scenarios

`scripts/ui-test.sh <name>` launches the built app with `--ui-test`, runs
`tests/ui/<name>.js` inside the page and writes snapshots and `result.json` to
`build/ui/<name>/`. The page is read from `web/` in the working copy, so page-only changes
need no rebuild. `--zoom 2` makes the page lay out and paint as it does on a 2x display,
whatever display the Mac has, and snapshots come out at that scale, which is the scale of
the source clips. A scenario can ask for launch options of its own on its first line
(`// launch: --setting read=false` starts it with the tools on).

A scenario is the body of an async function with a helper `t` in scope
(`tests/ui/_harness.js`): assertions, snapshots, and input. Clicks, drags, typing and
shortcuts are native events handed straight to the app's web view.

**Scripted runs are headless.** A run is a background process with no Dock icon that is
never the active app. Its window is parked far outside every display, and is transparent,
click-through and unable to take the keyboard. Nothing you type or click reaches it and it
takes nothing from you; it leaves the clipboard, your saved settings and the speakers
alone (sound effects are off unless a scenario asks for them). `tests/ui/smoke.js` checks
this on every run, and the harness fails any run that came to the front or took the
keyboard at any point. Inside, the harness makes WebKit treat the page as visible and
focused, so scenarios run the same whether the Mac is in use, locked or unattended, and
from a shell with no terminal. They do need a window server session (someone logged in at
the console, even if locked), because WebKit will not lay out a page without one.
Hovering is simulated with DOM events, because WebKit discards button-less pointer moves
for a window that is not really in front.

The page in `web/` has no build step and no third-party code. The fonts in `web/fonts`
are IBM Plex Mono and Caveat, both under the SIL Open Font License; `scripts/fetch-fonts.sh`
records where they came from.
