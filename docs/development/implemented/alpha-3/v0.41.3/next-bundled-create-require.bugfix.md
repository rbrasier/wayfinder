# Web app: local embeddings always unavailable after Next bundles `createRequire`

## Approved change summary

When Next bundles the web server, webpack treats `import { createRequire } from
"node:module"` as a webpack feature, not a call to Node. It either resolves
lookups at build time to bundled module ids, or replaces the call with
`undefined`. So the web app always reports local embeddings as unavailable, and
the pretty dev logger never loads. The fix calls Node's real `createRequire`
through a default import of `node:module`, which webpack leaves alone. It also
removes the `next.config.ts` warning suppression that hid the logger case. A new
test runs both adapter files through Next's own webpack and guards against this
coming back.

### Goal
- Inside the web app, the admin embeddings settings correctly report local embeddings as available when `@huggingface/transformers` and `onnxruntime-node` are installed.
- Search over uploaded documents can use the local provider in the web app again.
- `pnpm dev` prints coloured pino-pretty logs in the web app, not raw JSON.
- The "Critical dependency" warning no longer appears in `next dev` output.

### Business rules changing
- **Meant to work:** local embeddings are available when the build includes the transformers and onnxruntime packages (ADR-056 §4). **Today in the web app:** always unavailable, whatever the build includes, because the package lookup is broken by bundling. The API app (not bundled) is unaffected.
- **Meant to work:** in development, logs go through pino-pretty. **Today in the web app:** always plain pino, because the `createRequire` call throws and falls back silently.

### UI / visible behaviour
- The embeddings settings card stops showing local as unavailable on builds that include it.
- Dev terminal: the warning goes away and web logs are pretty-printed.

### Risks
- Low. The API app runs unbundled and already used Node's real `createRequire`, so the new form behaves the same there.
- Removing the `ignoreWarnings` entry means any future regression in pino-logger shows up as a visible warning. That's intended.

### Out of scope
- Re-enabling the skipped e2e test that needs real embeddings: it needs the model in CI, which is a separate infrastructure decision.
- Other `noParse` and externals entries in `next.config.ts`.

### Deviations
- The report says webpack replaced the call with `undefined`. That's true for files webpack parses as `javascript/auto`. In a production `next build`, the unconditional lookup instead became a build-time module id (`6969` returned in place of a path). The failure is the same, it just takes a different form. The fix covers both.

### Build details
- **Architecture:** complies with hexagonal architecture (ADR-001). Changes are in the adapters package and the web app's build config. No new dependencies.
- **Unit tests:** one failing regression test first, in `apps/web`, which runs both adapter files through Next's bundled webpack with a Node target. No other unit tests change.
- **E2E:** none. This doesn't fit any of the six groups in `e2e-test-policy.md`, so the regression test is the guard.
- **Version:** PATCH, 0.41.2 → 0.41.3, branch `bugfix/next-bundled-create-require/claude-rbrasier`, PR against `release/alpha-3`.

## Root cause (verified)

Webpack 5's parser enables `createRequire` handling by default for Node targets
(`module.parser.javascript.createRequire`). When it sees a **named** import of
`createRequire` from `module` / `node:module`, it treats `createRequire(...)` as
a webpack-managed require function, not Node's:

- `createRequire(import.meta.url).resolve("x")`: resolved at build time. Under a
  production `next build` it returned the bundled module id (`6969`) where a file
  path should be.
- `createRequire(someRuntimeValue)`: the argument can't be analysed statically,
  so webpack emits `Critical dependency: the request of a dependency is an
  expression` and the lookup always fails.
- For files parsed as `javascript/auto` (the `.ts` sources reached through
  `transpilePackages`), the call itself compiles to `/* createRequire() */
  undefined`.

In `local-embeddings-adapter.ts`, `isLocalEmbeddingsAvailable()` resolves
`@huggingface/transformers` and then `onnxruntime-node` from transformers' own
location through those calls. Any throw is caught and reported as "unavailable".
So inside the web app it always answers `false`. `pino-logger.ts` uses the same
pattern to load `pino-pretty`. It throws, falls back to plain `pino()`, and its
warning was suppressed in `apps/web/next.config.ts` (`ignoreWarnings`) as a
supposed false positive.

A **default** import (`import nodeModule from "node:module"`) followed by
`nodeModule.createRequire(...)` is a plain property call on the external
`node:module`. Webpack doesn't rewrite it: it compiles to
`require("node:module").createRequire(...)` and returns real paths. This was
checked in a scratch Next 15.5.28 production build, where the default-import
route returned the real `next` entry path and the named-import route returned
`6969`.

## Reproduction

1. `pnpm dev`: the web dev server prints the "Critical dependency" warning for
   `packages/adapters/src/ai/local-embeddings-adapter.ts`.
2. With the transformers and onnxruntime packages installed, open admin →
   embeddings settings. Local is reported unavailable.
3. Directly: run Next's compiled webpack with `target: "node"` over the adapter
   source. The output contains `/* createRequire() */ undefined`.

## Fix plan

1. Regression test `apps/web/src/lib/__tests__/adapters-server-bundle.test.ts`:
   compile `local-embeddings-adapter.ts` and `pino-logger.ts` with
   `next/dist/compiled/webpack` (Node target, `javascript/auto`, types stripped,
   every bare import external). Assert no "Critical dependency" warning and no
   `/* createRequire() */` marker in the output. Fails today.
2. Switch both files to `import nodeModule from "node:module"` and
   `nodeModule.createRequire(...)`.
3. Remove the pino-logger `ignoreWarnings` entry from `apps/web/next.config.ts`.

## Implementation summary

- **Root cause:** a named `createRequire` import from `node:module` is rewritten
  by webpack (Next bundles `@wayfinder/adapters` into the web server). Lookups
  become build-time module ids, or the call compiles to `/* createRequire() */
  undefined`. So `isLocalEmbeddingsAvailable()` always returned `false` in the
  web app, and pino-pretty never loaded there.
- **Fix applied:** `local-embeddings-adapter.ts` and `pino-logger.ts` now
  `import nodeModule from "node:module"` and call `nodeModule.createRequire(...)`,
  which webpack leaves as Node's own. The pino-logger `ignoreWarnings` entry is
  gone from `apps/web/next.config.ts`, so a regression shows up as a visible
  warning again.
- **Regression test:** `apps/web/src/lib/__tests__/adapters-server-bundle.test.ts`
  compiles both files with Next's own `next/dist/compiled/webpack` (Node target,
  `javascript/auto`). It asserts no "Critical dependency" warning and no
  webpack-replaced `createRequire`. It failed for both files before the fix and
  passes after.
- **Confirmed in a running server:** in a scratch `next dev` (Next 15.5.28)
  importing the real adapter file with transformers and onnxruntime installed,
  `isLocalEmbeddingsAvailable()` returned `false` with 2 "Critical dependency"
  warnings before the fix, and `true` with none after.
- **E2E test:** none. The behaviour is outside the six e2e-policy groups; the
  regression test is the guard.
- **Version:** 0.41.2 → 0.41.3 (PATCH). `VERSION` and `package.json` match.
- **Deviations:** none from the approved summary.
