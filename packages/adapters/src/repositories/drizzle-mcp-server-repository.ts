import {
  domainError,
  err,
  ok,
  type IMcpServerRepository,
  type ListMcpServersInput,
  type McpServer,
  type McpServerStatus,
  type McpServerUpdate,
  type NewMcpServer,
  type Result,
} from "@rbrasier/domain";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { admin_mcp_servers } from "../db/schema/admin";

const toEntity = (row: typeof admin_mcp_servers.$inferSelect): McpServer => ({
  id: row.id,
  label: row.label,
  transport: row.transport,
  url: row.url,
  credentialRef: row.credential_ref,
  communicatesExternally: row.communicates_externally,
  status: row.status,
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleMcpServerRepository implements IMcpServerRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewMcpServer): Promise<Result<McpServer>> {
    try {
      const [row] = await this.db
        .insert(admin_mcp_servers)
        .values({
          label: input.label,
          transport: input.transport ?? "sse",
          url: input.url,
          credential_ref: input.credentialRef ?? null,
          communicates_externally: input.communicatesExternally ?? false,
          created_by_user_id: input.createdByUserId ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create MCP server.", cause));
    }
  }

  async update(id: string, patch: McpServerUpdate): Promise<Result<McpServer>> {
    try {
      const [current] = await this.db
        .select()
        .from(admin_mcp_servers)
        .where(eq(admin_mcp_servers.id, id))
        .limit(1);
      if (!current) return err(domainError("NOT_FOUND", "MCP server not found."));

      const [row] = await this.db
        .update(admin_mcp_servers)
        .set({
          label: patch.label ?? current.label,
          url: patch.url ?? current.url,
          credential_ref:
            patch.credentialRef === undefined ? current.credential_ref : patch.credentialRef,
          communicates_externally:
            patch.communicatesExternally ?? current.communicates_externally,
          updated_at: new Date(),
        })
        .where(eq(admin_mcp_servers.id, id))
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Update returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update MCP server.", cause));
    }
  }

  async findById(id: string): Promise<Result<McpServer | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(admin_mcp_servers)
        .where(eq(admin_mcp_servers.id, id))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find MCP server.", cause));
    }
  }

  async list(input?: ListMcpServersInput): Promise<Result<McpServer[]>> {
    try {
      const rows = input?.includeDisabled
        ? await this.db.select().from(admin_mcp_servers).orderBy(desc(admin_mcp_servers.updated_at))
        : await this.db
            .select()
            .from(admin_mcp_servers)
            .where(eq(admin_mcp_servers.status, "active"))
            .orderBy(desc(admin_mcp_servers.updated_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list MCP servers.", cause));
    }
  }

  async setStatus(id: string, status: McpServerStatus): Promise<Result<McpServer>> {
    try {
      const [row] = await this.db
        .update(admin_mcp_servers)
        .set({ status, updated_at: new Date() })
        .where(eq(admin_mcp_servers.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "MCP server not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update MCP server status.", cause));
    }
  }

  async delete(id: string): Promise<Result<void>> {
    try {
      const [row] = await this.db
        .delete(admin_mcp_servers)
        .where(eq(admin_mcp_servers.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "MCP server not found."));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to delete MCP server.", cause));
    }
  }
}
