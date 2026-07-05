# Bug Fix: onnxruntime-node webpack parse error (v1.23.1)

## Symptom

`@wayfinder/web:dev` crashes on startup with:

```
Module parse failed: Unexpected character '?' (1:0)
You may need an appropriate loader to handle this file type,
currently no loaders are configured to process this file.
```

The import trace ends at a native `.node` binary:

```
onnxruntime-node/.../onnxruntime_binding.node
← onnxruntime-node/dist/binding.js
← @huggingface/transformers/dist/transformers.node.mjs
← packages/adapters/src/ai/local-embeddings-adapter.ts
← packages/adapters/src/ai/embeddings-adapter.ts
← packages/adapters/src/ai/index.ts
← packages/adapters/src/index.ts
← apps/web/src/lib/container.ts
← apps/web/src/app/(user)/page.tsx
```

Result: `GET / 500`.

## Root Cause

`@rbrasier/adapters` is in `transpilePackages`, so webpack processes every file
it exports, including `embeddings-adapter.ts`. That file statically imports
`local-embeddings-adapter.ts`, which contains a **dynamic** `await import("@huggingface/transformers")`.

`serverExternalPackages` in `next.config.ts` already lists both
`@huggingface/transformers` and `onnxruntime-node`, but this mechanism does not
reliably prevent webpack from following dynamic imports that originate inside
a `transpilePackages` module. Webpack resolves `@huggingface/transformers` to
its Node.js conditional export (`transformers.node.mjs`), then follows that
file's own dependency on `onnxruntime-node/dist/binding.js`, which uses a
dynamic `require()` glob pattern to load the native `.node` binary. Webpack
creates a context module for that pattern, tries to parse the binary file as
JavaScript, and fails.

## Fix Plan

Add explicit regex-based webpack `externals` inside the `if (isServer)` block
in `apps/web/next.config.ts`:

- `/^@huggingface\/transformers/` — catches `@huggingface/transformers` and any
  sub-path imports (e.g. `@huggingface/transformers/dist/…`)
- `/^onnxruntime/` — catches `onnxruntime-node`, `onnxruntime-web`, and any
  sub-path imports (e.g. `onnxruntime-node/dist/binding`)

Regex externals operate at the webpack resolver level before module files are
read, which is why they work where `serverExternalPackages` (a string-list
externals hint) does not. The pattern mirrors how `pdf-parse` and `pdfjs-dist`
are already handled in the same block.

## Regression Test

This is a webpack build-configuration bug. The regression guard is `./validate.sh`
(which runs `next build` / typechecks) passing after the fix. No unit test can
exercise webpack's module-parsing phase independently.

## Version

PATCH: `1.23.0` → `1.23.1`
