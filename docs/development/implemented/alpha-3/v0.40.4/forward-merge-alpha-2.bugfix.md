# Forward-merge — release/alpha-2 (0.28.45–0.28.49) into main, fixes only

Source: scheduled forward-merge (`/release` Operation C, CONTRIBUTING §2). No issue.
Version: 0.40.3 → 0.40.4 (PATCH, as requested for the merge-back).

## How it was merged

`release/alpha-2` was merged with `git merge -s ours`, so history records every release-line
commit as merged and the next forward-merge starts from here. The tree is `main`'s plus the
fixes below, ported by hand. The release line's feature work was **not** carried, because it
conflicts with shapes `main` has deliberately taken (see the previous forward-merge, v0.40.3).

## Fixes carried across

- **Unauthenticated `/v1/users` and `/v1/errors` removed** (alpha-2 v0.28.46, `e97c48cb`). Both
  API routers let anyone create, promote or delete users and read or edit the error log. User
  and error management live behind Better Auth in the web app's tRPC routers, so the routes,
  their wiring in `apps/api/src/container.ts` and the now-unused use cases there are gone.
  `removed-routes.test.ts` asserts every one of them returns 404.
- **better-auth 1.6 → 1.7** (v0.28.45, `c940b22f`). Clears GHSA-965c-763c-88jm (critical),
  GHSA-r4xp-prcw-77qf, GHSA-q84f-53jg-9ppm and the low GHSA-44jh-23m7-hpcf; 1.6.x has no backport.
  1.7 keys a Microsoft account on the id token's `oid` where 1.6 stored `sub`, so
  `entra-user-info.ts` no longer returns a user `id` and returns `null` without an `oid`, and
  migration `0059_entra_account_id_oid.sql` (data only, no schema change; alpha-2's `0049`)
  rewrites each `microsoft` row's `account_id` from `sub` to the `oid` in its own stored id token.
  Without it every existing Entra user would be relinked by email on next sign-in.
- **nodemailer, fast-uri, @hono/node-server patches** (v0.28.48, `8e5962ff`): overrides raised to
  `>=10.1.4`, `>=3.1.9` and `>=2.1.3`, clearing eight moderate/low advisories.
- **decode-uri-component waiver** (recorded with v0.28.48, `cd10326c`): GHSA-qr28-fpjm-wq7f / CVE-2026-118664
  waived with its reason, plus the waiver check now judges "fix reachable" by release line
  (minor below 1.0) so a 0.2 → 0.5 jump is not treated as takeable.
- **`pnpm/action-setup` v6.0.10 → v6.1.0** (Dependabot #357), pinned by SHA in `ci.yml`,
  `e2e.yml` and `dependabot-release-port.yml`.
- **Multi-turn chat spec on the server AI stub** (`baf69f0f`, test only). The browser-side
  stream mock's reply is dropped when the page resyncs with stored history, so counting
  assistant bubbles passed only when the poll beat the resync. The spec now scripts the
  server's AI and waits for each reply's text. `main`'s spec was identical to alpha-2's
  before the fix, so it applied unchanged.

The release line's own docs for these fixes came across with them, under
`implemented/alpha-2/v0.28.45`, `v0.28.46` and `v0.28.48`, as earlier forward-merges kept
theirs. The docs for the work not carried stay on `release/alpha-2`.

## Not carried — alpha-3 must decide

- **Admin permission split** (v0.28.46, #349, ADR-066) and its fix, **a User Admin could grant
  admin access through a custom role** (`21f0bcb6`). The fix guards code that exists only with
  the split; `main` has no delegated admin roles, so there is nothing to patch. Port both
  together if the split is adopted.
- **MCP OAuth client-credentials sign-in and the single MCP server dialog** (v0.28.47, #361).
  `main`'s MCP credentials follow ADR-062 (secret store, SDK client); the alpha-2 version
  conflicts throughout.
- **zod 4 / AI SDK 5 / LangChain 1.x migration** (v0.28.49). A cross-cutting dependency change
  for a feature line, not a fix. Consequently `main` keeps its **zod waiver**
  (GHSA-mrhx-c7xc-m3w5), which alpha-2 retired.

## Known limitation

better-auth 1.7 declares a `zod >=4.6.6` peer through `better-call`; `main` still resolves
zod 3 at the root, so `pnpm install` prints an unmet-peer warning. Better Auth's own tests and
the Entra e2e (`fix-entra-account-linking.spec.ts`) cover its sign-in path in CI.

## Regression guard

`removed-routes.test.ts` (the seven removed routes 404), `entra-user-info.test.ts` and
`mock-fidelity.test.ts` (no `id`, `oid` required), `waiver-rules.test.mjs` (release-line rule).
Migration `0059` carries `-- data-impact: preserved`; its logic is alpha-2's `0049`, verified
there on a scratch Postgres. **E2E:** none new; the existing Entra linking spec covers 1.7.
