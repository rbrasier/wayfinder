# v1.11.1 — Reject untagged template uploads + tag explainer dialog

**Version bump**: PATCH (no schema change; stricter validation + UI affordance)
**Date**: 2026-05-27

## Why this exists

v1.11.0 introduced AI-based structural summarisation for `.docx` templates
but kept the upload route permissive: a template containing zero
`{{ tag }}` placeholders was still accepted, stored, summarised by the
LLM, and persisted against the node. Document generation against that
template later produced a useless copy of the source file. The user
discovered this only at runtime, not at upload time.

The original brief explored AI-based tag insertion (have the same model
that summarises the template also propose tags for it). That was
rejected in favour of a stricter check plus an in-product explainer: an
AI rewriting a user's template silently is surprising and the existing
generation path relies on the raw `.docx` bytes in object storage, so
auto-insertion would also need to rewrite the stored file.

## What changed

### Server — hard 422 on zero-tag uploads

`apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` now
inspects `extractTags()` and rejects uploads with zero placeholders
before any storage write or LLM call:

```ts
if (validationResult.data.tags.length === 0) {
  return NextResponse.json(
    {
      error: "This template has no {{ tag }} placeholders. …",
      code: "NO_TEMPLATE_TAGS",
    },
    { status: 422 },
  );
}
```

The new `code` field lets the client distinguish this specific failure
from other 422 responses (extraction failure, oversized structural
content). Other rejection branches are unchanged and continue to return
only `{ error }`.

The guard runs before `objectStorage.put` and before
`summariseTemplate.execute`, so a rejected upload costs neither a storage
write nor an LLM call.

### Client — TemplateTagsHelpDialog + auto-open on rejection

New component `apps/web/src/components/canvas/template-tags-help-dialog.tsx`
explains the tag convention in plain language with a 3-line worked
example. Uses the existing `Dialog` primitives.

`apps/web/src/components/canvas/node-config-modal.tsx` opens the
explainer dialog in two situations:

1. The upload response carries `code === "NO_TEMPLATE_TAGS"` — the inline
   error message appears under the upload area *and* the dialog
   auto-opens.
2. The user clicks the new `(?)` (`HelpCircle`) icon next to the "DOCX
   template" label — useful for reading the explainer before uploading.

Both triggers flip the same `helpDialogOpen` state.

### Client — callback type widened

`handleUploadTemplate` in
`apps/web/src/app/(user)/flows/[id]/config/_content.tsx` and the matching
`NodeConfigModalProps.onUploadTemplate` widen their error branch to
`{ error: string; code?: string }` so the new `code` field reaches the
modal.

### Tooling — vitest alias config for apps/web

`apps/web/vitest.config.ts` was added because the new dialog component
imports `@/components/ui/*` and the existing apps/web test runner had no
alias config (previous component tests happened to avoid `@/` imports).
A single `resolve.alias` entry mirrors the `paths` map in
`apps/web/tsconfig.json`.

## Files modified

| File                                                                                  | Change                                                                            |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`                    | Zero-tag rejection with `code: "NO_TEMPLATE_TAGS"`                                |
| `apps/web/src/components/canvas/template-tags-help-dialog.tsx`                        | NEW — explainer dialog                                                            |
| `apps/web/src/components/canvas/template-tags-help-dialog.test.tsx`                   | NEW — smoke test                                                                  |
| `apps/web/src/components/canvas/node-config-modal.tsx`                                | (?) icon, `helpDialogOpen` state, auto-open on `NO_TEMPLATE_TAGS`                 |
| `apps/web/src/app/(user)/flows/[id]/config/_content.tsx`                              | `handleUploadTemplate` surfaces `code`                                            |
| `apps/web/vitest.config.ts`                                                           | NEW — `@/*` alias for vitest                                                      |
| `VERSION`, `package.json`                                                             | Bumped to `1.11.1`                                                                |

No changes to `packages/domain`, `packages/application`,
`packages/adapters`, or `packages/shared`.

## Out of scope

- AI-based tag insertion — rejected during design. If revisited, would
  also need to rewrite the stored `.docx` bytes, since document
  generation reads raw bytes from object storage, not extracted text.
- Backfilling existing tag-free templates — they continue to behave as
  before; only new uploads are guarded.

## Acceptance evidence

- `./validate.sh` passes (14/14).
- Manual verification: tag-free `.docx` upload returns 422 with the new
  error code; the modal auto-opens the explainer dialog while showing
  the inline error. Tagged uploads succeed as before. Clicking the `(?)`
  icon opens the same dialog independently of upload state.
