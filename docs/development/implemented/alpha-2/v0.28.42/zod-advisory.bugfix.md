# Bug fix — zod GHSA-mrhx-c7xc-m3w5 fails the OSV gate on alpha-2

Source: found while fixing the Dependabot alerts (#350 on alpha-2, the lambda fix on `main`). No issue.
Severity: major — a high advisory turns `scripts/osv-check.sh` red, in `./validate.sh` and CI.

## Symptom

```sh
./scripts/osv-check.sh
# high — pnpm-lock.yaml: zod@3.25.76 — GHSA-mrhx-c7xc-m3w5 — Zod can exhaust memory …
# high — pnpm-lock.yaml: zod@4.4.3  — GHSA-mrhx-c7xc-m3w5
```

## Root cause

The advisory (uncontrolled issue accumulation in array validation) is patched only in zod
4.6.6. The lockfile holds zod 4.4.3 (better-auth) and zod 3.25.76 — the last 3.x, with no fix.

## Fix

- Root `pnpm.overrides`: `zod@4` → `>=4.6.6 <5`; better-auth's copy moves to 4.6.7.
- `scripts/audit-allowlist.sh`: GHSA-mrhx-c7xc-m3w5 waived for zod 3, with its reason and
  removal condition. Maintainer decision after a zod 4 migration was investigated:
  - `ai@4`, the `@ai-sdk/*` 1.x providers, `@langchain/core@0.3` and `@langchain/langgraph@0.2`
    hard-depend on zod 3, so migrating our own schemas leaves zod 3 in the lockfile.
  - AI SDK 4 converts schemas with `zod-to-json-schema`, which renders a zod 4 schema as an empty
    JSON schema (verified), stripping every `generateObject` call of its output schema.
  - The way out is the AI SDK 5+ / LangChain 1.x / zod 4 migration.

The override and allowlist lines are identical to `main`'s, so the forward-merge is a no-op.

## Regression guard

No application logic changed. `osv-check.sh` exits 1 before and 0 after (zod 3 shown as
allowlisted); `./validate.sh` passes with the full suite on zod 4.6.7.

**E2E:** none — dependency resolution falls in no group of `e2e-test-policy.md`.

## Added: body-parser GHSA-27r3-jxmh-p828

`pnpm audit` (high): body-parser DoS via trailing bytes after a compressed request body,
patched in 1.20.9 and 2.4.0. It failed `audit-check.sh` on `release/alpha-2` and on #345.

- `body-parser@1` override `>=1.20.6 <2` → `>=1.20.9 <2` (express 4's `~1.20.3`; resolves 1.20.9).
- New `body-parser@2` override `>=2.4.0 <3` (express 5's `^2.2.1`; resolves 2.4.0, which adds
  `content-type@2.1.0` and `iconv-lite@0.7.3`).

`audit-check.sh`: exit 1 → exit 0 (zod 3 allowlisted). Both are reached through Express
(MCP SDK and `apps/api`), so this one is runtime, not tooling.

Version stays 0.28.42: this change rides into #345 (unattended automation), which carries
that version, rather than shipping as its own release.
