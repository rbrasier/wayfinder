import { randomUUID } from "node:crypto";
import {
  domainError,
  err,
  ok,
  type IMcpClient,
  type McpServer,
  type McpTool,
  type McpToolCallOutput,
  type Result,
} from "@rbrasier/domain";
import { experimental_createMCPClient, type MCPTransport } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type SseTransportConfig = { type: "sse"; url: string; headers: Record<string, string> };

// Shape of an MCP CallToolResult we care about — the SDK returns richer content,
// but tool output is flattened to text for injection/persistence (ADR-032).
type ToolResultContent = { type: string; text?: string };
type ToolResult = { content?: ToolResultContent[] };

// Talks to remote SSE MCP servers via the Vercel AI SDK MCP client. A fresh
// client is opened per call and always closed — the SDK recommends one client per
// server and does not pool connections (verified in node_modules/ai).
export class AiSdkMcpClient implements IMcpClient {
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
    let client: Awaited<ReturnType<typeof experimental_createMCPClient>> | null = null;
    try {
      client = await experimental_createMCPClient({ transport: buildMcpTransport(server) });
      return await run(client);
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

// Resolves a server descriptor to the transport the AI SDK MCP client accepts:
// the built-in SSE shorthand for `sse` servers, or a StreamableHTTPClientTransport
// instance for `streamable-http` servers (ADR-032 §1). Exported for unit testing.
export function buildMcpTransport(server: McpServer): SseTransportConfig | MCPTransport {
  const headers = resolveAuthHeaders(server);
  if (server.transport === "streamable-http") {
    // The MCP SDK's Transport implements the AI SDK MCPTransport surface
    // (start/send/close/onmessage) — verified in node_modules/@modelcontextprotocol/sdk.
    return new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers },
    }) as unknown as MCPTransport;
  }
  return { type: "sse", url: server.url, headers };
}

function resolveAuthHeaders(server: McpServer): Record<string, string> {
  const headers: Record<string, string> = {};
  // credentialRef names an environment variable holding a bearer token. The
  // secret value never leaves this layer (ADR-032).
  if (server.credentialRef) {
    const token = process.env[server.credentialRef];
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
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
