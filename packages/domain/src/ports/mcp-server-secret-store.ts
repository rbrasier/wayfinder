import type { McpServerSecrets, McpServerSecretsPatch } from "../entities/mcp-server";
import type { Result } from "../result";

// Encrypted, write-only credential and header storage per server (ADR-062 §8).
// `get` exists for the MCP client alone; nothing that answers a person calls it.
export interface IMcpServerSecretStore {
  get(serverId: string): Promise<Result<McpServerSecrets>>;
  set(serverId: string, patch: McpServerSecretsPatch): Promise<Result<void>>;
}
