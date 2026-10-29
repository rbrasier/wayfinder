# Bug fix — carry the nodemailer, fast-uri and @hono/node-server security patches onto alpha-2

Source: open Dependabot alerts #84, #86, #87, #88, #89 and the @hono/node-server
alert, plus Dependabot PR #359 (security group, opened against `main`). No issue.
Severity: minor — every advisory left is moderate or low, so none trips the
high/critical audit gate; they stay open on the Security tab until fixed.

## Symptom

`release/alpha-2` (v0.28.47) resolves versions that Dependabot and `pnpm audit`
flag:

| Package | Resolved | Patched | Advisories |
|---|---|---|---|
| `nodemailer` | 10.0.16 | >=10.1.4 | GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h (addressparser recipient confusion, moderate) |
| `fast-uri` | 3.1.8 | >=3.1.9 | GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr (moderate); GHSA-xhq7-xmqj-769h, GHSA-333x-w4r6-6crp (low) |
| `@hono/node-server` | 1.19.17 | >=2.1.3 | GHSA-rmxm-3fg6-px4f (`serveStatic` double decode, moderate) |

The fix Dependabot proposes, #359, cannot land on a release line: it targets
`main` and also moves `zod` 3 → 4 and `ai` 4 → 5, and its CI is red.

## Reproduction

```sh
pnpm audit --json | jq -r '.advisories[] | "\(.module_name) \(.github_advisory_id) \(.patched_versions)"' \
  | grep -E '^(nodemailer|fast-uri|@hono/node-server) '
```

Run on `3b2029a` this lists the eight advisories above.

## Root cause (verified)

The root `pnpm.overrides` floors sit below every patched release, and nothing
else forces a re-resolve:

- `nodemailer`: `>=10.0.6 <11`, and `packages/adapters` asks for `^10.0.6`,
  so the lockfile keeps 10.0.16.
- `fast-uri`: `>=3.1.8 <4`. It reaches us only through `ajv@8`.
- `@hono/node-server` has no override. Its sole consumer is
  `@modelcontextprotocol/sdk@1.32.1`, which declares `^1.19.9 || ^2.0.5`, so the
  lockfile keeps the 1.x line.

## Exposure and compatibility (verified)

- **nodemailer 10.1.** The 10.1.0 behaviour changes are pool idle-timeout,
  `connectionTimeout` scope, 421 handling, consumed content streams and
  opportunistic-TLS auth. `nodemailer-email-sender.ts` never sets `pool`, never
  passes stream content, and does not use `opportunisticTLS`, so none of them
  reaches Wayfinder.
- **@hono/node-server 2.x.** The MCP SDK imports only `getRequestListener`
  from it, in `server/streamableHttp.js`. Only the e2e mock MCP servers under
  `mocks/` load that module; the app imports only the SDK's client transport.
  2.1.5 still exports `getRequestListener`, needs Node >=20, and accepts our
  `hono@4` peer. `mocks/parlview/mcp.test.mjs` drives a real streamable-HTTP
  round trip through it.
- **fast-uri 3.1.9** is a patch release on the same line.

## Fix plan

- Root `pnpm.overrides`: `nodemailer` → `>=10.1.4 <11`, `fast-uri` →
  `>=3.1.9 <4`, add `@hono/node-server` → `>=2.1.3 <3`.
- `packages/adapters` `nodemailer` → `^10.1.4`.
- Regenerate the lockfile with `pnpm install --lockfile-only`, holding each
  package at the newest release older than the repo's 7-day Dependabot cooldown:
  nodemailer 10.1.7 (10.2.x and 10.3.0 are newer and carry unrelated changes),
  fast-uri 3.1.9, @hono/node-server 2.1.5.
- Run the regeneration exactly once from the base lockfile. Do it in two steps:
  first set the nodemailer override to exactly `10.1.7`, then relax it to the
  range. Without that, pnpm resolves 10.3.0. Each further full re-resolve also
  dedupes unrelated packages (e.g. the `@typescript-eslint` 7.x copies under
  `eslint-config-next`), which widens the diff for no benefit.

### Lockfile peer labels — expected, not a regression

Changing any override re-resolves the whole graph, and two things then
change in the lockfile text without changing what gets installed:

- The existing `zod@4: ">=4.6.6 <5"` override also rewrites *peer* ranges.
  better-call's optional `zod ^4.0.0` peer, the MCP SDK's and
  zod-to-json-schema's `^3.25 || ^4` peers all become `>=4.6.6 <5`. pnpm
  reports them unmet against the workspace's zod 3 and labels some snapshot keys
  `better-call@1.4.4(zod@3.25.76)`. The base lockfile's `(zod@4.6.7)` labels
  cannot be reproduced by a fresh resolve; any future regeneration shows the same.
- `deprecated:` metadata is filled in for three OpenTelemetry packages.

What gets installed is unchanged. After a clean `pnpm install --frozen-lockfile`
there is one `@better-auth/core`, shared by better-auth and
`@better-auth/drizzle-adapter`, and one `better-call` (`1.4.4_zod@4.6.7`), which
loads zod 4.6.7. The warnings go away with the zod 4 migration.

## Added during review — decode-uri-component GHSA-qr28-fpjm-wq7f (high)

Published on 2026-10-29, after this PR's CI had passed. The advisory covers
`decode-uri-component <=0.5.0` (CVE-2026-118664, quadratic decoding DoS) and
is high, so the audit gate (`scripts/audit-check.sh`) and the Trivy image gate
would fail on `release/alpha-2`'s next CI run, whatever the change.

- **It can't be fixed.** The only patched release is 0.5.1. 0.4+ is ESM-only,
  and the sole consumer, `query-string@7.1.3` (from `minio@8.0.7`, minio's
  latest, which pins `^7`), loads it with `require()`.
- **It isn't reached.** minio's `dist/main` and `dist/esm` call `query-string`
  only through `stringify()` (12 call sites) and never `parse()`, so the decoder
  never runs. Nothing else in the lockfile depends on `decode-uri-component`.
- **It's waived** in `scripts/audit-allowlist.sh` and `.trivyignore`, with a
  REMOVE WHEN of "minio drops query-string@7, or a fix lands on the 0.2 line".
- **The waiver rule is corrected.** `scripts/waiver-rules.mjs` judged
  reachability by the bare major, so it called 0.2.2 → 0.5.1 "within the major in
  use" and would have failed the waiver as fixable. Under semver each 0.x minor is
  its own breaking line: `^0.2.2` never resolves 0.3, and this upgrade genuinely
  breaks (ESM-only). The rule now compares release lines (the major, or the minor
  below 1.0). Two tests pin it: a later 0.x minor is "needed", and a patch on the
  same 0.x line is still "fixable".

## Not done here

- **zod 3** (alerts #76, #77, #78, #81). No 3.x fix exists, and it is already
  waived in `scripts/audit-allowlist.sh`. Clearing it needs zod 4 together with
  AI SDK 5, `@ai-sdk/*` 2.x and LangChain 1.x. That migration follows as its own PR.
  Alert #82 (the transitive zod 4 copy) is already fixed in the lockfile at 4.6.7.
- **ai 4 → 5** (two low advisories) goes in that same migration.
- **stream-json** (#49, #63, #64) and **decode-uri-component** (#45) come in
  through `minio@8.0.7`, which is minio's latest and still requires `stream-json ^1.8`
  and `query-string ^7` (→ `decode-uri-component ^0.2`). The patched releases
  are new majors that minio's CommonJS code cannot load. Both only parse
  responses from Wayfinder's own object store. They stay open until minio moves.
- **better-auth** — already carried to 1.7.14 by `c940b22`.
