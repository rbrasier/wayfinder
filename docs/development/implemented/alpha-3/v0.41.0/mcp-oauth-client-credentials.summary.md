# Summary — MCP OAuth 2.0 client credentials (v0.41.0)

Issue #361. Phase doc: `mcp-oauth-client-credentials.phase.md` (this folder). Port
of the alpha-2 change (v0.28.47, PR #364) onto `main`'s MCP layer (ADR-062).

**Version**: 0.41.0 (MINOR — schema change).

## What was built

- **Sign-in method per server.** None, fixed bearer token, or OAuth 2.0 client
  credentials — exactly one. Switching to OAuth clears the saved token; setting a
  token, or removing OAuth, clears OAuth and its client secret. A custom
  `Authorization` header is refused while OAuth is set.
- **Storage.** OAuth settings live on the server row; the client secret is
  encrypted by `DrizzleMcpServerSecretStore` beside the token and custom headers,
  and is never returned by a read or a router.
- **Token source.** `OAuthClientCredentialsTokenSource` requests
  `grant_type=client_credentials` (HTTP Basic or form body; scope; audience as
  `audience` and `resource`), caches tokens in memory per server until 60 s
  before expiry (5 min without `expires_in`), retires them when the settings or
  secret change, and shares one request between concurrent callers.
- **Client.** `McpSdkClient` sends a fetched access token for OAuth servers
  beside the custom headers; a failed token request is the call's error, which
  Test shows. One client per process (web container, MCP call worker), so the
  cache is shared within each.
- **Admin UI.** The register form and the Credentials panel gain an
  Authentication choice with the OAuth fields; the list reads "OAuth client
  credentials (`<client ID>`)". `listWithTools` omits OAuth settings.

## Files created

- `packages/adapters/src/mcp/oauth-client-credentials-token-source.ts` (+ test)
- `packages/adapters/drizzle/0059_mcp_oauth_client_credentials.sql` (+ `meta/0059_snapshot.json`, journal entry)
- `apps/web/src/components/admin/mcp-sign-in-fields.tsx`

## Files modified

- domain: `entities/mcp-server.ts` (+ test)
- application: `use-cases/mcp/mcp.ts` (+ test); fixtures in `flow-portability`, `flow-version`, `run-mcp-node`, `execute-queued-mcp-calls` tests
- adapters: `mcp/mcp-sdk-client.ts` (+ test), `mcp/index.ts`, `db/schema/admin.ts`,
  `repositories/drizzle-mcp-server-repository.ts` (+ test), `drizzle-mcp-server-secret-store.ts` (+ test);
  fixtures in `mcp-server-directory`, `auditing-mcp-client`, `mcp-tool-prepass` tests
- apps/web: `server/routers/mcp-server.ts`, `components/admin/mcp-server-form-model.ts` (+ test),
  `app/(admin)/admin/mcp-servers/_content.tsx`

## Migrations run

- `0059_mcp_oauth_client_credentials.sql` — six nullable `text` columns on
  `admin_mcp_servers`. Additive; no row is touched, so no `-- data-impact:` line.

## Tests

Domain validator; application sign-in rules; repository and secret-store
mapping; token source; `McpSdkClient` against the MCP fixture server (fetched
token sent with custom headers, token failure and missing secret stop the call
before connecting); admin form model. **No e2e** — in none of the six
`e2e-test-policy.md` groups; covered at the domain, application and adapter
layers.

## Known limitations

- No retry-on-401 for a token revoked before its stated expiry.
- The token URL is not checked against private address ranges (same trust as
  the admin-entered MCP server URL).
- Each process caches its own token.

## Validation

- `./validate.sh`: PASS (2026-10-28)
