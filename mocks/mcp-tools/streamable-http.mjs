// Mock MCP server — Streamable HTTP transport, mounted at /mcp on the shared
// mocks server. Stateful: one session per client, so any number of clients can
// connect (see stateful-http.mjs).

import { createMockMcpServer } from "./tools.mjs";
import { statefulStreamableHttpHandler } from "./stateful-http.mjs";

export const mock = {
  path: "/mcp",
  label: "mcp-tools (streamable-http)",
  handle: statefulStreamableHttpHandler(createMockMcpServer),
};
