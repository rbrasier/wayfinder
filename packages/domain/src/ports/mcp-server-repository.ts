import type {
  McpServer,
  McpServerStatus,
  McpServerUpdate,
  NewMcpServer,
} from "../entities/mcp-server";
import type { Result } from "../result";

export interface ListMcpServersInput {
  readonly includeDisabled?: boolean;
}

export interface IMcpServerRepository {
  create(server: NewMcpServer): Promise<Result<McpServer>>;
  update(id: string, patch: McpServerUpdate): Promise<Result<McpServer>>;
  findById(id: string): Promise<Result<McpServer | null>>;
  // The decrypted bearer token, for the MCP client only — never for a client app.
  readCredential(id: string): Promise<Result<string | null>>;
  // The decrypted OAuth client secret, for the MCP client only.
  readOAuthClientSecret(id: string): Promise<Result<string | null>>;
  list(input?: ListMcpServersInput): Promise<Result<McpServer[]>>;
  setStatus(id: string, status: McpServerStatus): Promise<Result<McpServer>>;
  delete(id: string): Promise<Result<void>>;
}

// Reads a legacy credential from the process environment. Returns null for a
// reference outside the `MCP_CRED_` namespace, so an admin cannot have an
// arbitrary process secret copied into a server's stored token.
export interface ILegacyMcpCredentialSource {
  read(credentialRef: string): string | null;
}
