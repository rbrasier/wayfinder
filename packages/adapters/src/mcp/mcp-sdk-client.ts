import {
  applyStatusMapping,
  domainError,
  EMPTY_MCP_TOOL_SETTINGS,
  err,
  extractCitations,
  MAX_MCP_CALL_TOTAL_MS,
  mergePageItems,
  ok,
  readPath,
  type IMcpClient,
  type IMcpServerSecretStore,
  type McpCallOptions,
  type McpResourceLink,
  type McpServer,
  type McpSourceStatus,
  type McpTool,
  type McpToolCallOutput,
  type McpToolPagination,
  type Result,
} from "@wayfinder/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const CLIENT_INFO = { name: "wayfinder", version: "1.0.0" };

// A server that keeps listing tools past this many pages is misbehaving; the
// editor does not need a thousand tools.
const MAX_TOOL_LIST_PAGES = 10;

type ContentBlock = { type: string; text?: string; uri?: string; name?: string; title?: string };
interface ToolPage {
  content: ContentBlock[];
  structuredContent: unknown;
  isError: boolean;
}

const STATUS_LINES: Record<Exclude<McpSourceStatus["kind"], "ok">, string> = {
  "no-data": "no data — the source answered and holds no matching records",
  "source-unavailable": "source unavailable — the absence of results does not mean none exist",
  "upstream-gap": "upstream gap — the source reports its own data is incomplete",
};

const textOf = (content: ContentBlock[]): string =>
  content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();

// A server that only returns text often returns JSON as that text; reading it
// as structure is what lets pagination, status and citations work for it.
const structuredOf = (page: ToolPage): unknown => {
  if (page.structuredContent !== undefined && page.structuredContent !== null) return page.structuredContent;
  const text = textOf(page.content);
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const resourceLinksOf = (pages: ToolPage[]): McpResourceLink[] =>
  pages.flatMap((page) =>
    page.content
      .filter((block) => block.type === "resource_link" && typeof block.uri === "string")
      .map((block) => ({ uri: block.uri as string, name: block.name, title: block.title })),
  );

const nextCursor = (structured: unknown, pagination: McpToolPagination): string | null => {
  const cursor = readPath(structured, pagination.nextCursorPath);
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
};

// What a model or a response field reads. The trailing lines are what keep a
// cut-short or unavailable result from being read as the complete answer.
const renderOutput = (
  pages: ToolPage[],
  combined: unknown,
  truncatedAtPageLimit: boolean,
  sourceStatus: McpSourceStatus | null,
): string => {
  const singleUnstructured = pages.length === 1 && (pages[0]!.structuredContent ?? null) === null;
  const body = singleUnstructured || combined === null ? textOf(pages[0]!.content) : JSON.stringify(combined);
  const notes: string[] = [];
  if (truncatedAtPageLimit) {
    notes.push(`[Stopped after ${pages.length} pages — the source has more results than were fetched.]`);
  }
  if (sourceStatus && sourceStatus.kind !== "ok") {
    notes.push(`Source status: ${STATUS_LINES[sourceStatus.kind]} (reported as "${sourceStatus.raw}").`);
  }
  for (const caveat of sourceStatus?.caveats ?? []) notes.push(`Caveat: ${caveat}`);
  return notes.length === 0 ? body : `${body}\n\n${notes.join("\n")}`;
};

const describeFailure = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "The MCP server did not answer.";

// Talks to remote MCP servers through the MCP SDK `Client` (ADR-062 §2), which
// negotiates up to protocol 2025-11-25 and works with servers that keep no
// session. A fresh client is opened per call and always closed.
export class McpSdkClient implements IMcpClient {
  constructor(private readonly secrets: IMcpServerSecretStore) {}

  async listTools(server: McpServer): Promise<Result<McpTool[]>> {
    return this.withClient(server, "Failed to list MCP tools.", async (client) => {
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_TOOL_LIST_PAGES; page++) {
        const listed = await client.listTools(cursor ? { cursor } : undefined, { timeout: server.callTimeoutMs });
        for (const tool of listed.tools) {
          tools.push({
            name: tool.name,
            title: tool.title ?? tool.annotations?.title ?? null,
            description: tool.description ?? null,
            inputSchema: (tool.inputSchema as Record<string, unknown> | undefined) ?? null,
          });
        }
        cursor = listed.nextCursor;
        if (!cursor) break;
      }
      return ok(tools);
    });
  }

  async callTool(
    server: McpServer,
    toolName: string,
    args: Record<string, unknown>,
    options: McpCallOptions = {},
  ): Promise<Result<McpToolCallOutput>> {
    return this.withClient(server, "Failed to call MCP tool.", async (client) => {
      const listed = await client.listTools(undefined, { timeout: server.callTimeoutMs });
      if (!listed.tools.some((tool) => tool.name === toolName)) {
        return err(domainError("NOT_FOUND", `Tool "${toolName}" not found on this server.`));
      }

      const settings = options.settings ?? EMPTY_MCP_TOOL_SETTINGS;
      const pagination = settings.pagination;
      const pages: ToolPage[] = [];
      let pageArguments = args;
      let truncatedAtPageLimit = false;
      for (;;) {
        options.onPage?.(pages.length + 1);
        const page = (await client.callTool({ name: toolName, arguments: pageArguments }, undefined, {
          timeout: server.callTimeoutMs,
        })) as unknown as ToolPage;
        if (page.isError) {
          return err(domainError("INFRA_FAILURE", textOf(page.content) || "The tool reported an error."));
        }
        pages.push(page);

        const cursor = pagination ? nextCursor(structuredOf(page), pagination) : null;
        if (!pagination || !cursor) break;
        if (pages.length >= pagination.maxPages) {
          truncatedAtPageLimit = true;
          break;
        }
        pageArguments = { ...args, [pagination.cursorArgument]: cursor };
      }

      const structuredPages = pages.map(structuredOf);
      const combined = pagination ? mergePageItems(structuredPages, pagination.itemsPath) : structuredPages[0]!;
      const sourceStatus = settings.status ? applyStatusMapping(combined, settings.status) : null;
      return ok({
        output: renderOutput(pages, combined ?? null, truncatedAtPageLimit, sourceStatus),
        structuredContent: combined ?? null,
        citations: extractCitations({
          structured: combined,
          mapping: settings.citation,
          resourceLinks: resourceLinksOf(pages),
          origin: { serverId: server.id, serverLabel: server.label, toolName },
        }),
        pagesFetched: pages.length,
        truncatedAtPageLimit,
        sourceStatus,
      });
    });
  }

  private async withClient<T>(
    server: McpServer,
    failureMessage: string,
    run: (client: Client) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    const secrets = await this.secrets.get(server.id);
    if (secrets.error) return err(secrets.error);

    const client = new Client(CLIENT_INFO);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await client.connect(buildMcpTransport(server, secrets.data), { timeout: server.callTimeoutMs });
      // Each request carries the server's own timeout; this bounds the whole call,
      // every page included, so a worker can tell a slow call from a dead one.
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`MCP call timed out after ${MAX_MCP_CALL_TOTAL_MS}ms in total`)),
          MAX_MCP_CALL_TOTAL_MS,
        );
      });
      return await Promise.race([run(client), deadline]);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `${failureMessage} ${describeFailure(cause)}`, cause));
    } finally {
      clearTimeout(timer);
      try {
        await client.close();
      } catch {
        // Closing a dead connection is best-effort; never mask the real result.
      }
    }
  }
}

// The connection's headers: custom headers first, then the bearer token, which
// validation already guarantees no custom Authorization header competes with.
const connectionHeaders = (secrets: { bearerToken: string | null; headers: Record<string, string> }) => ({
  ...secrets.headers,
  ...(secrets.bearerToken ? { Authorization: `Bearer ${secrets.bearerToken}` } : {}),
});

// Exported for unit testing.
export function buildMcpTransport(
  server: McpServer,
  secrets: { bearerToken: string | null; headers: Record<string, string> },
): Transport {
  const requestInit = { headers: connectionHeaders(secrets) };
  if (server.transport === "streamable-http") {
    return new StreamableHTTPClientTransport(new URL(server.url), { requestInit });
  }
  return new SSEClientTransport(new URL(server.url), { requestInit });
}
