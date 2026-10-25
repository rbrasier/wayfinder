# Bug fix — forward-merge release/alpha-2's fixes (0.28.40–0.28.44) into main

Source: scheduled forward-merge (`/release` Operation C, CONTRIBUTING §2). No issue.
Severity: minor — security-scan and dependency hygiene; no product behaviour changes.

## Symptom

`release/alpha-2` is 65 commits ahead of `main` (last forward-merge: v0.28.39). `main`
lacks the Semgrep scan that actually runs, the pinned CI actions, and the advisory
patches shipped on the release line.

## Root cause

Fixes land on `release/alpha-2` first and reach `main` only by forward-merge.

## Not merged (deliberately)

A plain `git merge origin/release/alpha-2` conflicts in ~50 files because the release line
also carries feature-sized work that `main` does not have and must not take wholesale:
unattended automation (event watch, webhook start, AI task / Email steps, v0.28.41),
MCP token storage and the MCP tool-use changes (v0.28.4x), the Event Watch / chat-status UI,
and the e2e specs and warm-route changes written for them. Per the maintainers' rule, `main`
keeps its shape; only the standalone fixes were carried across by hand. The skipped work
needs its own reviewed port.

## Fix — what came across

- **v0.28.43 / v0.28.44 Semgrep** (`ea38cdd`, `009cf38`): `scripts/semgrep-check.sh` + test,
  CI installs a pinned Semgrep CLI and fails when the scan does not complete, `validate.sh`
  §11c, every GitHub Action pinned to its commit SHA, `dependabot.yml` 7-day cooldown, the
  Dockerfile runs as `node`, `settings-encryption` finding, `pnpm-workspace.yaml`. Their
  bugfix docs are kept under `implemented/alpha-2/` for traceability.
- **v0.28.42 body-parser** (`992bba4`): `body-parser@1` `>=1.20.9`, new `body-parser@2`
  `>=2.4.0` override (GHSA-27r3-jxmh-p828).
- **v0.28.40 vitest** (`57bdf2d`, `02479af`): `vitest` / `@vitest/coverage-v8` `^4.1.12`
  across the workspace.
- `deploy/lambda/package-lock.json` (main-only, outside the pnpm workspace): `body-parser`
  2.3.0 → 2.4.0 for the same advisory, found by OSV in CI; `npm run audit` there is clean.
- Already on `main`, so no-ops: the `vite` `^6.4.4`, `zod@4` and e2e `follow-redirects`
  overrides. `pnpm-lock.yaml` was regenerated, not merged.

## Left out of the Semgrep port

`.github/workflows/waiver-review.yml` (security-waiver expiry) arrived with the MCP commit
`03cabdf` and is tied to it; it, and the e2e `onDemandEntries` / warm-route changes
(`274057d`), stay on the release line until those features are ported.

## Regression guard

`semgrep-check.test.ts` and `container-user.test.ts` came across with their fixes;
`validate.sh` enforces the rest.

**E2E:** none — CI tooling and dependency resolution fall in no group of `e2e-test-policy.md`.

Version: 0.40.2 → 0.40.3 (PATCH).
