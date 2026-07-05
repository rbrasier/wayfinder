# v1.8.1 — DOCX Template Preprocessing

## What was built

Fixed template upload and generation failures caused by two bugs in `DocxGenerator`,
and added support for human-readable descriptive tag names.

### Bug 1 — Delimiter mismatch (primary fix)

The user-facing UI and error messages always showed `{{tag}}` (double curly braces),
but `Docxtemplater` was constructed with no explicit delimiter option, defaulting to
single curly `{`/`}`. Every real-world template using `{{tag}}` syntax therefore
produced "duplicate_open_tag" / "duplicate_close_tag" errors on upload.

Fixed by adding `delimiters: { start: '{{', end: '}}' }` to all `Docxtemplater`
constructor calls.

### Bug 2 — Word XML run-splitting

Microsoft Word splits typed text into multiple `<w:r>` (run) XML elements. A tag
like `{{Fullname}}` may be stored as three adjacent runs: `{{` / `Fullname` / `}}`.
Even with `{{` delimiters configured, docxtemplater processes runs individually and
sees the split `{` + `{` as a duplicate open-delimiter.

Fixed by a new `preprocessTemplate` step that runs before docxtemplater on every
`extractTags` and `generate` call. The preprocessor:
1. Iterates `word/document.xml` and any header/footer XML files in the DOCX zip.
2. For each `<w:p>` paragraph, concatenates the text of all `<w:r>` runs.
3. Finds `{{ ... }}` spans in the concatenated text.
4. Rebuilds the runs so that tag-spanning runs are consolidated into a single run,
   preserving the original `<w:rPr>` formatting for non-tag runs.

### Feature — Descriptive tag names

Tags may now carry human-readable descriptions with spaces and special characters:

```
{{ Full name }}
{{ Start Date – the date the person will commence with the organisation }}
{{ Department code they will sit in }}
```

`normalizeTagName` trims, lower-cases, and collapses non-alphanumeric sequences to
`_`, producing safe docxtemplater variable names (`full_name`,
`start_date_the_date_the_person_will_commence_with_the_organisation`,
`department_code_they_will_sit_in`). The AI generation step receives these normalised
names as JSON keys and uses them as context to produce appropriate values.

Also removed a deprecated `doc.compile()` call that the docxtemplater v4 constructor
already handles internally (with deprecation warnings suppressed).

## Files modified

- `packages/adapters/src/documents/docx-generator.ts` — delimiter fix, removed
  deprecated `compile()` call, added `preprocessTemplate`, `fixTemplateXml`,
  `fixParagraphTags`, `extractRuns`, `extractRunText`, `rPrXmlForPosition`,
  `buildNewRuns`, `replaceParagraphRuns`, `buildRun`, `normalizeTagName`
- `packages/adapters/src/documents/docx-generator.test.ts` — updated 3 existing
  fixtures from `{tag}` to `{{tag}}`; added 8 new test cases covering: single-curly
  treated as plain text, split `{{`/`}}` across runs, partial split (`{` + `{tag}}`),
  descriptive tag normalisation, em-dash in description, mixed split+descriptive,
  lone braces in prose, generate with descriptive tags, generate with split runs

## Migrations

None.

## Known limitations

- Tags split across paragraph boundaries (extremely rare) are not handled; they
  will still fail validation with a clear error message.
- XML-encoded characters inside a tag description (e.g. `&#x2013;` for em dash
  stored as an XML entity rather than a literal character) will appear in the
  normalised name as-is. In practice Word stores these as literal UTF-8 characters.

## Version bump

PATCH: `1.8.0` → `1.8.1`
