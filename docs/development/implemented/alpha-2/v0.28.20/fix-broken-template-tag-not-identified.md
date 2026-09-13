# Bug fix — a broken template tag is never named (and sometimes never reported)

- **Reported**: 2026-09-10 ([#286](https://github.com/rbrasier/wayfinder/issues/286))
- **Severity**: Major — a template with one typo among a hundred tags is
  rejected with no clue which tag to fix, or accepted with a silently wrong
  field list
- **Base branch**: `release/alpha-2`
- **Version**: 0.28.19 → **0.28.20** (PATCH — bug fix, no schema change)
- **Implemented**: see
  [`fix-broken-template-tag-not-identified.summary.md`](fix-broken-template-tag-not-identified.summary.md)
- **Relates to**: ADR-039 (xlsx templates), ADR-043 (signature slots)

## Symptom, as reported

> When a template is uploaded and tags are recognised (as part of the node
> config), if a tag is incorrectly formatted an error occurs in the console, but
> the user doesn't know what the issue is in the document. If a template has 100
> tags, it's hard to know which one is broken.

The reporter added that several bracket typos produce this — `{[ tag }}`,
mismatched bracket pairs, and missing closing brackets — and pasted the console
payload the server discards:

```json
"properties": {
  "xtag": "",
  "id": "unopened_tag",
  "context": "}}Extension Options: {[ Amount of extension options ",
  "offset": 1561,
  "explanation": "The tag beginning with \"}}Extension Options: {[ Amount\" is unopened",
  "file": "word/document.xml"
}
```

## Root cause — verified

Reproduced by driving `DocxGenerator` directly against four hand-built .docx
buffers, one per typo shape. There are **two** distinct defects, not one.

### 1. The per-tag detail exists and is thrown away

`DocxGenerator.extractTags` builds a `Docxtemplater` to enumerate tags. A
malformed delimiter makes the constructor throw docxtemplater's `multi_error`,
whose `properties.errors[]` holds one entry per bad tag, each carrying `id`,
`context`, `offset`, `explanation` and `file` — exactly the payload above.

The `catch` at `docx-generator.ts:41` collapses all of it:

```ts
} catch (cause) {
  return err(domainError("VALIDATION_FAILED", "Failed to parse DOCX template. Ensure the file is a valid .docx and all {{tags}} are correctly formed.", cause));
}
```

`cause` is never read again. `extractFields` (line 52) repeats the pattern, and
`XlsxGenerator` does the same with `INVALID_XLSX_MESSAGE`. That single sentence
is what `template-route-helpers.ts:137` puts in the 422 body and what
`template-annotation-modal.tsx:147` renders — so the modal *does* show an
error, it simply carries no way to locate the tag.

### 2. Some typos raise no error at all, and store a wrong field

`preprocessTemplate` → `fixParagraphTags` normalises tags with a non-greedy
`/\{\{([\s\S]*?)\}\}/`. That pattern spans from a *broken* opening brace to the
next good closing one, swallowing the intervening text and any `{{` inside it.
docxtemplater is then handed a well-formed document and raises nothing:

| Document text | Tags extracted today |
|---|---|
| `Hello {{ Client Name and {{ Other Field }}` | `["client_name_and_other_field"]` |
| `Hello {{ Client Name }] and {{ Ok }}` | `["client_name_and_ok"]` |

Two fields silently become one nonsense field. The upload succeeds, the node
config stores the wrong schema, and the author is never told. This is the
"missing closing brackets" and "combinations of different brackets" half of the
report, and it is worse than the reported symptom: there is no error to go
looking for.

### 3. `(signature)` is rejected as an unknown annotation

`applyAnnotation` matches only `approval`, so
`{{ Delegate Sign Off (signature) }}` fails with *"unknown annotation
(signature)"* even though `signature` is the name the parsed type, the web
type-picker and every internal identifier use. `isSignatureTag` has the same
blind spot, which means such a tag would also escape the ADR-043 §2 safety
filter if it ever parsed.

## Reproduction steps

1. In Word, author a .docx containing a good tag and a typo'd one, e.g.
   `{{ Supplier Name }}` and `Extension Options: {[ Amount of extension options }}`.
2. On a flow canvas, open a document node's config and upload the template.
3. **Observed**: "Invalid template: Failed to parse DOCX template. Ensure the
   file is a valid .docx and all {{tags}} are correctly formed." — no tag named.
4. Repeat with `{{ Client Name and {{ Other Field }}`.
5. **Observed**: the upload succeeds with a single field `client_name_and_other_field`.

## Fix plan

1. **domain** — `DomainError` gains optional `details?: readonly DomainErrorDetail[]`,
   where `DomainErrorDetail` is `{ subject, message }`: the offending text as the
   author wrote it, and what is wrong with it. `domainError()` takes it as an
   optional 4th argument, leaving every existing call site untouched.
2. **domain** — `(signature)` accepted as a synonym of `(approval)` in
   `applyAnnotation` and `isSignatureTag`. `(approval)` stays the canonical form
   `templateFieldToLine` writes back, so the annotator round-trip is unchanged.
3. **adapters** — a delimiter scan over each paragraph's reconstructed run text
   (body, headers, footers) requiring strict `{{` / `}}` alternation. It catches
   the cases docxtemplater never sees: an unclosed `{{`, a stray `}}`, and a
   second `{{` before the first closes. Single-brace `{tag}` remains plain text.
4. **adapters** — unwrap docxtemplater's `multi_error` into one detail per entry,
   and when tag *content* fails to parse, re-run `parseTemplateField` over every
   raw tag so all bad tags are listed rather than only the first.
5. **apps/web** — carry `details` through the 422 body and render the modal's
   error strip as a headline plus one row per broken tag.

## Tests

- `packages/adapters/src/documents/docx-generator.test.ts` — one case per typo
  shape, asserting the offending text reaches `error.details`. The two merge
  cases fail today by *passing*, which is the guard that matters.
- `packages/adapters/src/documents/xlsx-generator.test.ts` — parity for ADR-039.
- `packages/domain/src/entities/template-field.test.ts` — `(signature)` parses to
  `type: "signature"` and serialises back out as `(approval)`.
- `apps/web/src/components/canvas/template-error-model.test.ts` — the pure
  list-building helper behind the modal's error strip.
- **No e2e.** `apps/web` has no component-test harness (no `.test.tsx`, no jsdom
  environment), and this is not one of the six groups in `e2e-test-policy.md`.
