import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClock } from "./clock.mjs";
import { createParlviewMcpMock, mock } from "./mcp.mjs";

const PERIOD = 5 * 60 * 1000;
const SLOT = 5_976_000;
const TOKEN = "test-token";

// A real socket and the SDK's own client, so the mock is exercised the way
// Wayfinder's MCP client calls it.
let httpServer;
let origin;

beforeAll(async () => {
  const parlviewMcp = createParlviewMcpMock({
    clock: createClock(() => SLOT * PERIOD + 120_000),
    periodMs: PERIOD,
    token: TOKEN,
  });
  httpServer = createServer((req, res) => void parlviewMcp.handle(req, res));
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${httpServer.address().port}`;
});

afterAll(() => new Promise((resolve) => httpServer.close(resolve)));

const connect = async (url, headers = {}) => {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
};

const callJson = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { isError: Boolean(result.isError), body: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
};

describe("mock registration", () => {
  it("claims /parlview/mcp, which outranks the feed's /parlview prefix", () => {
    expect(mock.path).toBe("/parlview/mcp");
  });
});

describe("the mock ParlView MCP", () => {
  it("serves parlviewMCP's six tools under the server name ParlView", async () => {
    const client = await connect(`${origin}/parlview/mcp`, { Authorization: `Bearer ${TOKEN}` });

    const { tools } = await client.listTools();

    expect(client.getServerVersion()).toMatchObject({ name: "ParlView" });
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_live_broadcasts",
      "search_broadcasts",
      "get_transcript",
      "get_recent",
      "search_captions",
      "deep_link",
    ]);
    expect(tools.find((tool) => tool.name === "get_transcript").inputSchema.required).toEqual(["videoId"]);
    await client.close();
  });

  it("accepts the token as the last path segment, for clients that cannot set headers", async () => {
    const client = await connect(`${origin}/parlview/mcp/${TOKEN}`);

    const { body } = await callJson(client, "list_live_broadcasts", {});

    expect(body.broadcasts[0].id).toBe(String(SLOT));
    await client.close();
  });

  it("answers a transcript with links back to the mock's recording page", async () => {
    const client = await connect(`${origin}/parlview/mcp`, { Authorization: `Bearer ${TOKEN}` });

    const { body } = await callJson(client, "get_transcript", { videoId: String(SLOT - 1) });

    expect(body.stream.status).toBe("ok");
    expect(body.passages[0].link).toBe(`${origin}/parlview/video/${SLOT - 1}?startTime=8`);
    await client.close();
  });

  it("reports tool failures as an MCP tool error, not a crash", async () => {
    const client = await connect(`${origin}/parlview/mcp`, { Authorization: `Bearer ${TOKEN}` });

    const result = await callJson(client, "get_transcript", { videoId: "12" });

    expect(result).toEqual({ isError: true, body: "Error: No ParlView recording with media found for id 12." });
    await client.close();
  });

  it("401s a call without the token, as the real server does", async () => {
    const missing = await fetch(`${origin}/parlview/mcp`, { method: "POST" });
    const wrong = await fetch(`${origin}/parlview/mcp`, { method: "POST", headers: { Authorization: "Bearer nope" } });

    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect(wrong.status).toBe(401);
  });
});
