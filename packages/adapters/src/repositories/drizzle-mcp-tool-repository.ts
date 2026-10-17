import {
  domainError,
  err,
  ok,
  type CachedMcpTool,
  type IMcpToolRepository,
  type McpTool,
  type McpToolSettings,
  type Result,
} from "@wayfinder/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { admin_mcp_tools } from "../db/schema/admin";

export type McpToolRow = typeof admin_mcp_tools.$inferSelect;

export const toCachedMcpTool = (row: McpToolRow): CachedMcpTool => ({
  serverId: row.server_id,
  name: row.name,
  title: row.title,
  description: row.description,
  inputSchema: row.input_schema ?? null,
  pagination: row.pagination_config ?? null,
  status: row.status_config ?? null,
  citation: row.citation_config ?? null,
  lastSyncedAt: row.last_synced_at,
});

export interface ToolReplacementPlan {
  removeIds: string[];
  upserts: McpTool[];
}

// Settings live on the row, so upserting by (server, name) keeps them for every
// tool the server still lists; only rows for tools it stopped listing go.
export const planToolReplacement = (existing: McpToolRow[], listed: McpTool[]): ToolReplacementPlan => {
  const listedNames = new Set(listed.map((tool) => tool.name));
  return {
    removeIds: existing.filter((row) => !listedNames.has(row.name)).map((row) => row.id),
    upserts: listed,
  };
};

// The `admin_mcp_tools` cache (ADR-062 §5).
export class DrizzleMcpToolRepository implements IMcpToolRepository {
  constructor(private readonly db: Database) {}

  async listByServer(serverId: string): Promise<Result<CachedMcpTool[]>> {
    try {
      const rows = await this.db
        .select()
        .from(admin_mcp_tools)
        .where(eq(admin_mcp_tools.server_id, serverId))
        .orderBy(asc(admin_mcp_tools.created_at), asc(admin_mcp_tools.name));
      return ok(rows.map(toCachedMcpTool));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list cached MCP tools.", cause));
    }
  }

  async replaceForServer(serverId: string, tools: McpTool[]): Promise<Result<CachedMcpTool[]>> {
    try {
      await this.db.transaction(async (transaction) => {
        const existing = await transaction
          .select()
          .from(admin_mcp_tools)
          .where(eq(admin_mcp_tools.server_id, serverId));
        const plan = planToolReplacement(existing, tools);
        if (plan.removeIds.length > 0) {
          await transaction.delete(admin_mcp_tools).where(inArray(admin_mcp_tools.id, plan.removeIds));
        }
        const syncedAt = new Date();
        for (const tool of plan.upserts) {
          const listing = {
            title: tool.title,
            description: tool.description,
            input_schema: tool.inputSchema,
            last_synced_at: syncedAt,
            updated_at: syncedAt,
          };
          await transaction
            .insert(admin_mcp_tools)
            .values({ server_id: serverId, name: tool.name, ...listing })
            .onConflictDoUpdate({ target: [admin_mcp_tools.server_id, admin_mcp_tools.name], set: listing });
        }
      });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to refresh cached MCP tools.", cause));
    }
    return this.listByServer(serverId);
  }

  async updateSettings(
    serverId: string,
    toolName: string,
    settings: McpToolSettings,
  ): Promise<Result<CachedMcpTool>> {
    try {
      const [row] = await this.db
        .update(admin_mcp_tools)
        .set({
          pagination_config: settings.pagination,
          status_config: settings.status,
          citation_config: settings.citation,
          updated_at: new Date(),
        })
        .where(and(eq(admin_mcp_tools.server_id, serverId), eq(admin_mcp_tools.name, toolName)))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "That tool is not cached for this server — refresh its tools first."));
      return ok(toCachedMcpTool(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to save the tool's settings.", cause));
    }
  }
}
