export type McpServerStatus = "active" | "disabled";

// Only remote SSE transport is supported (ADR-032). Local/stdio is out of scope.
export type McpTransport = "sse";

// How a server is used in flows. `context` servers are read-only grounding,
// selected flow-wide and offered to the conversational AI as tools. `actions`
// servers perform writes and are only reachable through an MCP action node,
// which gates each call behind operator confirmation.
export type McpServerKind = "context" | "actions";

// An admin-registered remote MCP server. `credentialRef` points at the secret
// store — the secret itself never leaves the adapter layer and is never returned
// to a client.
export interface McpServer {
  readonly id: string;
  readonly label: string;
  readonly transport: McpTransport;
  readonly kind: McpServerKind;
  readonly url: string;
  readonly credentialRef: string | null;
  readonly status: McpServerStatus;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewMcpServer {
  readonly label: string;
  readonly transport?: McpTransport;
  readonly kind?: McpServerKind;
  readonly url: string;
  readonly credentialRef?: string | null;
  readonly createdByUserId?: string | null;
}

export interface McpServerUpdate {
  readonly label?: string;
  readonly kind?: McpServerKind;
  readonly url?: string;
  readonly credentialRef?: string | null;
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
