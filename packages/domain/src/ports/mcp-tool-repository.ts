import type { CachedMcpTool, McpTool } from "../entities/mcp-server";
import type { McpToolSettings } from "../entities/mcp-tool-result";
import type { Result } from "../result";

// The `admin_mcp_tools` cache (ADR-062 §5): what each server last listed, plus
// the admin's per-tool settings.
export interface IMcpToolRepository {
  listByServer(serverId: string): Promise<Result<CachedMcpTool[]>>;
  // Upserts by name and removes tools the server no longer lists. Settings are
  // kept for every name that survives the refresh.
  replaceForServer(serverId: string, tools: McpTool[]): Promise<Result<CachedMcpTool[]>>;
  updateSettings(serverId: string, toolName: string, settings: McpToolSettings): Promise<Result<CachedMcpTool>>;
}
