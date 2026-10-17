// The public-data mock (public-data.mjs) over Streamable HTTP, twice: once with
// sessions, once without, so both shapes of public-data server can be pointed
// at locally. See public-data.mjs for the admin settings to enter.

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPublicDataServer } from "./public-data.mjs";
import { statefulStreamableHttpHandler } from "./stateful-http.mjs";

export const statefulMock = {
  path: "/mcp/public-data",
  label: "mcp-tools (public data, streamable-http)",
  handle: statefulStreamableHttpHandler(() => createPublicDataServer()),
};

// Stateless: no session survives the request, so each one gets its own server
// and transport and no Mcp-Session-Id is ever issued.
export const statelessMock = {
  path: "/mcp/stateless",
  label: "mcp-tools (public data, stateless streamable-http)",
  handle: async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await createPublicDataServer().connect(transport);
    await transport.handleRequest(req, res);
  },
};
