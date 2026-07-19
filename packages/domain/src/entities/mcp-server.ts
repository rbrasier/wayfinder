export type McpServerStatus = "active" | "disabled";

// Remote HTTP transports only (ADR-032 §1: "remote HTTP/SSE"). `sse` is the
// legacy default; `streamable-http` targets servers exposing the newer MCP
// streamable-HTTP endpoint. Local/stdio (process-spawning) is out of scope.
export type McpTransport = "sse" | "streamable-http";

// An admin-registered remote MCP server. `credentialRef` points at the secret
// store — the secret itself never leaves the adapter layer and is never returned
// to a client.
export interface McpServer {
  readonly id: string;
  readonly label: string;
  readonly transport: McpTransport;
  readonly url: string;
  readonly credentialRef: string | null;
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

export interface NewMcpServer {
  readonly label: string;
  readonly transport?: McpTransport;
  readonly url: string;
  readonly credentialRef?: string | null;
  readonly communicatesExternally?: boolean;
  readonly createdByUserId?: string | null;
}

export interface McpServerUpdate {
  readonly label?: string;
  readonly url?: string;
  readonly credentialRef?: string | null;
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
