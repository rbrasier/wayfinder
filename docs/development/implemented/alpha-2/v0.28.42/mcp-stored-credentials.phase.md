# MCP server credentials stored in the database

- **Type:** enhancement to the MCP registry (`implemented/alpha-2/v2.2.0/phase-mcp-registry.phase.md`)
- **Ships with:** PR #345 (`release/alpha-2`), version 0.28.42, PATCH
- **Source issue:** none

## Why

An MCP server's bearer token is configured today by naming an environment variable
(`credentialRef`, fenced to the `MCP_CRED_` namespace). Adding or rotating one means
editing the server's environment and restarting it. Every other credential an admin
manages in Wayfinder, such as an Event Watch's secret, is entered on screen and held
encrypted in the database. MCP servers should work the same way.

## What changes

### Storage

- `admin_mcp_servers` gains `credential_encrypted text` (nullable). The repository
  encrypts with the existing `SecretCipher` (the settings-encryption key), as
  `DrizzleEventWatchRepository` does.
- The token never leaves the adapter layer. `McpServer` carries
  `hasCredential: boolean`, not the token. `IMcpServerRepository.readCredential(id)`
  returns the decrypted token to the MCP client only.
- `credential_ref` stays, read-only from the screen's point of view, for servers
  registered before this change.

### Business rules

1. **Registering:** an optional token is stored encrypted. Naming an environment
   variable is no longer accepted.
2. **Connecting:** the stored token is used. Without one, a legacy `credentialRef`
   is still read from the environment, still only within `MCP_CRED_`.
3. **Updating:** a token sent with the update replaces the stored one; `null` removes
   it; omitted keeps it.
4. **Legacy migration on save:** saving a server that still has a `credentialRef` and
   no stored token moves it to the stored method:
   - a token typed in the editor is stored, and `credentialRef` is cleared;
   - with the token left blank, the environment variable's current value is
     copied into storage and `credentialRef` is cleared;
   - if that variable is empty or unset, `credentialRef` is kept, so the server
     goes on working as it did.
5. **Removing:** removing the token also clears any legacy `credentialRef`.

### Ports

- `ILegacyMcpCredentialSource.read(credentialRef): string | null` reads a legacy
  environment value. It returns `null` outside the `MCP_CRED_` namespace. Used only
  by `UpdateMcpServer` for rule 4.

### Screen (Admin → MCP servers)

- **Register form:** "Credential ref (env var)" becomes a masked **Bearer token
  (optional)** field.
- **Credential column:** "Stored securely", "Env var `MCP_CRED_X` (legacy)" or "—".
- **Edit, on each row:** a dialog with label, URL, the "Permitted to communicate
  outside Wayfinder" toggle and a masked token field.
  - A stored token reads "A token is stored. Leave blank to keep it", with
    **Remove token**.
  - A legacy server notes "Uses `MCP_CRED_X`. Saving moves it into secure storage."
  - Errors show above the field they belong to.

## Also changed during the build: external servers usable in flows

Asked for while this was being built. "Permitted to communicate outside
Wayfinder" hid a server from **Add MCP** and dropped its tools at run time, which
read as a bug. The setting becomes a label:

- `McpServerDirectory` offers every active server; `ResolveStepTools` and
  `RunMcpNode` no longer drop or refuse external ones.
- The checkbox reads **Sends data outside Wayfinder**, and the **Add MCP** picker
  shows an **External** badge on such servers.
- ADR-065 §3 records the change.

## Data impact

Migration `0048`, generated, adds the nullable column only:

`-- data-impact: preserved — adds a nullable column; existing rows keep their credential_ref and keep working through the environment fallback`

## Tests

- **Application:** `mcp.test.ts`.
  - Register stores a token and never echoes it.
  - Update covers keep / replace / remove.
  - Legacy copy on save, both with the environment value set and unset.
  - Removal clears a legacy reference.
  - Tools on an external server are kept (`ResolveStepTools`).
- **Application:** `run-mcp-node.test.ts` (an external server is called).
- **Adapters:**
  - `ai-sdk-mcp-client.test.ts`: the stored token is preferred over the
    environment variable, and `EnvLegacyMcpCredentialSource` is fenced to
    `MCP_CRED_`.
  - `mcp-server-directory.test.ts`: external servers are offered.
- **Web:** `mcp-server-model.test.ts` (credential summary, token change, form
  problems).
- **E2E:** `accessibility.spec.ts` (policy group 5) audits the edit dialog with
  **Remove token** ticked and a save problem showing. The rules are covered at the
  application layer.

## Risks

- A stale token in a legacy environment variable is copied as it is. **Test** on
  the row shows it at once.
- Stored tokens depend on `SETTINGS_ENCRYPTION_KEY`, as Event Watch secrets already do.
  Rotating that key without re-encrypting makes them unreadable.

## Out of scope

- Migrating legacy servers that nobody edits.
- Removing the environment fallback.
- Changing a server's transport after registration.
