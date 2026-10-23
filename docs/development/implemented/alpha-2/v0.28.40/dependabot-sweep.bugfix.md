# Bug fix — clear the open Dependabot alerts that have a safe fix on alpha-2

Source: maintainer request from the Dependabot alerts page (15 open). No issue.
Severity: major — three high advisories (follow-redirects ×2, launch-editor via vite) fail
the `audit-check.sh` and `osv-check.sh` gates on `release/alpha-2`.

## Symptom

- Dependabot lists, among others: follow-redirects GHSA-8r9p-f939-6h3c and
  GHSA-q3jh-wrc6-jgq8 (high) in `apps/web/e2e/package-lock.json`; launch-editor
  GHSA-587h-7wmj-h5pm (high) plus two moderates via vite in `deploy/lambda/package-lock.json`;
  stream-json ×3, decode-uri-component and sprintf-js (moderate) in `pnpm-lock.yaml`.
- `deploy/lambda` exists only on `main`, but alpha-2's root lockfile resolves the same
  vulnerable vite 6.4.3, and `@vitest/mocker` 4.1.11 (two moderates, patched in 4.1.12).

## Reproduction

```sh
./scripts/audit-check.sh   # exit 1 — high — vite — GHSA-587h-7wmj-h5pm
./scripts/osv-check.sh     # exit 1 — follow-redirects@1.16.0 ×2 (e2e lockfile), vite@6.4.3
```

## Root cause

- `pnpm.overrides` pinned `vite` to `^6` and `vitest` to `^4.1.11`, and the lockfile held
  vite 6.4.3 / vitest 4.1.11 — both below their first patched releases (6.4.4, 4.1.12).
- `apps/web/e2e/package-lock.json` resolved `follow-redirects@1.16.0` under `wait-on` →
  `axios`; nothing raised it to the patched 1.16.1.

## Fix plan

- Root overrides: `vite` → `>=6.4.4 <7`, `vitest` → `^4.1.12`; raise the workspace
  `vitest` / `@vitest/coverage-v8` ranges to `^4.1.12` (coverage-v8 peers on an exact vitest).
- e2e `overrides`: `follow-redirects` → `^1.16.1`, lockfile rebuilt with `--package-lock-only`.

## Approved change summary

One PR against `release/alpha-2` patches every alert with a same-major fix: follow-redirects
1.16.1 (e2e lockfile), vite ≥6.4.4 (clears the launch-editor alerts on alpha-2's root
lockfile) and vitest/@vitest/mocker 4.1.12. The minio-chain alerts (stream-json,
decode-uri-component) and the withdrawn sprintf-js advisory cannot be overridden without
breaking MinIO and are dismissed in Dependabot instead. PATCH bump 0.28.39 → 0.28.40.

## Implementation summary (v0.28.40)

**Fix applied:**

| Lockfile | Package | Override | Resolves | Advisories cleared |
|---|---|---|---|---|
| `pnpm-lock.yaml` | `vite` | `>=6.4.4 <7` (was `^6`) | 6.4.5 | GHSA-587h-7wmj-h5pm (high), launch-editor `%` escaping and CLI-flag injection, Vite custom-middleware and `server.fs.allow` advisories |
| `pnpm-lock.yaml` | `vitest` (→ `@vitest/mocker`) | `^4.1.12` (was `^4.1.11`) | 4.1.12 | Vitest manual-mock code injection, Windows backslash redirect-allowlist bypass |
| `apps/web/e2e/package-lock.json` | `follow-redirects` | `^1.16.1` (new) | 1.16.1 | GHSA-8r9p-f939-6h3c, GHSA-q3jh-wrc6-jgq8 (high) |

Workspace `vitest` and `@vitest/coverage-v8` ranges raised to `^4.1.12` in `apps/api`,
`apps/web`, `mocks` and every `packages/*` that declared them.

**Regression guard:** no application logic changed, so no unit test was added. The guard is
the pair of advisory gates `./validate.sh` and CI already run: both were reproduced failing
first (above) and now exit 0 with only the allowlisted braces finding. `wait-on` was
smoke-tested following a 302 on follow-redirects 1.16.1; the full vitest suite runs on
4.1.12 / vite 6.4.5 in `./validate.sh`.

**E2E:** none — dependency resolution falls in no group of `e2e-test-policy.md`.

**Deviation from the approved summary:** none.

## Remaining — dismiss in Dependabot, not fixable here

| Alert | Package | Why |
|---|---|---|
| #49, #63, #64 | `stream-json@1.9.1` | Patched only in 3.x (ESM-only, drops `jsonl/Parser.js`, which `minio@8.0.7` — latest — `require`s at load). Only `listenBucketNotification` uses it, which Wayfinder never calls. |
| #45 | `decode-uri-component@0.2.2` | Patched only in 0.5 (ESM-only; `require` from `query-string@7` returns `{ default }`, breaking decode). minio only calls `qs.stringify`, so the decoder is never reached. |
| #68 | `sprintf-js` | Advisory withdrawn upstream. |
| #71, #72, #73 | `launch-editor` via vite in `deploy/lambda/package-lock.json` | That lockfile exists only on `main`; needs its own fix there. |

Dependabot scans the default branch, so the alerts fixed here close once alpha-2 is
forward-merged into `main`.
