import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// A real MCP server on an ephemeral port, for adapter tests. `stateless` builds
// a fresh server and transport per request with no session id — the shape of a
// public-data server that keeps no state between calls.
export type FixtureMode = "stateful" | "stateless" | "sse";

export interface McpFixture {
  readonly url: string;
  readonly seenHeaders: Record<string, string | string[] | undefined>[];
  readonly sessionIdsSent: (string | undefined)[];
  close(): Promise<void>;
}

const PAGES = [
  { items: [{ id: "act-1", title: "Water Act", url: "https://legislation.example/act-1" }], next_cursor: "p2" },
  { items: [{ id: "act-2", title: "Fire Act", url: "https://legislation.example/act-2" }], next_cursor: "p3" },
  { items: [{ id: "act-3", title: "Roads Act", url: "https://legislation.example/act-3" }], next_cursor: null },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildServer = (): McpServer => {
  const mcp = new McpServer({ name: "fixture", version: "1.0.0" });

  mcp.registerTool(
    "paged_search",
    { title: "Paged search", description: "Three pages of acts.", inputSchema: { query: z.string(), cursor: z.string().optional() } },
    ({ cursor }) => {
      const index = cursor === "p2" ? 1 : cursor === "p3" ? 2 : 0;
      const page = { status: "ok", ...PAGES[index]! };
      return { content: [{ type: "text", text: JSON.stringify(page) }], structuredContent: page };
    },
  );

  mcp.registerTool("plain_text", { description: "Plain text.", inputSchema: { message: z.string() } }, ({ message }) => ({
    content: [{ type: "text", text: `echo: ${message}` }],
  }));

  mcp.registerTool("slow", { description: "Waits.", inputSchema: { ms: z.number() } }, async ({ ms }) => {
    await sleep(ms);
    return { content: [{ type: "text", text: "finally" }] };
  });

  mcp.registerTool("linked", { description: "Resource links.", inputSchema: {} }, () => ({
    content: [
      { type: "text", text: "See the release." },
      { type: "resource_link", uri: "https://stats.example/r/9", name: "release-9", title: "June release" },
    ],
  }));

  mcp.registerTool("broken", { description: "Always errors.", inputSchema: {} }, () => ({
    isError: true,
    content: [{ type: "text", text: "upstream exploded" }],
  }));

  mcp.registerTool("status_down", { description: "Unavailable.", inputSchema: {} }, () => {
    const body = { status: "down", items: [], caveats: ["Feed offline since 09:00"] };
    return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
  });

  return mcp;
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
};

export const startMcpFixture = async (mode: FixtureMode): Promise<McpFixture> => {
  const seenHeaders: McpFixture["seenHeaders"] = [];
  const sessionIdsSent: McpFixture["sessionIdsSent"] = [];
  const sseSessions = new Map<string, SSEServerTransport>();
  const statefulTransport =
    mode === "stateful" ? new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() }) : null;
  if (statefulTransport) await buildServer().connect(statefulTransport);

  const httpServer: Server = createServer(async (request, response) => {
    seenHeaders.push({ ...request.headers });
    const url = new URL(request.url ?? "/", "http://localhost");

    if (mode === "sse") {
      if (request.method === "GET") {
        const transport = new SSEServerTransport("/messages", response);
        sseSessions.set(transport.sessionId, transport);
        await buildServer().connect(transport);
        return;
      }
      const transport = sseSessions.get(url.searchParams.get("sessionId") ?? "");
      if (!transport) {
        response.writeHead(404).end();
        return;
      }
      await transport.handlePostMessage(request, response);
      return;
    }

    const body = request.method === "POST" ? await readBody(request) : undefined;
    if (statefulTransport) {
      await statefulTransport.handleRequest(request, response, body);
      return;
    }

    // Stateless: no session survives the request, and the server never issues
    // an Mcp-Session-Id for a client to send back.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("finish", () => sessionIdsSent.push(response.getHeader("mcp-session-id") as string | undefined));
    response.on("close", () => void transport.close());
    await buildServer().connect(transport);
    await transport.handleRequest(request, response, body);
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: mode === "sse" ? `http://127.0.0.1:${port}/sse` : `http://127.0.0.1:${port}/mcp`,
    seenHeaders,
    sessionIdsSent,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      }),
  };
};
