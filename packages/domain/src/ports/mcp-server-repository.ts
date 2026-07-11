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
  list(input?: ListMcpServersInput): Promise<Result<McpServer[]>>;
  setStatus(id: string, status: McpServerStatus): Promise<Result<McpServer>>;
}
