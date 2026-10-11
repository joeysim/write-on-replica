# Write_On for macOS

A replica of the writing tool Jason Fried showed in
[this thread](https://x.com/jasonfried/status/2105403067793584590): alternatives for
words, sentences and paragraphs kept in place, ghosted text, an overflow panel, AI passes
that mark and trim without rewriting, and everything saved in one Markdown file.

- Design: `docs/superpowers/specs/2026-10-11-write-on-replica-design.md`
- Plan: `docs/superpowers/plans/2026-10-11-write-on-replica.md`

## Working on it

```sh
npm test                 # unit tests for the document logic (Node, no dependencies)
scripts/dev-server.sh    # serve the page at http://127.0.0.1:4173 for browser work
```

The page in `web/` has no build step and no third-party code. The fonts in `web/fonts`
are IBM Plex Mono and Caveat, both under the SIL Open Font License; `scripts/fetch-fonts.sh`
records where they came from.
