# Bug fix — sweep every fixable npm advisory on alpha-2, and stop the audit gate skipping itself

Source: maintainer request to pre-empt Dependabot's security PRs in one change. No issue.
Severity: major — runtime dependencies of `apps/api` and `apps/web` (MCP SDK's hono and
express, OTel exporters, langgraph) carry moderate advisories, and the high/critical
audit gate was not running.

## Symptom

- `pnpm audit` on `release/alpha-2` (0.28.37) reports 39 findings: 1 high, 33 moderate, 5 low.
  No Dependabot PRs were open yet; each fixable advisory would have arrived as its own
  security update over the following days.
- `./scripts/audit-check.sh` printed `SKIP — pnpm audit endpoint unavailable` although the
  endpoint answered, so neither `validate.sh` section 11 nor CI ran the gate.

## Reproduction

```sh
pnpm audit --json | node -e '…metadata.vulnerabilities…'
# {"info":0,"low":5,"moderate":33,"high":1,"critical":0}
./scripts/audit-check.sh
# SKIP — pnpm audit endpoint unavailable; dependency audit not run.
```

## Root cause

- **Advisories:** every flagged package is transitive, and nothing in the root
  `pnpm.overrides` held it above the patched release — `qs` and `body-parser` under
  `express`, `hono`/`@hono/node-server`/`ip-address`/`fast-uri` under
  `@modelcontextprotocol/sdk`, `@opentelemetry/core` under the 0.218 exporters,
  `protobufjs` (the existing `>=7.6.1` override resolved 8.6.3), `fast-copy` under
  `pino-pretty`, and `uuid` 9/10 under `@langchain/core` and `@langchain/langgraph-sdk`.
  `fast-uri` and `ip-address` were already overridden, but below the newest advisories.
- **Gate:** `audit-check.sh` decides "endpoint unavailable" by grepping the whole audit
  output for outage strings, `410` among them. The `ai` advisory GHSA-rwvc-j5jr-mgvh
  references commit `930399bb9839a8baf3d349614106d78268775eed`, which contains `4106`, so a
  valid report read as an outage and the gate exited 0 without filtering anything.

## Fix plan

- Root `pnpm.overrides`: raise or add each package to its first patched release, bounded
  to its current major. `uuid@9`/`uuid@10` → `^11.1.1` is the one cross-major override:
  langchain calls only `v4`/`v5`/`validate`, which 11 keeps, and 11 still ships CommonJS.
- `audit-check.sh`: apply the outage match only when the output is not an audit report
  (valid JSON with `advisories`).

## Implementation summary (v0.28.38)

**Fix applied — `package.json` `pnpm.overrides`:**

| Package | Override | Resolves | Advisories cleared |
|---|---|---|---|
| `qs` | `>=6.16.0 <7` | 6.16.1 | GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g |
| `body-parser@1` | `>=1.20.6 <2` | 1.20.8 | GHSA-v422-hmwv-36x6 |
| `protobufjs` | `>=8.6.6 <9` (was `>=7.6.1`) | 8.8.1 | GHSA-jfj6-75fj-8934, GHSA-j3f2-48v5-ccww |
| `hono` | `>=4.13.7 <5` | 4.13.13 | 9 hono advisories, incl. GHSA-hxh3-vqpv-xpqv (JSX XSS) and GHSA-f23p-vx2j-j53r |
| `@hono/node-server` | `>=1.19.15 <2` | 1.19.17 | GHSA-frvp-7c67-39w9 |
| `@opentelemetry/core` | `>=2.8.0 <3` | 2.10.0 | GHSA-8988-4f7v-96qf |
| `ip-address` | `>=10.7.1 <11` (was `>=10.3.1`) | 10.7.4 | 4 SSRF / allowlist advisories |
| `fast-uri` | `>=3.1.8 <4` (was `>=3.1.6 <4`) | 3.1.8 | GHSA-hrr3-gc8f-f4qj |
| `fast-copy` | `>=4.1.0 <5` | 4.2.0 | GHSA-jggr-w7fw-pc2j |
| `uuid@9`, `uuid@10` | `^11.1.1` | 11.1.1 | GHSA-w5hq-g745-h8pq |

`pnpm-lock.yaml` regenerated with `pnpm install`; the e2e lockfile
(`apps/web/e2e/package-lock.json`) already audited clean and is unchanged.

**Fix applied — `scripts/audit-check.sh`:** parses the output first; the outage grep runs
only when it is not an audit report.

**Result:** `pnpm audit` 39 → 10 findings (8 advisories), all in *Remaining* below.
`audit-check.sh` now runs and reports the allowlisted braces finding.

**Regression guard:** no application logic changed, so no unit test was added. Both
fixes were reproduced first and then shown fixed: the audit counts above, and
`audit-check.sh` run three ways — the real report (was `SKIP`, now filters and passes),
a fake `pnpm` printing `ERR_PNPM_AUDIT_BAD_RESPONSE … 410` (still `SKIP`), and a fake
non-allowlisted high advisory whose text contains `410` (now exit 1; previously `SKIP`).
`./validate.sh` passes with the full unit suite on the new versions.

**E2E:** none — dependency resolution and a CI script fall in no group of
`e2e-test-policy.md`.

**Deviation from the approved summary:** the `audit-check.sh` fix was added mid-run, with
approval, after validate exposed the false skip. The `protobufjs` change raises the
existing catch-all override rather than adding a `protobufjs@8` selector, because the
catch-all took precedence and every consumer already resolves 8.x.

## Remaining — not fixable without a breaking upgrade

| Advisory | Package | Why it stays |
|---|---|---|
| GHSA-rwvc-j5jr-mgvh (low) | `ai@4.3.19` | Patched only in 5.x; the v4 → v5+ SDK migration is its own piece of work |
| GHSA-866g-f22w-33x8 (low) | `@ai-sdk/provider-utils` 2.x | Patched only in 3.x, pulled by `ai` 4 and `@ai-sdk/amazon-bedrock` 1 — goes with the same migration |
| GHSA-528h-pc64-c93x, GHSA-hqr4-qq8f-hg3x, GHSA-mjw6-4jj6-33hc (moderate) | `stream-json@1.9.1` | Patched only in 3.x; `minio@8.0.7` (latest) declares `^1.8.0` |
| GHSA-vcc3-ghjq-m6fr (moderate) | `decode-uri-component@0.2.2` | Patched only in 0.5; `minio` → `query-string@7` requires `^0.2.2` |
| GHSA-vfj7-8cjw-p6xm (high) | `braces@3.0.3` | No patched release; already in `scripts/audit-allowlist.sh` |
| GHSA-hp3w-g68c-fv3c (moderate) | `sprintf-js` 1.0.3 / 1.1.3 | No patched release |

Dependabot may still open PRs for the `ai` and minio-chain advisories; they need a major
upgrade and will fail CI the same way #328 did.
