# Phase — MCP OAuth 2.0 Client Credentials

- **Status**: Implemented (v0.28.47)
- **Target version**: 0.28.47 — **PATCH**, on `release/alpha-2`. A documented
  exception: the change adds nullable columns, which would normally be MINOR,
  but MINOR `0.29.0` and later are already taken on `main`, and the maintainer
  chose to ship this to the alpha-2 line. The same capability is ported to
  `main` (MINOR `0.41.0`) in a separate PR on `main`'s rewritten MCP layer.
- **Source issue**: [#361](https://github.com/rbrasier/wayfinder/issues/361) — MCP
  bearer token. The reporter wants an admin to set an MCP server to authenticate
  as a service account with OAuth 2.0 client credentials, with Wayfinder getting
  and renewing its own tokens.
- **PRD**: none — issue-sourced enhancement.
- **Depends on**: the MCP server registry and its stored, encrypted bearer token
  (`admin_mcp_servers.credential_encrypted`).

## 1. Goal

An MCP server whose access tokens expire keeps working without an admin pasting a
fresh token in. An admin registers how Wayfinder obtains a token — token URL,
client ID, client secret, optional scope, audience and client authentication
method — and Wayfinder fetches, caches and renews the token itself. Servers on a
fixed bearer token, or on a legacy `MCP_CRED_` environment variable, keep working
exactly as today.

## 2. Business rules

| # | Trigger | Behaviour |
|---|---|---|
| R1 | An admin saves a server | It authenticates exactly one way: none, fixed bearer token, or OAuth client credentials. |
| R2 | OAuth settings are saved | Token URL (http/https), client ID and client secret are required; scope, audience and auth method are optional. Auth method defaults to `client_secret_basic`. |
| R3 | A server is switched to OAuth | Its stored bearer token and legacy `credentialRef` are cleared. |
| R4 | A bearer token is set, or OAuth is removed | The OAuth settings and encrypted client secret are cleared. |
| R5 | OAuth settings are edited and the secret field is left blank | The stored secret is kept. A new server must supply one. |
| R6 | An MCP call is about to open a connection to an OAuth server | A cached token with ≥ 60 s of life left is reused; otherwise a `grant_type=client_credentials` request fetches a new one. With no `expires_in`, a token is cached for 5 minutes. |
| R7 | A server's OAuth settings change | Its cached token is no longer used — the cache is keyed by the settings, not just the server. |
| R8 | The token request fails | The MCP call fails with "Couldn't get an access token from `<host>`: `<provider error>`", which **Test connection** shows. The client secret never appears in an error or log. |

## 3. What is built

| Layer | File(s) | Change |
|---|---|---|
| domain | `entities/mcp-server.ts` | `McpOAuthSettings`, `McpOAuthClientAuthMethod`, `McpOAuthChange`; `McpServer.oauth`; `oauth?` on `NewMcpServer` / `McpServerUpdate`; `validateMcpOAuthSettings`. Tests first. |
| domain | `ports/mcp-server-repository.ts` | `readOAuthClientSecret(id)`. |
| application | `use-cases/mcp/mcp.ts` | `RegisterMcpServer` / `UpdateMcpServer` accept an OAuth change, validate it and enforce R1, R3–R5. |
| adapters | `mcp/oauth-client-credentials-token-source.ts` | New: token request (Basic or form body, scope, audience), in-memory cache, early refresh, error mapping. |
| adapters | `mcp/ai-sdk-mcp-client.ts` | Resolves the bearer from the token source for OAuth servers. |
| adapters | `repositories/drizzle-mcp-server-repository.ts`, `db/schema/admin.ts`, migration | Persist the OAuth columns; secret encrypted with the existing cipher. |
| apps/web | `server/routers/mcp-server.ts` | Accept `oauth` on create/update. |
| apps/web | `app/(admin)/admin/mcp-servers/*` | Authentication choice and OAuth fields in the dialog; list summary. |
| apps/web | `lib/container.ts` | Wire the token source into the MCP client. |

## 4. Database changes

`admin_mcp_servers` gains six nullable `text` columns: `oauth_token_url`,
`oauth_client_id`, `oauth_client_secret_encrypted`, `oauth_scope`,
`oauth_audience`, `oauth_client_auth_method`. A generated, additive migration;
no row is touched, so no `-- data-impact:` line is required.

## 5. Implementation order (tests first)

1. Domain types + `validateMcpOAuthSettings`.
2. Application rules in Register/Update (in-memory repository fake).
3. Schema, migration and repository persistence.
4. Token source + MCP client header resolution.
5. Router, dialog model, dialog and list, container wiring.

## 6. Acceptance criteria

- A server saved with OAuth settings sends `Authorization: Bearer <fetched token>`.
- A second call within the token's lifetime makes no token request; a call within
  60 s of expiry makes one.
- `client_secret_basic` sends the credentials in an `Authorization: Basic` header;
  `client_secret_post` sends them in the form body. Scope and audience are sent
  only when set.
- Switching a server to OAuth clears its bearer token; setting a bearer token
  clears its OAuth settings.
- A failing token endpoint surfaces its `error` / `error_description` on Test
  connection, without the secret.
- Existing bearer-token and legacy servers behave unchanged.

## 7. E2E

None. The behaviour is not in any of the six `e2e-test-policy.md` groups; it is
covered by domain, application and adapter unit tests and the dialog model test.

## 8. Risks

- Forward-merging into `main` conflicts on every MCP file, because `main` has
  rewritten the MCP layer. The separate `main` port PR is the resolution.
- The token URL is not checked against private address ranges — the same trust
  as the admin-entered MCP server URL, and token servers are often internal.
- Each process caches its own token, so one token request per process per token
  lifetime.
- A token revoked by the provider before its stated expiry fails calls until the
  cache refreshes; there is no retry-on-401.

## 9. Out of scope

Per-user (authorization-code) OAuth, discovery from protected-resource metadata,
private-key-JWT or mTLS client authentication, and storing tokens in the database.

## 10. Approved change summary (maintainer decisions)

- **Base & version**: `release/alpha-2`, PATCH `0.28.47` despite the schema
  change (MINOR numbers from `0.29.0` are taken on `main`); a separate PR ports the
  capability to `main` as MINOR `0.41.0` on its rewritten MCP layer.
- **Token endpoint**: entered by the admin — no metadata discovery.
- **Optional fields**: scope, audience (sent as both `audience` and `resource`),
  and client authentication method (HTTP Basic default, or form body).
- **Token cache**: in-process memory only. A restart refetches from the stored
  client credentials, so no admin action is ever needed for an expired token.
- **Also covered** (found while checking the triage against the code): the
  conversational tool pre-pass opens its own MCP connections, so it resolves
  tokens through the same shared resolver as the MCP client. The flow-author
  `listWithTools` endpoint omits OAuth settings.
