# Phase — MCP OAuth 2.0 Client Credentials

- **Status**: Implemented (v0.41.0)
- **Target version**: 0.41.0 — **MINOR** (schema change), on `main`. The port of
  the alpha-2 change (v0.28.47, PR #364) onto `main`'s rewritten MCP layer
  (ADR-062: `McpSdkClient`, the encrypted secret store, custom headers).
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
| R3 | A server is switched to OAuth | Its stored bearer token is cleared, and a custom `Authorization` header is refused while OAuth is set. |
| R4 | A bearer token is set, or OAuth is removed | The OAuth settings and encrypted client secret are cleared. |
| R5 | OAuth settings are edited and the secret field is left blank | The stored secret is kept. A new server must supply one. |
| R6 | An MCP call is about to open a connection to an OAuth server | A cached token with ≥ 60 s of life left is reused; otherwise a `grant_type=client_credentials` request fetches a new one. With no `expires_in`, a token is cached for 5 minutes. |
| R7 | A server's OAuth settings change | Its cached token is no longer used — the cache is keyed by the settings, not just the server. |
| R8 | The token request fails | The MCP call fails with "Couldn't get an access token from `<host>`: `<provider error>`", which **Test connection** shows. The client secret never appears in an error or log. |

## 3. What is built

| Layer | File(s) | Change |
|---|---|---|
| domain | `entities/mcp-server.ts` | OAuth types and `validateMcpOAuthSettings`; `McpServer.oauth`; `oauth?` on `NewMcpServer` / `McpServerUpdate`; `oauthClientSecret` on `McpServerSecrets` / patch. A custom `Authorization` header is refused while OAuth is set, as it already is for a bearer token. |
| application | `use-cases/mcp/mcp.ts` | Register/Update resolve one sign-in method and write the client secret through the secret store. |
| adapters | `mcp/oauth-client-credentials-token-source.ts` | New: token request, in-memory cache, early refresh, error mapping. |
| adapters | `mcp/mcp-sdk-client.ts` | Sends a fetched access token for OAuth servers, beside the custom headers. Every MCP connection on `main` goes through this client. |
| adapters | `repositories/drizzle-mcp-server-repository.ts`, `drizzle-mcp-server-secret-store.ts`, `db/schema/admin.ts`, migration | Settings on the server row; secret encrypted by the secret store. |
| apps/web | `server/routers/mcp-server.ts` | `oauth` on register/update; `listWithTools` omits OAuth settings. |
| apps/web | `components/admin/mcp-sign-in-fields.tsx`, `mcp-server-form-model.ts`, `app/(admin)/admin/mcp-servers/_content.tsx` | Authentication choice and OAuth fields on the register form and the Credentials panel. |

## 4. Database changes

`admin_mcp_servers` gains six nullable `text` columns: `oauth_token_url`,
`oauth_client_id`, `oauth_scope`, `oauth_audience`, `oauth_client_auth_method`,
`oauth_client_secret_ciphertext`. A generated, additive migration;
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

- The alpha-2 change (PR #364) forward-merges into `main` with conflicts on the
  MCP files; this port is the resolution — keep `main`'s side.
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

Same decisions as the alpha-2 change: admin-entered token URL; scope, audience
(sent as `audience` and `resource`) and client authentication method; tokens
cached in memory only; `listWithTools` omits OAuth settings. Built on `main` as
MINOR `0.41.0`.
