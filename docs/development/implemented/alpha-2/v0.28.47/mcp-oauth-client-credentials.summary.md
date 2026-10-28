# Summary — MCP OAuth 2.0 client credentials (v0.28.47)

Issue #361. Phase doc: `mcp-oauth-client-credentials.phase.md` (this folder). No
PRD or ADR — an issue-sourced enhancement.

**Version**: 0.28.47 (PATCH on `release/alpha-2` — a maintainer-approved exception:
the change adds nullable columns, but MINOR numbers from `0.29.0` are taken on
`main`). The same capability is ported to `main` as `0.41.0` in a separate PR.

## What was built

- **Sign-in method per server.** An MCP server signs in with none, a fixed bearer
  token, or OAuth 2.0 client credentials — exactly one. Switching to OAuth clears
  the stored token and any legacy `MCP_CRED_` reference; setting a token, or
  choosing None, clears OAuth and its secret.
- **Token source (adapters).** Requests `grant_type=client_credentials` with the
  client ID and secret in an HTTP Basic header (default) or the form body; sends
  scope when set, and the audience as both `audience` and `resource` when set.
  Tokens are cached in memory per server, reused until 60 s before expiry (5 min
  when the provider gives no `expires_in`), retired the moment the settings or
  secret change, and shared between concurrent callers. Failures are not cached.
- **Shared resolver.** `McpBearerTokenResolver` gives both the MCP client (Test
  connection, deterministic MCP nodes, tool listing) and the conversational tool
  pre-pass the same token, from one shared cache.
- **Errors.** A failed token request fails the call with "Couldn't get an access
  token from `<host>`: `<error — description>`" (or the HTTP status), which Test
  connection shows. The client secret never appears in an error.
- **Admin UI.** The register form and edit dialog gain an Authentication choice
  (None / Bearer token / OAuth client credentials) with token URL, client ID,
  client secret, client-credential sending method, scope and audience. Secrets
  are write-only; left blank on edit they are kept. The server list reads
  "OAuth client credentials (`<client ID>`)".
- **Flow authors** no longer receive a server's OAuth settings from `listWithTools`.

## Files created

- `packages/adapters/src/mcp/oauth-client-credentials-token-source.ts` (+ test)
- `packages/adapters/src/mcp/mcp-bearer-token-resolver.ts` (+ test)
- `packages/adapters/src/repositories/drizzle-mcp-server-repository.test.ts`
- `packages/adapters/drizzle/0051_mcp_oauth_client_credentials.sql` (+ `meta/0051_snapshot.json`, journal entry)
- `apps/web/src/app/(admin)/admin/mcp-servers/sign-in-fields.tsx`

## Files modified

- domain: `entities/mcp-server.ts` (+ test), `ports/mcp-server-repository.ts`
- application: `use-cases/mcp/mcp.ts` (+ test), `use-cases/session/run-mcp-node.test.ts` (fixture)
- adapters: `mcp/ai-sdk-mcp-client.ts` (+ test), `mcp/mcp-tool-prepass.ts` (+ test),
  `mcp/mcp-server-directory.test.ts` (fixture), `mcp/index.ts`,
  `repositories/drizzle-mcp-server-repository.ts`, `db/schema/admin.ts`
- apps/web: `server/routers/mcp-server.ts`, `lib/container-skills-mcp.ts`,
  `app/(admin)/admin/mcp-servers/_content.tsx`, `edit-mcp-server-dialog.tsx`,
  `mcp-server-model.ts` (+ test)

## Migrations run

- `0051_mcp_oauth_client_credentials.sql` — six nullable `text` columns on
  `admin_mcp_servers`. Additive; no row is touched, so no `-- data-impact:` line.

## Tests

Domain validator, application sign-in rules, repository column mapping, token
source (auth methods, parameters, caching, refresh, invalidation, sharing, error
reporting), resolver, MCP client, pre-pass and the admin form model.
**E2E**: the existing axe check on the MCP edit dialog (`e2e/accessibility.spec.ts`,
accessibility group) now drives the Authentication choice and the OAuth fields'
save problems instead of the removed "Remove token" checkbox. The sign-in
behaviour itself is covered at the domain, application and adapter layers.

## Known limitations

- No retry when a provider revokes a token before its stated expiry; calls fail
  until the cached token's lifetime runs out.
- The token URL is not checked against private address ranges — the same trust
  as the admin-entered MCP server URL.
- Each process caches its own token.
- Forward-merging this into `main` conflicts on the MCP files; the `main` port PR
  resolves it.

## Validation

- `./validate.sh`: PASS (2026-10-28)
