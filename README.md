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
need no rebuild. `--zoom 2` renders snapshots at twice the size, which is the scale of the
source clips.

A scenario is the body of an async function with a helper `t` in scope
(`tests/ui/_harness.js`): assertions, snapshots, and input. Clicks, drags, typing and
shortcuts are native events delivered through the app's window. They work on a locked,
unattended Mac because the harness makes WebKit treat the window as visible and focused.
Hovering is simulated with DOM events, because WebKit discards button-less pointer moves
in that state.

The page in `web/` has no build step and no third-party code. The fonts in `web/fonts`
are IBM Plex Mono and Caveat, both under the SIL Open Font License; `scripts/fetch-fonts.sh`
records where they came from.
