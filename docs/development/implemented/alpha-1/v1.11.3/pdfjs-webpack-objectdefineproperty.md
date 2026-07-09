# Bug: `Object.defineProperty called on non-object` on app load

## Root Cause

`pdf-parse` (v2.x) depends on `pdfjs-dist/legacy/build/pdf.mjs`, which is a
pre-bundled webpack artifact — the file opens with `var __webpack_modules__ = ({...})`
and uses `Object.defineProperty` calls on webpack module-export objects internally.

When Next.js's own webpack processes this file as part of bundling the adapters
package, those pre-bundled webpack internals are re-evaluated in the new bundle
context. The `Object.defineProperty` targets no longer exist as expected, so the
call throws `Object.defineProperty called on non-object`.

The error surfaces at import time (the `eval` frame in the stack trace) because
`pdfjs-dist` runs side-effectful top-level code during module initialization.

## Reproduction Steps

1. Run the Next.js dev or production server.
2. Navigate to the root page (`/(user)`).
3. The page fails with `RuntimeError: Object.defineProperty called on non-object`.
   Stack shows `document-extractor-service.ts` → `pdf-parse` → `pdfjs-dist/legacy/build/pdf.mjs`.

## Affected Files

- `packages/adapters/src/extraction/document-extractor-service.ts` — imports `pdf-parse`
- `apps/web/src/lib/container.ts` — instantiates `DocumentExtractorService`, pulling the import chain into the page bundle
- `apps/web/next.config.ts` — missing `serverExternalPackages` entries

## Fix Plan

Add `"pdf-parse"` and `/pdfjs-dist/` directly to webpack `config.externals` in the
`webpack` callback in `apps/web/next.config.ts` for the `isServer` context.

`serverExternalPackages` is insufficient here because it uses a resolver-based
approach: it resolves the full pnpm virtual-store path first
(e.g. `.pnpm/pdf-parse@2.4.5/node_modules/pdf-parse/dist/pdf-parse/esm/index.js`)
and then checks the package name. For dependencies of packages listed in
`transpilePackages`, this resolver chain is bypassed and the externals check never
fires. Adding explicit webpack externals intercepts at the import-request level
(`"pdf-parse"`) before any path resolution, which does work.

No changes to `document-extractor-service.ts` are needed — the import and usage
are correct for the `pdf-parse` v2.x API.

## Implementation Summary (v1.11.3)

**Root cause confirmed:** `pdfjs-dist/legacy/build/pdf.mjs` is a pre-bundled webpack
artifact. Next.js's webpack re-evaluates it when bundling `@rbrasier/adapters`
(a `transpilePackages` entry), causing `Object.defineProperty` on a non-existent
exports object.

**Why `serverExternalPackages` alone failed:** It resolves the full pnpm store path
first, then checks the package name. For deps of `transpilePackages` this resolution
chain is bypassed, so the externals opt-out never fires.

**Fix applied:** Added `"pdf-parse"` (string) and `/pdfjs-dist/` (RegExp) to webpack
`config.externals` inside the `webpack` callback for `isServer: true` in
`apps/web/next.config.ts`. These entries intercept at the import-request level before
resolution, ensuring webpack emits a native `require()` instead of inlining the
pre-bundled webpack artifact.

**Regression test:** The existing test at
`packages/adapters/src/extraction/document-extractor-service.test.ts` covers the PDF
extraction path (including the invalid-buffer error path) and would detect any future
import-time breakage of `pdf-parse` in the Node.js/vitest context.
