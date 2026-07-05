# Patch: DOCX Template Preprocessing — Flexible Tag Support

## Problem

Template upload fails for all real-world Word documents with two distinct issues:

### Issue 1 — Delimiter mismatch (primary bug)

The user-facing UI, error messages, and documentation all show `{{tag}}` syntax (double
curly braces). However, `DocxGenerator` constructs `Docxtemplater` with no explicit
delimiter option, which means it uses the library default of single curly `{` and `}`.

When a Word document contains `{{Fullname}}`, docxtemplater sees:

- `{` → open delimiter (first `{`)
- `{Fullname}` → content starting with another `{` → "duplicate_open_tag" error
- `}}` → two close delimiters → "duplicate_close_tag" error

Fix: pass `delimiters: { start: '{{', end: '}}' }` to every `Docxtemplater` constructor.

### Issue 2 — Word splits `{{` / `}}` across XML runs

Microsoft Word stores document text as a series of `<w:r>` (run) elements inside
`<w:p>` (paragraph) elements. When you type `{{Fullname}}`, Word may split the
text into multiple adjacent runs, e.g.:

```xml
<w:r><w:t>{</w:t></w:r>
<w:r><w:t>{Fullname}</w:t></w:r>
<w:r><w:t>}</w:t></w:r>
```

Even with `{{` delimiters configured, docxtemplater still parses XML run-by-run and
sees the split `{` / `{` as a duplicate open tag.

Fix: preprocess the DOCX XML before passing to docxtemplater — for each paragraph,
concatenate all run texts, find `{{ ... }}` patterns, and rebuild the paragraph with
tag-spanning runs consolidated into a single run.

### Issue 3 — Descriptive tag names desired

Users want tags to carry human-readable descriptions that give the AI generation step
more context, e.g.:

```
{{ Full name }}
{{ Start Date – the date the person will commence with the organisation }}
{{ Department code they will sit in }}
```

These descriptions must be normalised into safe docxtemplater variable names. The
normalised name still carries enough semantic context for the AI to generate correct
values (`start_date_the_date_the_person_will_commence_with_the_organisation` is
more informative than a short opaque token).

Fix: during preprocessing, apply `normalizeTagName(description)` which trims, lower-
cases, and replaces any non-alphanumeric sequence with `_`.

## Scope

**No domain or application layer changes.** The fix is entirely inside the adapter.

Files changed:
- `packages/adapters/src/documents/docx-generator.ts` — add `preprocessTemplate`
  private method; fix delimiter config in `extractTags` and `generate`
- `packages/adapters/src/documents/docx-generator.test.ts` — update existing tests
  to use `{{tag}}` syntax; add new cases for split-run and descriptive tags

No DB schema changes. No API changes. No UI changes.

## Implementation

### `preprocessTemplate(docxBytes: Buffer): Buffer`

1. Load `docxBytes` with PizZip.
2. For each XML file matching `word/document.xml` or `word/(header|footer)\d*\.xml`:
   a. Run `fixTemplateXml(xml)` → returns cleaned XML string.
3. Repack and return processed bytes.

### `fixTemplateXml(xml: string): string`

Replaces each `<w:p ...>...</w:p>` block via regex with the result of
`fixParagraphTags(paragraph)`.

### `fixParagraphTags(paragraph: string): string`

1. Extract all `<w:r>` runs using regex; for each run capture:
   - `xml` — full run XML
   - `rPrXml` — the `<w:rPr>...</w:rPr>` formatting block (if present)
   - `text` — concatenated text of all `<w:t>` elements within the run
   - `xmlStart` / `xmlEnd` — byte offsets within the paragraph string
   - `startIndex` / `endIndex` — character offsets in concatenated paragraph text
2. Concatenate all run texts → `fullText`.
3. If `fullText` does not contain both `{{` and `}}`, return unchanged.
4. Match all `\{\{([\s\S]*?)\}\}` → normalise each description via `normalizeTagName`.
5. Build a new run list:
   - For text segments before/between/after tags: slice the original runs that
     cover that range, preserving their individual `rPrXml` formatting.
   - For each tag segment: emit a single `<w:r>` containing the normalised
     `{{name}}` text, using the formatting of the first run that contained the
     tag's opening `{{`.
6. Replace the original run range in the paragraph string with the new runs.

### `normalizeTagName(description: string): string`

```
trim → lowercase → replace /[^a-z0-9]+/g with '_' → strip leading/trailing '_'
```

Falls back to `'field'` if the result is empty.

### Delimiter fix

All three `new Docxtemplater(zip, { ... })` calls gain:

```typescript
delimiters: { start: '{{', end: '}}' },
```

### Test updates

Existing tests use `{tag}` (single curly) — update all template strings to `{{tag}}`.

New test cases:
- Split `{{` / `}}` across two adjacent `<w:r>` runs → tags extracted correctly
- Descriptive tag `{{ Full name }}` → extracted as `full_name`
- Descriptive tag with em dash `{{ Start Date – description }}` → extracted as
  `start_date_description` (or similar normalised form)
- Mixed: document with both split runs and descriptive tags

## Regression surface

- Existing uploaded templates that used `{tag}` (single curly) will no longer work.
  Since upload validation was failing for all real templates before this patch, there
  are no valid templates in storage to regress.
- Tests that used `{tag}` syntax must be updated to `{{tag}}`.

## Version bump

PATCH: `1.8.0` → `1.8.1`. No schema change, no API change.
