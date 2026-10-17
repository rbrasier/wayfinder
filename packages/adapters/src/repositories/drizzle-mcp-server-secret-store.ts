import {
  domainError,
  err,
  ok,
  type IMcpServerSecretStore,
  type McpServerSecrets,
  type McpServerSecretsPatch,
  type Result,
} from "@wayfinder/domain";
import { eq } from "drizzle-orm";
import type { SettingsEncryptionService } from "../config/settings-encryption";
import type { Database } from "../db/client";
import { admin_mcp_servers } from "../db/schema/admin";

interface SecretColumns {
  credential_ciphertext: string | null;
  custom_headers_ciphertext: string | null;
}

// Only the columns the patch names are written; an empty header map clears the
// column rather than storing an encrypted `{}`.
export const encodeMcpServerSecretsPatch = (
  patch: McpServerSecretsPatch,
  encryption: SettingsEncryptionService,
): Partial<SecretColumns> => {
  const columns: Partial<SecretColumns> = {};
  if (patch.bearerToken !== undefined) {
    columns.credential_ciphertext = patch.bearerToken === null ? null : encryption.encrypt(patch.bearerToken);
  }
  if (patch.headers !== undefined) {
    const hasHeaders = patch.headers !== null && Object.keys(patch.headers).length > 0;
    columns.custom_headers_ciphertext = hasHeaders ? encryption.encrypt(JSON.stringify(patch.headers)) : null;
  }
  return columns;
};

export const decodeMcpServerSecrets = (
  columns: SecretColumns,
  encryption: SettingsEncryptionService,
): McpServerSecrets => ({
  bearerToken: columns.credential_ciphertext ? encryption.decrypt(columns.credential_ciphertext) : null,
  headers: columns.custom_headers_ciphertext
    ? (JSON.parse(encryption.decrypt(columns.custom_headers_ciphertext)) as Record<string, string>)
    : {},
});

// Encrypted, write-only MCP credentials (ADR-062 §8). `get` is for the MCP client
// alone — nothing that answers a person reads secrets back.
export class DrizzleMcpServerSecretStore implements IMcpServerSecretStore {
  constructor(
    private readonly db: Database,
    private readonly encryption: SettingsEncryptionService,
  ) {}

  async get(serverId: string): Promise<Result<McpServerSecrets>> {
    try {
      const [row] = await this.db
        .select({
          credential_ciphertext: admin_mcp_servers.credential_ciphertext,
          custom_headers_ciphertext: admin_mcp_servers.custom_headers_ciphertext,
        })
        .from(admin_mcp_servers)
        .where(eq(admin_mcp_servers.id, serverId))
        .limit(1);
      if (!row) return err(domainError("NOT_FOUND", "MCP server not found."));
      return ok(decodeMcpServerSecrets(row, this.encryption));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to read the MCP server's credentials.", cause));
    }
  }

  async set(serverId: string, patch: McpServerSecretsPatch): Promise<Result<void>> {
    const columns = encodeMcpServerSecretsPatch(patch, this.encryption);
    if (Object.keys(columns).length === 0) return ok(undefined);
    try {
      const [row] = await this.db
        .update(admin_mcp_servers)
        .set({ ...columns, updated_at: new Date() })
        .where(eq(admin_mcp_servers.id, serverId))
        .returning({ id: admin_mcp_servers.id });
      if (!row) return err(domainError("NOT_FOUND", "MCP server not found."));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to save the MCP server's credentials.", cause));
    }
  }
}
