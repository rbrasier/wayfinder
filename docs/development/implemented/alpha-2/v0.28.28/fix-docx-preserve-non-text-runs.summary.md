# Implementation summary — tagged paragraphs keep their layout

- **Version**: 0.28.27 → **0.28.28** (PATCH — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: [`fix-docx-preserve-non-text-runs.md`](./fix-docx-preserve-non-text-runs.md) (this folder)
- **Source issue**: [#312](https://github.com/rbrasier/wayfinder/issues/312)

## Root cause

`DocxGenerator` normalised tags (and applied template annotations) by rebuilding
each affected paragraph from its `<w:t>` text alone: runs without text were never
recreated, non-text children of text runs were discarded, and everything between
the first and last run was spliced out. The text regex `<w:t[^>]*>` also matched
`<w:tab/>`, leaking `<w:t …>` markup into the text, and the raw escaped text was
escaped a second time on the way back out.

## Fix applied

- Paragraphs are no longer rebuilt. `applyReplacements` → `rewriteRun` →
  `rewriteTextElement` rewrite only the `<w:t>` elements a replacement span
  overlaps; every other byte of the paragraph is copied through. The replacement
  text lands in the element holding the span's first character, so it keeps that
  run's formatting as before; an element left empty is removed.
- `TEXT_ELEMENT_PATTERN` (`<w:t(?:\s[^>]*)?>`) no longer matches `<w:tab/>`; it is
  shared by run extraction and `extractParagraphTexts`.
- Text is decoded from XML entities on read and escaped once on write, so tag and
  annotation matching work on real characters and `&` is never double-escaped.
- Removed: `buildNewRuns`, `replaceParagraphRuns`, `buildRun`,
  `rPrXmlForPosition`, `extractRunText`, `RunInfo.rPrXml`, `RunInfo.startIndex/endIndex`
  and `SpanReplacement.rPrXml`.

## Regression tests added

`packages/adapters/src/documents/docx-generator.test.ts`:

- `generate` › keeps a logo and tab runs beside the tags (the issue's header)
- `generate` › keeps a tab that shares a run with the tag
- `generate` › keeps line breaks and bookmarks between runs
- `generate` › does not double-escape special characters beside a tag
- `annotate` › keeps tabs and line breaks in the paragraph it edits
- `annotate` › matches and writes text containing special characters
- `extractFullText` › reads text that shares a run with a tab, without markup or entities

All seven failed before the fix and pass after it.

## E2E

None. Template generation is adapter logic and falls in none of the six groups
in `docs/guides/e2e-test-policy.md`; the unit tests above are the guard.

## Deviations from the approved summary

- `extractFullText` now also decodes XML entities (`&amp;` → `&`). The summary
  named the regex fix there; decoding was needed too, because `annotate` now
  matches against decoded text and the AI derives its `find` strings from
  `extractFullText`.

## Known limitations

- Text boxes inside drawings (paragraphs nested in paragraphs) are still
  mis-scoped by the paragraph regex — a separate, pre-existing bug.
- A tag split across a hyperlink boundary is filled in the run where it starts.
