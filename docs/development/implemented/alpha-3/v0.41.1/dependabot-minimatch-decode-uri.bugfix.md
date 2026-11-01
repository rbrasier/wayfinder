# Bug fix — decode-uri-component and minimatch DoS advisories (Dependabot #90, #92, #93)

## Approved change summary

Add three targeted overrides on `release/alpha-3`. `decode-uri-component` goes to
0.5.1, with a one-line `pnpm patch` to `query-string@7`, because 0.5.1 is
ESM-only. The pnpm lockfile's `minimatch` 9.x and 10.x copies go to 11.0.1+. The
lambda's `typescript-estree` copy of `minimatch` 10 also goes to 11.0.1+.
`minimatch` 3.x is left as it is, because it does not contain the vulnerable
code. The copy of `minimatch` that `aws-cdk-lib` bundles inside its own package
cannot be overridden. That copy waits for a new upstream release.

## Advisories

| Alert | Advisory | Package | Affected | Patched |
|---|---|---|---|---|
| #90 (High) | GHSA-qr28-fpjm-wq7f | decode-uri-component | `<= 0.5.0` | 0.5.1 |
| #93 (Moderate), `pnpm-lock.yaml` | GHSA-g3hv-75wg-m249 | minimatch | `< 11.0.1` | 11.0.1 |
| #92 (Moderate), `deploy/lambda/package-lock.json` | GHSA-g3hv-75wg-m249 | minimatch | `< 11.0.1` | 11.0.1 |

## Root cause (verified)

- **decode-uri-component 0.2.2:**
  - It reaches the workspace only through `minio@8.0.7` → `query-string@7.1.3`.
  - When native `decodeURIComponent` throws, the fallback decoder runs one full-string regex replace per distinct percent-encoded run. Its cost is O(K·L).
  - The only patched version is 0.5.1, and it is ESM-only with a default export.
  - `query-string@7` is CommonJS and calls `require('decode-uri-component')` as a function. Under Node 22's `require(esm)`, that returns the module namespace, so a bare override would throw `TypeError: decodeComponent is not a function`.
  - MinIO only calls `query-string.stringify`, so the decoder is not reachable at runtime today. It is still in the dependency graph.
- **minimatch:**
  - **Vulnerable code:** the globparts amplification lives in `firstPhasePreProcess()` / `secondPhasePreProcess()`. Those functions exist from 8.x onward.
  - **What the patch changes:** I diffed 11.0.0 against 11.0.1. The fix caps `globParts` at `braceExpandMax` and skips the quadratic pairwise pass above 1000 parts.
  - **Not affected:** `minimatch` 3.1.5 has neither function. Its consumers are `eslint`, `@eslint/*` and the eslint plugins, which call it as a CommonJS default function. Moving them to 11 would break ESLint.
  - **Vulnerable copies in `pnpm-lock.yaml`:** 9.0.9 and 10.2.5, both from `@typescript-eslint/typescript-estree` 7.x and 8.x. That package only calls the named `minimatch()` export, which 11.x keeps.
  - **Vulnerable copies in `deploy/lambda/package-lock.json`:**
    - 10.2.6, from `@typescript-eslint/typescript-estree`.
    - 8.0.7, from `glob@9.3.5`, which comes in through `@node-minify/core` and `@opennextjs/aws`. The regression test found this copy. Alert #92 did not name it.
    - 10.2.5, bundled inside `aws-cdk-lib`. A bundled dependency cannot be overridden, and `aws-cdk-lib` 2.275.0, the latest release, still depends on `^10.2.6`.

## Reproduction

1. On `release/alpha-3` at 0.41.0, run `grep -n "decode-uri-component@\|minimatch@" pnpm-lock.yaml`. It shows `decode-uri-component@0.2.2`, `minimatch@9.0.9` and `minimatch@10.2.5`.
2. `deploy/lambda/package-lock.json` resolves `node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch` to 10.2.6.

## Fix plan

1. **Regression test first:** `scripts/lockfile-advisories.test.mjs` reads both lockfiles and fails on:
   - any `decode-uri-component` below 0.5.1;
   - any `minimatch` at version 8 or above that is below 11.0.1, except a copy bundled inside another package.

   `validate.sh` runs it.
2. **Root `package.json` overrides:**
   - `decode-uri-component` → `>=0.5.1 <0.6`;
   - `minimatch@9` and `minimatch@10` → `>=11.0.1 <12`.
3. **`pnpm patch query-string@7.1.3`:** read `.default` from the ESM module.
4. **`deploy/lambda/package.json`:** add an `overrides` entry so `@typescript-eslint/typescript-estree` → `minimatch` resolves to `>=11.0.1 <12`.
5. **Version:** bump PATCH to 0.41.1.

## Known limitations

- **`minimatch` 3.1.5 stays in both lockfiles.** It does not contain the vulnerable code. Dependabot's `< 11.0.1` range still flags it, so dismiss the remaining alerts as "vulnerable code is not actually used".
- **The `minimatch` 8.0.7 under `glob@9.3.5` in the lambda lockfile stays.**
  - Forcing it to 11 makes `glob@9` silently match nothing: `handlers/**/*.ts` dropped from 9 files to 0.
  - It runs only during the OpenNext build, on patterns from the build config.
  - The regression test lists it as a named exception.
- **The `minimatch` 10.2.5 bundled in `aws-cdk-lib` stays.** It only runs during `cdk synth` at deploy time, not in Lambda. It clears when `aws-cdk-lib` ships with `minimatch` 11.

## Implementation summary (v0.41.1)

- **Root cause:**
  - `decode-uri-component` 0.2.2 is reached through `minio` → `query-string@7`.
  - The pnpm lockfile has `minimatch` 9.0.9 and 10.2.5 from `typescript-estree`.
  - The lambda lockfile has `minimatch` 10.2.6 from `typescript-estree`.
  - All of these fall in the advisory ranges, and none is pinned by a direct dependency we own.
- **Fix applied:**
  - **Root `pnpm.overrides`:**
    - `decode-uri-component` `>=0.5.1 <0.6`;
    - `minimatch@9` and `minimatch@10` `>=11.0.1 <12`.

    These resolve to 0.5.1 and 11.0.3.
  - **`patches/query-string@7.1.3.patch`:** loads the ESM-only decoder through `.default`. Without it, `query-string.parse` throws `decodeComponent is not a function`. I reproduced that before patching.
  - **`deploy/lambda`:** npm `overrides` for `@typescript-eslint/typescript-estree` → `minimatch` `>=11.0.1 <12`.
    - I edited `package-lock.json` surgically, because `npm install --package-lock-only` re-resolves the whole tree, including esbuild, even with no changes.
    - Checked with CI's exact `npm ci --legacy-peer-deps`, plus the lambda typecheck, lint and tests (19 passed).
- **Waiver retired:**
  - `GHSA-qr28-fpjm-wq7f` was already waived in `scripts/audit-allowlist.sh`, and `CVE-2026-118664` in `.trivyignore`, because `query-string@7` could not load the ESM-only 0.5.1.
  - The patch removes that blocker, so both waivers are removed. `waiver-check.mjs` requires it.
- **Container image:** the `Dockerfile` copies `patches/` before `pnpm install --frozen-lockfile`, so pnpm can apply the `query-string` patch.
- **Regression test:** `scripts/lockfile-advisories.test.mjs`, run by `validate.sh` section 11e. It failed 2 of 3 cases before the fix and passes all 3 after.
- **E2E:** none. No user-facing behaviour changed, and the lockfile test is the guard.
- **Deviation from the approved summary:**
  - The test also found `minimatch` 8.0.7 under `glob@9` in the lambda lockfile.
  - Overriding it breaks `glob`, so it is a documented exception rather than a fix.
