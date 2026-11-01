import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMockMcpServer } from "./tools.mjs";
import { statefulStreamableHttpHandler } from "./stateful-http.mjs";

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
});
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };

let server;
const listen = async () => {
  server = createServer(statefulStreamableHttpHandler(createMockMcpServer));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}/mcp`;
};

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
});

describe("statefulStreamableHttpHandler", () => {
  it("opens a separate session for every client that initializes", async () => {
    const url = await listen();

    const first = await fetch(url, { method: "POST", headers, body: initialize });
    const second = await fetch(url, { method: "POST", headers, body: initialize });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.text()).not.toContain("already initialized");
    expect(first.headers.get("mcp-session-id")).not.toBe(second.headers.get("mcp-session-id"));
  });

  it("refuses a request naming a session it never issued", async () => {
    const url = await listen();

    const result = await fetch(url, { method: "POST", headers: { ...headers, "mcp-session-id": "nope" }, body: initialize });

    expect(result.status).toBe(404);
  });
});
