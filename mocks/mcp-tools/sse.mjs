// Mock MCP server — SSE transport, mounted at /mcp/sse on the shared mocks
// server. SSE needs two endpoints per session — one long-lived GET for the
// event stream and short-lived POSTs for client → server messages — so this
// handler routes:
//   GET  /mcp/sse            → open a new SSE session
//   POST /mcp/sse/messages   → deliver a message to an existing session
// (Session identity is the `sessionId` query param on the POST; the SSE server
// transport emits it in the `endpoint` event on connect.)

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createMockMcpServer } from "./tools.mjs";

const BASE_PATH = "/mcp/sse";
const POST_PATH = `${BASE_PATH}/messages`;

const sessions = new Map();

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === BASE_PATH) {
    const transport = new SSEServerTransport(POST_PATH, res);
    sessions.set(transport.sessionId, transport);
    transport.onclose = () => sessions.delete(transport.sessionId);
    await createMockMcpServer().connect(transport);
    return;
  }

  if (req.method === "POST" && url.pathname === POST_PATH) {
    const sessionId = url.searchParams.get("sessionId");
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("unknown SSE session");
      return;
    }
    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

export const mock = {
  path: BASE_PATH,
  label: "mcp-tools (sse)",
  handle,
};
