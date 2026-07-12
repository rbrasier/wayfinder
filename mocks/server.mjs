// Shared HTTP server that hosts every local mock endpoint on a single port.
// Each mock endpoint is a module that exports a `mock` object of shape
// `{ path, label, handle }`. The server routes by URL path — the port stays
// fixed (4001) forever; new endpoints pick a new path, not a new port.
//
// Adding a new mock endpoint:
//   1. Create mocks/<service>/<endpoint>.mjs that exports:
//        export const mock = {
//          path: "/<unique-path>",       // must start with "/", must be unique
//          label: "<human-readable>",    // shown in startup log
//          handle: (req, res) => { ... } // Node http request handler
//        };
//      One service may expose several endpoints (e.g. mcp-tools has one file
//      per transport). Put them alongside each other under the same folder.
//   2. Import the file below and append `mock` to MOCKS.
//   3. If it needs new npm deps, add them to mocks/package.json.
//
// Health check: GET /healthz → 200 "ok" (reserved, do not use as a mock path).

import { createServer } from "node:http";
import { mock as mcpToolsStreamableHttp } from "./mcp-tools/streamable-http.mjs";
import { mock as mcpToolsSse } from "./mcp-tools/sse.mjs";

const PORT = Number(process.env.MOCKS_PORT ?? 4001);

const MOCKS = [mcpToolsStreamableHttp, mcpToolsSse];

const routes = new Map();
for (const mock of MOCKS) {
  if (!mock.path.startsWith("/") || mock.path === "/healthz") {
    throw new Error(`invalid mock path: ${mock.path}`);
  }
  if (routes.has(mock.path)) {
    throw new Error(`duplicate mock path: ${mock.path}`);
  }
  routes.set(mock.path, mock);
}

// Order routes by descending path length so a longer prefix (e.g. /mcp/sse)
// wins over a shorter one (e.g. /mcp) when both match on a subtree.
const orderedRoutes = [...routes.values()].sort((a, b) => b.path.length - a.path.length);

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  const matched = orderedRoutes.find(
    (mock) => url.pathname === mock.path || url.pathname.startsWith(`${mock.path}/`),
  );

  if (!matched) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  try {
    await matched.handle(req, res);
  } catch (cause) {
    console.error(`[mocks] ${matched.label} handler failed:`, cause);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("mock handler failure");
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`[mocks] listening on http://localhost:${PORT}`);
  for (const mock of MOCKS) {
    console.log(`  ${mock.label} → http://localhost:${PORT}${mock.path}`);
  }
});

const shutdown = () => {
  httpServer.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
