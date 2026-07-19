import { randomUUID } from "node:crypto";
import {
  domainError,
  err,
  isValidMcpCredentialRef,
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
      client = await withTimeout(
        experimental_createMCPClient({ transport: buildMcpTransport(server) }),
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
  // credentialRef names an environment variable holding a bearer token. It must
  // sit in the MCP_CRED_ namespace: without that fence an admin could point a
  // server they control at credentialRef "DATABASE_URL" and have the secret
  // shipped to their endpoint as a bearer token. The value never leaves this
  // layer (ADR-032).
  if (server.credentialRef && isValidMcpCredentialRef(server.credentialRef)) {
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
