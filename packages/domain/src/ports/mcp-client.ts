import type { McpServer, McpTool } from "../entities/mcp-server";
import type { Result } from "../result";

export interface McpToolCallOutput {
  // The tool result flattened to text for injection/persistence. Structured
  // content is JSON-stringified by the adapter.
  readonly output: string;
}

// Talks to a remote MCP server. Connection lifecycle (open/close) is the
// adapter's concern; callers pass the server descriptor each call.
export interface IMcpClient {
  listTools(server: McpServer): Promise<Result<McpTool[]>>;
  callTool(
    server: McpServer,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<Result<McpToolCallOutput>>;
}
