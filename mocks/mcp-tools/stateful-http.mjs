// A stateful Streamable HTTP endpoint that serves any number of clients: each
// `initialize` opens its own session (a fresh server and transport), and later
// requests are routed by their Mcp-Session-Id. A single shared transport accepts
// exactly one `initialize` and refuses every later client with "Server already
// initialized" — and Wayfinder opens a fresh client per call.

import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const statefulStreamableHttpHandler = (createServer) => {
  const sessions = new Map();

  return async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }
    if (typeof sessionId === "string") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("unknown MCP session");
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, transport),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await createServer().connect(transport);
    await transport.handleRequest(req, res);
  };
};
