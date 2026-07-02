import type { McpServerWithTools } from "../entities/mcp-server";
import type { Result } from "../result";

// Lists active servers and their currently-exposed tools for the flow editor.
// Mirrors IN8nWorkflowDirectory: a read surface over registered integrations.
export interface IMcpServerDirectory {
  listServersWithTools(): Promise<Result<McpServerWithTools[]>>;
}
