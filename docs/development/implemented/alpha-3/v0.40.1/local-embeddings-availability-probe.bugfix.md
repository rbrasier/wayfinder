# Bug Fix — Local embeddings reported as "not packaged" on a workspace install

- **Status**: Implemented
- **Target version**: **PATCH** — **0.40.1** (behaviour fix, no schema change)
- **Base branch**: `main` (the probe arrived with 242d845, which is not on `release/alpha-2`)
- **Source issue**: none
- **Severity**: Major — retrieval fails locally and re-indexing cannot recover it

## Approved change summary

Resolve `onnxruntime-node` from `@huggingface/transformers`' own install location
instead of from `packages/adapters`, so the availability probe reports the local
provider as available on any pnpm or npm install. A Lambda zip without the native
runtime still reports it as unavailable. No schema or data impact; stored vectors
are untouched and need no re-index.

- **Goal** — on a normal local install, local embeddings show as available and
  retrieval works again.
- **Rule as meant** — "local" is unavailable only when the artefact genuinely lacks
  the transformers pipeline or the onnxruntime native runtime (ADR-056 §4).
- **Rule today** — "local" is unavailable whenever pnpm has not placed
  `onnxruntime-node` where `packages/adapters` itself can resolve it.
- **Files** — `packages/adapters/src/ai/local-embeddings-adapter.ts` and its test.
- **Tests** — a regression unit test with a resolver that mimics pnpm's strict
  layout; no e2e (not one of the six policy groups).

## 1. Symptom

Admin → RAG Embeddings, with provider "Local (in-process)", shows:

> This deployment was packaged without the local embedding runtime, so only hosted
> providers can be selected. Retrieval will fail until a hosted provider is
> selected and documents are re-indexed.

Retrieval fails, and a re-index does not help. ("Model dimensions 384 / Stored
dimensions 1024" is expected: vectors are padded to the 1024-wide column.)

## 2. Reproduction

1. `pnpm install` the workspace (strict pnpm layout, the default).
2. Start the app without `NODE_PATH` pointing at `node_modules/.pnpm/node_modules`
   — pnpm 10 command shims no longer set it; pnpm 9 shims do.
3. Open Admin → RAG Embeddings: the "packaged without" note appears.

Directly: `createRequire("packages/adapters/x.js").resolve("onnxruntime-node")`
throws `MODULE_NOT_FOUND`, while `@huggingface/transformers` resolves.

## 3. Root cause (verified)

`isLocalEmbeddingsAvailable` resolved both `@huggingface/transformers` and
`onnxruntime-node` from `packages/adapters`. Only the former is a direct dependency
of adapters; `onnxruntime-node` is a dependency of transformers. pnpm links only
direct dependencies beside a package, so the second lookup succeeds only through
`NODE_PATH` reaching pnpm's hidden hoist directory. Next's webpack leaves
`createRequire(import.meta.url)` as a runtime call (verified by bundling the probe
with Next's compiled webpack), so the outcome depends entirely on that
environment variable. CI runs pnpm 9, whose shims set it, which is why the
"resolves through Node by default" test kept passing.

The probe gates more than the banner: `createEmbeddingsProvider` passes it as
`availability.local`, so the dispatching adapter refuses to embed — which is why
retrieval and re-indexing both fail.

## 4. Fix

Resolve `@huggingface/transformers` from adapters, then resolve `onnxruntime-node`
from the resolved transformers entry file — the place transformers itself loads it
from at runtime. A Lambda zip that drops `onnxruntime-node` still fails the second
lookup.
