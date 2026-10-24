import { randomUUID } from "node:crypto";
import {
  domainError,
  err,
  ok,
  type IMcpClient,
  type IMcpServerRepository,
  type McpServer,
  type McpTool,
  type McpToolCallOutput,
  type Result,
} from "@rbrasier/domain";
import { experimental_createMCPClient, type MCPTransport } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EnvLegacyMcpCredentialSource } from "./env-legacy-mcp-credential-source";

type SseTransportConfig = { type: "sse"; url: string; headers: Record<string, string> };

// Hard wall-clock cap on a single MCP round-trip (connect + list/call). The
// deterministic node runs after the turn lease is claimed, so a hung server would
// otherwise hold the lease and block every participant — this bounds that to a
// clean, logged failure rather than an indefinite hang.
const MCP_CALL_TIMEOUT_MS = 8_000;

// Shape of an MCP CallToolResult we care about — the SDK returns richer content,
// but tool output is flattened to text for injection/persistence (ADR-032).
type ToolResultContent = { type: string; text?: string };
type ToolResult = { content?: ToolResultContent[] };

// Talks to remote SSE MCP servers via the Vercel AI SDK MCP client. A fresh
// client is opened per call and always closed — the SDK recommends one client per
// server and does not pool connections (verified in node_modules/ai).
export class AiSdkMcpClient implements IMcpClient {
  constructor(private readonly credentials: Pick<IMcpServerRepository, "readCredential">) {}

  async listTools(server: McpServer): Promise<Result<McpTool[]>> {
    return this.withClient(server, "Failed to list MCP tools.", async (client) => {
      const tools = await client.tools();
      const list: McpTool[] = Object.entries(tools).map(([name, tool]) => ({
        name,
        description: tool.description ?? null,
        inputSchema: null,
      }));
      return ok(list);
    });
  }

  async callTool(
    server: McpServer,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<Result<McpToolCallOutput>> {
    return this.withClient(server, "Failed to call MCP tool.", async (client) => {
      const tools = await client.tools();
      const tool = tools[toolName];
      if (!tool || typeof tool.execute !== "function") {
        return err(domainError("NOT_FOUND", `Tool "${toolName}" not found on this server.`));
      }
      const result = (await tool.execute(args, {
        toolCallId: randomUUID(),
        messages: [],
      })) as ToolResult;
      return ok({ output: flattenResult(result) });
    });
  }

  private async withClient<T>(
    server: McpServer,
    failureMessage: string,
    run: (client: Awaited<ReturnType<typeof experimental_createMCPClient>>) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    const storedToken = server.hasCredential ? await this.credentials.readCredential(server.id) : ok(null);
    if (storedToken.error) return storedToken;
    let client: Awaited<ReturnType<typeof experimental_createMCPClient>> | null = null;
    try {
      client = await withTimeout(
        experimental_createMCPClient({ transport: buildMcpTransport(server, storedToken.data) }),
        MCP_CALL_TIMEOUT_MS,
      );
      return await withTimeout(run(client), MCP_CALL_TIMEOUT_MS);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", failureMessage, cause));
    } finally {
      if (client) {
        try {
          await client.close();
        } catch {
          // Closing a dead connection is best-effort; never mask the real result.
        }
      }
    }
  }
}

// Rejects with a timeout error if the operation has not settled by the deadline.
// The MCP SDK has no per-call abort hook, so this bounds a hung server at the
// promise boundary; the surrounding withClient still closes the client.
function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`MCP operation timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

// Resolves a server descriptor to the transport the AI SDK MCP client accepts:
// the built-in SSE shorthand for `sse` servers, or a StreamableHTTPClientTransport
// instance for `streamable-http` servers (ADR-032 §1). Exported for unit testing.
export function buildMcpTransport(
  server: McpServer,
  storedToken: string | null = null,
): SseTransportConfig | MCPTransport {
  const headers = resolveAuthHeaders(server, storedToken);
  if (server.transport === "streamable-http") {
    // The MCP SDK's Transport implements the AI SDK MCPTransport surface
    // (start/send/close/onmessage) — verified in node_modules/@modelcontextprotocol/sdk.
    return new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers },
    }) as unknown as MCPTransport;
  }
  return { type: "sse", url: server.url, headers };
}

const legacyCredentials = new EnvLegacyMcpCredentialSource();

// The stored token wins; a server registered before tokens were stored falls
// back to its `MCP_CRED_` environment variable. Neither ever leaves this layer
// (ADR-032).
function resolveAuthHeaders(server: McpServer, storedToken: string | null): Record<string, string> {
  const token =
    storedToken ?? (server.credentialRef ? legacyCredentials.read(server.credentialRef) : null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function flattenResult(result: ToolResult): string {
  const parts = result.content ?? [];
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim();
  return text.length > 0 ? text : JSON.stringify(result);
}
