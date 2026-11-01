import {
  domainError,
  err,
  ok,
  type IMcpServerRepository,
  type ListMcpServersInput,
  type McpOAuthSettings,
  type McpServer,
  type McpServerStatus,
  type McpServerUpdate,
  type NewMcpServer,
  type Result,
} from "@wayfinder/domain";
import { desc, eq } from "drizzle-orm";
import type { SettingsEncryptionService } from "../config/settings-encryption";
import type { Database } from "../db/client";
import { admin_mcp_servers } from "../db/schema/admin";

export type McpServerRow = typeof admin_mcp_servers.$inferSelect;

// Header names only — values never leave the secret store (ADR-062 §8). A
// ciphertext that will not decrypt (rotated key, tampered row) lists as no
// headers rather than failing every read of the server list.
const readHeaderNames = (ciphertext: string | null, encryption: SettingsEncryptionService): string[] => {
  if (!ciphertext) return [];
  try {
    const parsed: unknown = JSON.parse(encryption.decrypt(ciphertext));
    return typeof parsed === "object" && parsed !== null ? Object.keys(parsed) : [];
  } catch {
    return [];
  }
};

const oauthOf = (row: McpServerRow): McpOAuthSettings | null => {
  if (!row.oauth_token_url || !row.oauth_client_id) return null;
  return {
    tokenUrl: row.oauth_token_url,
    clientId: row.oauth_client_id,
    scope: row.oauth_scope,
    audience: row.oauth_audience,
    clientAuthMethod: row.oauth_client_auth_method ?? "client_secret_basic",
  };
};

type OAuthColumns = Partial<
  Pick<McpServerRow, "oauth_token_url" | "oauth_client_id" | "oauth_scope" | "oauth_audience" | "oauth_client_auth_method">
>;

// The settings only — the client secret is written by the secret store.
export const oauthColumns = (oauth: McpOAuthSettings | null | undefined): OAuthColumns => {
  if (oauth === undefined) return {};
  return {
    oauth_token_url: oauth?.tokenUrl ?? null,
    oauth_client_id: oauth?.clientId ?? null,
    oauth_scope: oauth?.scope ?? null,
    oauth_audience: oauth?.audience ?? null,
    oauth_client_auth_method: oauth?.clientAuthMethod ?? null,
  };
};

export const toMcpServerEntity = (row: McpServerRow, encryption: SettingsEncryptionService): McpServer => ({
  id: row.id,
  label: row.label,
  transport: row.transport,
  url: row.url,
  dataClassification: row.data_classification,
  verbatimOnly: row.verbatim_only,
  callTimeoutMs: row.call_timeout_ms,
  hasCredential: row.credential_ciphertext !== null,
  customHeaderNames: readHeaderNames(row.custom_headers_ciphertext, encryption),
  oauth: oauthOf(row),
  status: row.status,
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleMcpServerRepository implements IMcpServerRepository {
  constructor(
    private readonly db: Database,
    private readonly encryption: SettingsEncryptionService,
  ) {}

  private toEntity(row: McpServerRow): McpServer {
    return toMcpServerEntity(row, this.encryption);
  }

  async create(input: NewMcpServer): Promise<Result<McpServer>> {
    try {
      const [row] = await this.db
        .insert(admin_mcp_servers)
        .values({
          label: input.label,
          transport: input.transport ?? "sse",
          url: input.url,
          data_classification: input.dataClassification ?? "internal",
          verbatim_only: input.verbatimOnly ?? false,
          call_timeout_ms: input.callTimeoutMs,
          ...oauthColumns(input.oauth),
          created_by_user_id: input.createdByUserId ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Insert returned no row."));
      return ok(this.toEntity(row));
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
          data_classification: patch.dataClassification ?? current.data_classification,
          verbatim_only: patch.verbatimOnly ?? current.verbatim_only,
          call_timeout_ms: patch.callTimeoutMs ?? current.call_timeout_ms,
          ...oauthColumns(patch.oauth),
          updated_at: new Date(),
        })
        .where(eq(admin_mcp_servers.id, id))
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Update returned no row."));
      return ok(this.toEntity(row));
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
      return ok(row ? this.toEntity(row) : null);
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
      return ok(rows.map((row) => this.toEntity(row)));
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
      return ok(this.toEntity(row));
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
