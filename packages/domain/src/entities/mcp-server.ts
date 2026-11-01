import { domainError } from "../errors/domain-error";
import { err, ok, type Result } from "../result";
import type { McpSourceStatus, McpToolSettings } from "./mcp-tool-result";
import type { ToolRecordCitation } from "./tool-citation";

export type McpServerStatus = "active" | "disabled";

// Remote HTTP transports only. `sse` is the legacy default; `streamable-http`
// targets servers exposing the newer MCP streamable-HTTP endpoint, with or
// without sessions. Local/stdio (process-spawning) is out of scope.
export type McpTransport = "sse" | "streamable-http";

// What a server does with data, as classified by an admin (ADR-062 §1).
// `internal` is a self-contained utility (spellcheck, calculation); `public-read`
// reads published records from outside Wayfinder and sends back nothing but the
// query; `external-write` sends Wayfinder's records out, and is registered but
// never offered to or run by a flow.
export type McpDataClassification = "internal" | "public-read" | "external-write";

export const MCP_DATA_CLASSIFICATIONS: readonly McpDataClassification[] = [
  "internal",
  "public-read",
  "external-write",
];

export const isFlowUsableClassification = (classification: McpDataClassification): boolean =>
  classification !== "external-write";

// Public-data sources routinely take 10–30 s per call, so the default sits above
// that; the ceiling bounds how long a queued call can occupy the worker.
export const DEFAULT_MCP_CALL_TIMEOUT_MS = 30_000;
export const MIN_MCP_CALL_TIMEOUT_MS = 1_000;
export const MAX_MCP_CALL_TIMEOUT_MS = 120_000;

// `callTimeoutMs` bounds each request; a paginated call makes one per page, so
// the whole call — every page — is also capped, which is what lets a worker tell
// a slow call from one whose worker died.
export const MAX_MCP_CALL_TOTAL_MS = 600_000;

export const isValidMcpCallTimeout = (timeoutMs: number): boolean =>
  Number.isInteger(timeoutMs) &&
  timeoutMs >= MIN_MCP_CALL_TIMEOUT_MS &&
  timeoutMs <= MAX_MCP_CALL_TIMEOUT_MS;

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

// An admin-registered remote MCP server. Its credential and custom headers are
// write-only (ADR-062 §8): the entity says only whether they exist, and the
// values are decrypted inside the adapter that opens the connection.
export interface McpServer {
  readonly id: string;
  readonly label: string;
  readonly transport: McpTransport;
  readonly url: string;
  readonly dataClassification: McpDataClassification;
  // Admin governance of Wayfinder's own handling (ADR-053 §5): when `true`,
  // Wayfinder will not transform this connection's tool results — it selects
  // from them or passes them through unchanged. It claims nothing about whether
  // the source itself is correct, which Wayfinder cannot know.
  readonly verbatimOnly: boolean;
  readonly callTimeoutMs: number;
  readonly hasCredential: boolean;
  readonly customHeaderNames: string[];
  // Set when the server signs in with OAuth 2.0 client credentials (issue #361).
  // The client secret, like the bearer token, lives only in the secret store.
  readonly oauth: McpOAuthSettings | null;
  readonly status: McpServerStatus;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewMcpServer {
  readonly label: string;
  readonly transport?: McpTransport;
  readonly url: string;
  readonly dataClassification?: McpDataClassification;
  readonly verbatimOnly?: boolean;
  readonly callTimeoutMs?: number;
  readonly oauth?: McpOAuthSettings;
  readonly createdByUserId?: string | null;
}

export interface McpServerUpdate {
  readonly label?: string;
  readonly url?: string;
  readonly dataClassification?: McpDataClassification;
  readonly verbatimOnly?: boolean;
  readonly callTimeoutMs?: number;
  // `null` stops the server using OAuth.
  readonly oauth?: McpOAuthSettings | null;
}

// The secrets a connection sends. Never returned by a repository read or a
// router — only the secret store's `get` produces one, for the MCP client.
export interface McpServerSecrets {
  readonly bearerToken: string | null;
  readonly headers: Record<string, string>;
  readonly oauthClientSecret: string | null;
}

// `undefined` leaves a secret unchanged; `null` clears it.
export interface McpServerSecretsPatch {
  readonly bearerToken?: string | null;
  readonly headers?: Record<string, string> | null;
  readonly oauthClientSecret?: string | null;
}

// Headers the transport sets itself. Letting an admin override them would break
// the protocol (session id, negotiated version, content negotiation) or the
// request framing, so they are refused rather than silently ignored.
export const RESERVED_MCP_HEADER_NAMES: readonly string[] = [
  "host",
  "content-length",
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const LINE_BREAK = /[\r\n]/;

// Validates and trims custom header names. `Authorization` is allowed as a custom
// header only when the server signs in with neither a bearer token nor OAuth —
// otherwise two values would compete for the same header and which one is sent
// would depend on merge order.
export const validateMcpCustomHeaders = (
  headers: Record<string, string>,
  authorizationTaken: boolean,
): Result<Record<string, string>> => {
  const validated: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.trim();
    const lowerName = name.toLowerCase();
    if (!HTTP_TOKEN.test(name)) {
      return err(domainError("VALIDATION_FAILED", `"${rawName}" is not a valid header name.`));
    }
    if (RESERVED_MCP_HEADER_NAMES.includes(lowerName)) {
      return err(domainError("VALIDATION_FAILED", `${name} is set by the connection and cannot be overridden.`));
    }
    if (lowerName === "authorization" && authorizationTaken) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "Remove the bearer token or OAuth sign-in before setting an Authorization header.",
        ),
      );
    }
    if (LINE_BREAK.test(value)) {
      return err(domainError("VALIDATION_FAILED", `The value for ${name} cannot contain a line break.`));
    }
    validated[name] = value;
  }
  return ok(validated);
};

// A tool discovered on a server. `inputSchema` is the tool's JSON-schema input;
// `title` is the human-readable name the server gives it, when it gives one.
export interface McpTool {
  readonly name: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly inputSchema: Record<string, unknown> | null;
}

// A cached tool with the admin's per-tool settings (ADR-062 §5). The settings
// survive a refresh for as long as the server keeps listing the tool.
export interface CachedMcpTool extends McpTool, McpToolSettings {
  readonly serverId: string;
  readonly lastSyncedAt: Date;
}

// The human-readable label for a tool wherever a person sees it.
export const mcpToolDisplayTitle = (tool: Pick<McpTool, "name" | "title">): string =>
  tool.title?.trim() ? tool.title.trim() : tool.name;

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

// One tool call made during the conversational tool-loop pre-pass, persisted on
// the turn so a reviewer can reconstruct what a tool told the AI and so later
// turns can re-read it. The members after `calledAt` are absent on rows written
// before ADR-062, which read as one page with no status and no citations.
export interface McpToolCallRecord {
  readonly serverLabel: string;
  readonly toolName: string;
  // JSON-serialised call arguments, capped by the recorder.
  readonly arguments: string;
  // The tool's full output up to the record ceiling; `truncated` marks a cut.
  readonly result: string;
  readonly calledAt: string;
  readonly serverId?: string;
  readonly truncated?: boolean;
  readonly pagesFetched?: number;
  readonly sourceStatus?: McpSourceStatus | null;
  readonly citations?: ToolRecordCitation[];
}

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
