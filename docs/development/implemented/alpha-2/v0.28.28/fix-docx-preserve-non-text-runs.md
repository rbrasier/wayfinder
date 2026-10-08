# Bug fix — layout is stripped from any .docx paragraph that contains a {{ tag }}

- **Severity**: major — branded templates generate without their logo or alignment, and nothing warns the author
- **Base branch**: `release/alpha-2`
- **Source issue**: [#312](https://github.com/rbrasier/wayfinder/issues/312)

## Symptom

A template whose page header holds one paragraph — a logo image, two tabs, then
`{{ ATM Reference }} | {{ Procurement Title }}` — generates with the values filled
in but the logo and both tabs gone, so the text sits at the left margin.
Paragraphs without a tag are unaffected, and no error is reported.

## Reproduction

1. Build a template paragraph `<w:r><w:drawing>…</w:drawing></w:r><w:r><w:tab/></w:r><w:r><w:tab/></w:r><w:r><w:t>{{ ATM Reference }}</w:t></w:r>`.
2. Call `DocxGenerator.generate` with `{ atm_reference: "ATM-1" }`.
3. The output paragraph holds only `<w:r><w:t>ATM-1</w:t></w:r>`.

Variants confirmed on `release/alpha-2` (0.28.27) with a throwaway vitest probe:

- `<w:r><w:tab/><w:t>{{ Ref }}</w:t></w:r>` generates as a visible `<w:t>` text
  run followed by the value — the tab is lost and markup leaks into the document.
- `<w:t xml:space="preserve">Smith &amp; Co </w:t>` beside a tag generates as
  `Smith &amp;amp; Co`, which Word displays as the literal `Smith &amp; Co`.

## Root cause, as verified

`preprocessTemplate` → `fixTemplateXml` → `fixParagraphTags`, and the shared
`annotate` path (`annotateXml`), both rewrite a paragraph by **rebuilding** it:

1. `extractRunText` reads only `<w:t>` contents per run, as raw (still
   entity-escaped) XML. Its regex `<w:t[^>]*>` also matches `<w:tab/>`, so a run
   holding a tab and text reports `<w:t …>text` as its text.
2. `buildNewRuns` creates one fresh `<w:r>` per non-empty text slice. A run with
   no text — drawing, tab, break, field character — yields nothing, and non-text
   children inside a text run are discarded. `buildRun` escapes the already
   escaped text a second time.
3. `replaceParagraphRuns` splices the fresh runs over everything from the first
   original run's start to the last run's end, deleting every run *and* every
   element between runs (bookmarks, `<w:fldSimple>`, hyperlink open/close tags —
   a hyperlink straddling the range can leave the XML unbalanced).

The triage comment's diagnosis of steps 1–3 for empty runs is correct; it missed
the `<w:tab/>` regex match, the double escape, the loss of inter-run elements, and
that `annotate` shares the same code. Its option (a) — rewrite only the runs that
overlap a tag — would still drop a tab sharing a run with part of a tag.

`extractParagraphTexts` (behind `extractFullText`) uses the same `<w:t[^>]*>`
regex, so the AI's text view of a template leaks the same markup.

## Fix plan

Stop rebuilding paragraphs. Edit only the text inside the `<w:t>` elements a
replacement span touches:

- `extractRuns` records each run's `<w:t>` elements (offset within the run XML,
  decoded text, paragraph text offset). The text regex becomes
  `<w:t(?:\s[^>]*)?>`, so it no longer matches `<w:tab/>`; the same regex is used
  by `extractParagraphTexts`.
- Paragraph text is decoded (`&amp;` `&lt;` `&gt;` `&quot;` `&apos;`) so tag and
  annotation matching work on real characters.
- Each `<w:t>` element whose text range overlaps a replacement is rewritten in
  place: characters outside every replacement are kept, the replacement text is
  written into the element holding the span's first character, and the result is
  escaped once. An element left empty is removed. Every other byte of the
  paragraph — runs, run properties, non-text children, inter-run elements — is
  untouched.
- `buildNewRuns`, `replaceParagraphRuns`, `buildRun`, `rPrXmlForPosition` and
  `SpanReplacement.rPrXml` are deleted; the replacement inherits the formatting of
  the run it starts in, as before.

No schema or port change. PATCH bump 0.28.27 → 0.28.28.

## Out of scope

- Text boxes inside drawings (paragraphs nested in paragraphs) — the paragraph
  regex already mis-scopes them; separate bug.
- Tags inside field-code instructions (`<w:instrText>`).
