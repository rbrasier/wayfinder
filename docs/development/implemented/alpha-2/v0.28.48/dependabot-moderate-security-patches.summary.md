# Summary — nodemailer, fast-uri and @hono/node-server security patches on alpha-2 (v0.28.48)

## Root cause

The root `pnpm.overrides` floors for `nodemailer` (`>=10.0.6`), `fast-uri`
(`>=3.1.8`) and `@hono/node-server` (`>=1.19.15 <2`) all sat below the patched
releases, so the lockfile kept nodemailer 10.0.16, fast-uri 3.1.8 and
@hono/node-server 1.19.17. That left eight moderate and low advisories open
(Dependabot alerts #84, #86, #87, #88, #89 and the @hono/node-server alert).

## Fix applied

- Root `pnpm.overrides`: `nodemailer` `>=10.1.4 <11`, `fast-uri` `>=3.1.9 <4`,
  `@hono/node-server` `>=2.1.3 <3`.
- `packages/adapters`: `nodemailer` `^10.1.4`.
- `pnpm-lock.yaml` regenerated once from the base. Exactly three packages
  move: nodemailer 10.0.16 → 10.1.7, fast-uri 3.1.8 → 3.1.9 and
  @hono/node-server 1.19.17 → 2.1.5. Each is the newest release past the 7-day
  cooldown; nodemailer is held at 10.1.7 rather than the day-old 10.3.0. The
  rest of the lockfile diff is peer-key labels and `deprecated:` metadata; see
  "Lockfile peer labels" in the bug-fix doc.
- No source code, schema or migration changes.

## Regression guard

No logic changed, so no unit test was added. The overrides are the guard,
because no resolve can fall back below the patched floors.

- Before/after: `pnpm audit` on `3b2029a` listed the eight advisories. On this
  branch it lists none for these packages. The remaining advisories are zod,
  ai, `@ai-sdk/provider-utils`, stream-json and decode-uri-component, which are
  deferred on purpose.
- `./validate.sh` passed. That covers the full unit suites: web 1,204,
  adapters 919, application 1,192, domain 960, mocks 181 and api 25.
  `nodemailer-email-sender.test.ts` (13 tests) runs on 10.1.7, and
  `mocks/parlview/mcp.test.mjs` (6 tests) runs a real MCP streamable-HTTP round trip
  through @hono/node-server 2.1.5's `getRequestListener`. OSV-Scanner,
  Semgrep, the OSV waiver re-check and drizzle-kit check were skipped locally
  (no scanner, no database) and run in CI.
- After a clean install there is still one `@better-auth/core` instance shared by
  better-auth and its drizzle adapter, and better-call loads zod 4.6.7.

## E2E

None. A dependency bump falls into none of the six groups in
`docs/guides/e2e-test-policy.md`. CI's e2e suite, which drives email and the
mock MCP servers, runs on the PR.

## Deviations from the approved summary

- better-auth dropped out of scope. While this was being analysed, `c940b22`
  (v0.28.45) had already moved it to 1.7.14 past GHSA-965c-763c-88jm,
  GHSA-r4xp-prcw-77qf and GHSA-q84f-53jg-9ppm, with the Entra `oid` carry-over.
- The version bump is 0.28.47 → 0.28.48, not 0.28.44 → 0.28.45, because the base
  moved to v0.28.47 in the meantime.
- `@hono/node-server` already had an override (`>=1.19.15 <2`), so it was raised
  rather than added.

## Not done here

- zod 3 → 4 together with AI SDK 5, `@ai-sdk/*` 2.x and LangChain 1.x
  (alerts #76, #77, #78, #81 and the two low `ai` advisories). This is the
  follow-up PR.
- stream-json (#49, #63, #64) and decode-uri-component (#45) stay open
  until `minio` moves off `stream-json ^1.8` and `query-string ^7`.
- Closing Dependabot PR #359.
