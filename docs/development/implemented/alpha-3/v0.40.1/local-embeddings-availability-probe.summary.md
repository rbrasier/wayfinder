# Implementation Summary — Local embeddings availability probe

- **Version**: 0.40.0 → 0.40.1 (PATCH; no schema change)
- **Bug-fix doc**: [`local-embeddings-availability-probe.bugfix.md`](./local-embeddings-availability-probe.bugfix.md)

## Root cause

`isLocalEmbeddingsAvailable` resolved `onnxruntime-node` from `packages/adapters`.
It is a dependency of `@huggingface/transformers`, not of adapters, so under pnpm's
strict layout it resolved only when `NODE_PATH` reached pnpm's hidden hoist
directory (set by pnpm 9 command shims, not by pnpm 10's). Without it the probe
returned false, the admin card claimed the build lacked the local runtime, and the
dispatching embeddings adapter refused to embed — so retrieval and re-indexing
both failed.

## Fix applied

The probe resolves `@huggingface/transformers` from adapters, then resolves
`onnxruntime-node` from the resolved transformers entry file. `ModuleResolver` now
takes `(specifier, fromPath?)` and returns the resolved path.

| File | Change |
|---|---|
| `packages/adapters/src/ai/local-embeddings-adapter.ts` | Resolve the native runtime from transformers' location |
| `packages/adapters/src/ai/local-embeddings-adapter.test.ts` | Strict-pnpm-layout regression test; resolver fakes return paths |

## Tests

- Regression: "is true under a strict pnpm layout where the native runtime is
  reachable only from transformers" — failed before the fix, passes after.
- Verified against the real install with `NODE_PATH` unset: old probe false, new
  probe true.
- No e2e spec: the behaviour is not in any of the six groups in
  `docs/guides/e2e-test-policy.md`; the unit test is the guard.

## Deviations from the approved summary

None.
