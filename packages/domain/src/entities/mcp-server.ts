import { domainError } from "../errors/index";
import { err, ok, type Result } from "../result";

export type McpServerStatus = "active" | "disabled";

// Remote HTTP transports only (ADR-032 §1: "remote HTTP/SSE"). `sse` is the
// legacy default; `streamable-http` targets servers exposing the newer MCP
// streamable-HTTP endpoint. Local/stdio (process-spawning) is out of scope.
export type McpTransport = "sse" | "streamable-http";

// An admin-registered remote MCP server. Its bearer token is held encrypted by
// the repository and never leaves the adapter layer: a server only says whether
// it has one. `credentialRef` is the legacy alternative — the name of an
// `MCP_CRED_` environment variable — kept working for servers registered before
// tokens were stored, and moved into storage when the server is next saved.
export interface McpServer {
  readonly id: string;
  readonly label: string;
  readonly transport: McpTransport;
  readonly url: string;
  readonly credentialRef: string | null;
  readonly hasCredential: boolean;
  // Set when the server signs in with OAuth 2.0 client credentials instead of a
  // fixed token. Its client secret, like the token, never leaves the adapter layer.
  readonly oauth: McpOAuthSettings | null;
  // Admin classification: does this server communicate outside Wayfinder? `false`
  // is a self-contained internal utility (spellcheck, calculation) governed by the
  // existing document human-review gate and offered to flow authors; `true` is an
  // external integration — registered but not selectable in flows at this stage
  // (integration-grade governance is future work).
  readonly communicatesExternally: boolean;
  readonly status: McpServerStatus;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A token to store, `null` to remove the stored one, or absent to keep it.
export type McpCredentialChange = string | null | undefined;

// How the client ID and secret reach the token endpoint (RFC 6749 §2.3.1): an
// HTTP Basic header, which every server must support, or the form body, which
// some providers default to.
export type McpOAuthClientAuthMethod = "client_secret_basic" | "client_secret_post";

export const MCP_OAUTH_CLIENT_AUTH_METHODS: readonly McpOAuthClientAuthMethod[] = [
  "client_secret_basic",
  "client_secret_post",
];

// OAuth 2.0 client-credentials settings: Wayfinder signs in as a service account
// and fetches its own short-lived access tokens. Everything but the client secret.
export interface McpOAuthSettings {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly scope: string | null;
  // Provider-specific: Auth0 reads it as `audience`, RFC 8707 servers as `resource`.
  readonly audience: string | null;
  readonly clientAuthMethod: McpOAuthClientAuthMethod;
}

// What an admin submits. A blank or absent secret keeps the stored one.
export interface McpOAuthInput {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly scope?: string | null;
  readonly audience?: string | null;
  readonly clientAuthMethod?: McpOAuthClientAuthMethod;
}

// Settings to store, with a new client secret only when one was given.
export interface McpOAuthWrite {
  readonly settings: McpOAuthSettings;
  readonly clientSecret?: string;
}

// Settings to store, `null` to stop using OAuth, or absent to keep them.
export type McpOAuthChange = McpOAuthWrite | null | undefined;

export interface NewMcpServer {
  readonly label: string;
  readonly transport?: McpTransport;
  readonly url: string;
  readonly credential?: McpCredentialChange;
  // Only a server registered before tokens were stored carries one.
  readonly credentialRef?: string | null;
  readonly oauth?: McpOAuthWrite;
  readonly communicatesExternally?: boolean;
  readonly createdByUserId?: string | null;
}

export interface McpServerUpdate {
  readonly label?: string;
  readonly url?: string;
  readonly credential?: McpCredentialChange;
  // A legacy reference can only be cleared, never set.
  readonly credentialRef?: null;
  readonly oauth?: McpOAuthChange;
  readonly communicatesExternally?: boolean;
}

// A tool discovered on a server. `inputSchema` is the tool's JSON-schema input
// when the client can surface it, else null.
export interface McpTool {
  readonly name: string;
  readonly description: string | null;
  readonly inputSchema: Record<string, unknown> | null;
}

// A reference to one tool on one server — how a flow node names a tool it may use.
export interface McpToolRef {
  readonly serverId: string;
  readonly toolName: string;
}

// A server plus the tools it currently exposes, for the flow editor.
export interface McpServerWithTools {
  readonly server: McpServer;
  readonly tools: McpTool[];
}

// One tool call made during the conversational tool-loop pre-pass (ADR-032),
// captured for the audit trail. Persisted adjacent to the turn's gathered
// context so a reviewer can reconstruct what an internal tool told the AI —
// document review is the governance boundary, and this is what backs it.
export interface McpToolCallRecord {
  readonly serverLabel: string;
  readonly toolName: string;
  // JSON-serialised call arguments. Truncated by the recorder so a large
  // payload can never bloat the persisted turn.
  readonly arguments: string;
  // Flattened tool output, truncated to the same audit budget.
  readonly result: string;
  readonly calledAt: string;
}

// Env-var prefix every MCP credential reference must carry. Confining lookups to
// this namespace stops an admin from pointing `credentialRef` at an arbitrary
// process secret (e.g. DATABASE_URL) and exfiltrating it as a bearer token.
export const MCP_CREDENTIAL_ENV_PREFIX = "MCP_CRED_";

export const isValidMcpCredentialRef = (value: string): boolean =>
  value.startsWith(MCP_CREDENTIAL_ENV_PREFIX) && value.length > MCP_CREDENTIAL_ENV_PREFIX.length;

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

// `hasStoredSecret` is whether the server already signs in with OAuth — only
// then may the secret field be left blank to keep the one already stored.
export const validateMcpOAuthSettings = (
  input: McpOAuthInput,
  hasStoredSecret: boolean,
): Result<McpOAuthWrite> => {
  const tokenUrl = input.tokenUrl.trim();
  const clientId = input.clientId.trim();
  const clientSecret = blankToNull(input.clientSecret);
  const clientAuthMethod = input.clientAuthMethod ?? "client_secret_basic";
  if (!isHttpUrl(tokenUrl)) {
    return err(domainError("VALIDATION_FAILED", "Token URL must be a valid http(s) URL."));
  }
  if (clientId.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Client ID is required."));
  }
  if (!clientSecret && !hasStoredSecret) {
    return err(domainError("VALIDATION_FAILED", "Client secret is required."));
  }
  if (!MCP_OAUTH_CLIENT_AUTH_METHODS.includes(clientAuthMethod)) {
    return err(domainError("VALIDATION_FAILED", "Unknown client authentication method."));
  }
  const settings: McpOAuthSettings = {
    tokenUrl,
    clientId,
    scope: blankToNull(input.scope),
    audience: blankToNull(input.audience),
    clientAuthMethod,
  };
  return ok(clientSecret ? { settings, clientSecret } : { settings });
};
