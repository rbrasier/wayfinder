// Mock MCP server — Streamable HTTP transport, mounted at /mcp on the shared
// mocks server. Stateful sessions (verified against @modelcontextprotocol/sdk
// 1.29 that stateless mode returns 500 for `notifications/initialized`).

import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMockMcpServer } from "./tools.mjs";

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
await createMockMcpServer().connect(transport);

export const mock = {
  path: "/mcp",
  label: "mcp-tools (streamable-http)",
  handle: (req, res) => transport.handleRequest(req, res),
};
