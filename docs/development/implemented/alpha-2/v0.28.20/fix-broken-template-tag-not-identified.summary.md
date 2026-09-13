# Implementation summary — a broken template tag is never named

- **Version**: 0.28.19 → **0.28.20** (PATCH — bug fix, no schema change)
- **Base branch**: `release/alpha-2`
- **Issue**: [#286](https://github.com/rbrasier/wayfinder/issues/286)

## Root cause, as verified

Two defects, reproduced by driving `DocxGenerator` against hand-built .docx
buffers, one per typo shape the reporter described.

1. **Detail existed and was discarded.** A malformed delimiter makes
   docxtemplater throw a `multi_error` carrying one entry per bad tag —
   `id`, `context`, `offset`, `explanation`, `file`. The `catch` in
   `extractTags` collapsed all of it into "Failed to parse DOCX template.
   Ensure the file is a valid .docx and all {{tags}} are correctly formed."
   and never read `cause` again. `extractFields` and `XlsxGenerator` did the
   same.

2. **Some typos raised nothing at all.** Both generators read tags with a
   non-greedy `/\{\{([\s\S]*?)\}\}/`, which spans a mistyped opening brace
   forward into the next well-formed tag. `{{ Client Name and {{ Other Field }}`
   became the single field `client_name_and_other_field`; `{{ Client Name }] and
   {{ Ok }}` became `client_name_and_ok`. docxtemplater was then handed a valid
   document, the upload succeeded, and the node config stored the wrong schema
   with no warning. This half was not in the triage comment and is the more
   damaging of the two.

Separately, `(signature)` was rejected as an unknown annotation even though
`signature` is the parsed type name, the annotator's type-picker value and every
internal identifier for the slot.

## Fix applied

- **`packages/domain/src/errors/domain-error.ts`** — `DomainError` gains optional
  `details?: readonly DomainErrorDetail[]` (`{ subject, message }`): the
  offending input quoted as the author wrote it, and what is wrong with it.
  `domainError()` takes it as an optional 4th argument, so no existing call site
  changed.
- **`packages/domain/src/entities/template-field.ts`** — `SIGNATURE_KEYWORDS`
  makes `(signature)` a synonym of `(approval)` in both `applyAnnotation` and the
  `isSignatureTag` safety filter (ADR-043 §2). `(approval)` remains the canonical
  form `templateFieldToLine` writes back, so the annotator round-trip is
  unchanged.
- **`packages/adapters/src/documents/tag-syntax.ts`** (new) — the shared scanner.
  `tagSyntaxIssues` requires `{{` and `}}` to strictly alternate across one run
  of text, catching an unclosed `{{`, a stray `}}`, a second `{{` before the
  first closes, and a lone brace inside a tag body. Single braces stay plain
  text, so `{ key: value }` in prose is untouched. `detailsFromCause` unwraps
  docxtemplater's `multi_error`; `detailsFromTagContent` re-runs the per-tag
  parser over every tag so all bad ones are listed, not just the first;
  `headlineFor` words the error as one sentence for a lone issue and a count for
  several.
- **`packages/adapters/src/documents/docx-generator.ts`** — scans the body,
  headers and footers before `preprocessTemplate` normalises a broken tag into a
  plausible-looking one; names the part an issue sits in.
- **`packages/adapters/src/documents/xlsx-generator.ts`** — the same scan inside
  `collectRawTags`, so the upload route and the renderer cannot diverge (ADR-039).
  Issues name the cell reference, e.g. "(in cell B2)".
- **`apps/web/src/lib/template-route-helpers.ts`** — carries `details` into the
  422 body.
- **`apps/web/src/components/canvas/template-error-model.ts`** (new) — normalises
  the JSON payload into a headline plus validated, deduplicated rows. A repeated
  Word header reports the same tag once per page, so identical rows collapse.
- **`apps/web/src/components/canvas/template-annotation-modal.tsx`** — the error
  strip becomes `TemplateErrorPanel`: the headline, then one row per broken tag
  showing the author's own text above what is wrong with it.
- **`apps/web/src/components/canvas/annotation-reference.tsx`** — the in-app
  reference notes that `(signature)` means the same as `(approval)`.

## Regression tests added

- `packages/adapters/src/documents/docx-generator.test.ts` — a `malformed tags`
  block covering each typo shape: wrong opening bracket, unclosed tag, wrong
  closing bracket, stray `}}`, several in one document, one in a page header, and
  a corrupt file that still yields the generic message with no details. The two
  merge cases failed before the fix by *passing* — returning a bogus tag — which
  is the guard that matters.
- `packages/adapters/src/documents/xlsx-generator.test.ts` — parity, including
  the cell reference.
- `packages/domain/src/entities/template-field.test.ts` — `(signature)` parses to
  `type: "signature"`, is held to the same constraints as `(approval)`, is seen
  by `isSignatureTag`, and serialises back out as `(approval)`.
- `apps/web/src/components/canvas/template-error-model.test.ts` — headline
  fallback, malformed payloads, deduplication, and entries with nothing to point
  at.

## E2E test

**None.** `apps/web` has no component-test harness — no `.test.tsx` files and no
jsdom environment — so the modal's list-building lives in a pure helper that
vitest covers directly. The behaviour is not one of the six groups in
[`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md); the adapter
regression tests are the guard, and they run on every `./validate.sh`.

## Dependency advisories cleared

`./validate.sh` was already failing on this branch's base for high and critical
advisories unrelated to this change. Cleared so the gate is green, by raising
`pnpm.overrides` in the root `package.json` and the two direct declarations:

| Package | To | Advisories |
|---|---|---|
| `next` | `>=15.5.24` (also `apps/web`) | GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4 (both critical RCE) |
| `@xmldom/xmldom` | `>=0.9.12` | 11 highs — injection bypasses and quadratic parsing, reached via docxtemplater |
| `nodemailer` | `>=9.1.0` (also `packages/adapters`) | GHSA-2x7j-588g-ccc2 |
| `sharp` | `>=0.35.4` | GHSA-rgj7-g3m4-5g8c |
| `js-yaml` | `>=3.15.2` / `>=4.3.2` | GHSA-2883-xcg3-v3hh |

No advisory was allowlisted — `ALLOWED_ADVISORIES` in `scripts/audit-check.sh`
stays empty.

## Known limitations

- The scan reads reconstructed run text, so a literal `{{` written as prose in a
  template is reported as a malformed tag. docxtemplater already rejected most
  such documents, and a template that wants a literal `{{` has no way to say so
  today.
- Templates that upload cleanly today only because of the silent merge will start
  failing. That is the correction, but it will read as a regression to anyone
  holding such a file — they now get a named error pointing at the typo.
