import type { McpServer, McpTool } from "../entities/mcp-server";
import type { McpSourceStatus, McpToolSettings } from "../entities/mcp-tool-result";
import type { ToolRecordCitation } from "../entities/tool-citation";
import type { Result } from "../result";

// Who a call is made for and from where — what the audit row records (ADR-062 §7).
export interface McpCallContext {
  readonly actorId: string | null;
  readonly sessionId: string | null;
  readonly flowId: string | null;
  readonly nodeId: string | null;
  readonly path: "prepass" | "node";
}

export interface McpCallOptions {
  readonly settings?: McpToolSettings;
  readonly context?: McpCallContext;
  // Fires before each page is requested, starting at 1.
  readonly onPage?: (page: number) => void;
}

export interface McpToolCallOutput {
  // The text a model or a response field reads: the tool's text for a single
  // unstructured page, otherwise the JSON of the combined result, followed by a
  // plain line for a page-limit stop, a non-ok source status and each caveat.
  readonly output: string;
  readonly structuredContent: unknown;
  readonly citations: ToolRecordCitation[];
  readonly pagesFetched: number;
  readonly truncatedAtPageLimit: boolean;
  readonly sourceStatus: McpSourceStatus | null;
}

// Talks to a remote MCP server. Connection lifecycle (open/close) is the
// adapter's concern; callers pass the server descriptor each call.
export interface IMcpClient {
  listTools(server: McpServer): Promise<Result<McpTool[]>>;
  callTool(
    server: McpServer,
    toolName: string,
    args: Record<string, unknown>,
    options?: McpCallOptions,
  ): Promise<Result<McpToolCallOutput>>;
}
