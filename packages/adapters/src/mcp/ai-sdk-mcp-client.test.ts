import type { McpServer } from "@rbrasier/domain";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildMcpTransport } from "./ai-sdk-mcp-client";

const serverWith = (overrides: Partial<McpServer>): McpServer => ({
  id: "s",
  label: "S",
  transport: "sse",
  url: "https://mcp.example.com/sse",
  credentialRef: null,
  communicatesExternally: false,
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("buildMcpTransport", () => {
  const original = process.env.MCP_TEST_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.MCP_TEST_TOKEN;
    else process.env.MCP_TEST_TOKEN = original;
  });

  it("returns the AI SDK SSE shorthand for an sse server", () => {
    const transport = buildMcpTransport(serverWith({ transport: "sse" }));
    expect(transport).toEqual({ type: "sse", url: "https://mcp.example.com/sse", headers: {} });
  });

  it("returns a StreamableHTTPClientTransport instance for a streamable-http server", () => {
    const transport = buildMcpTransport(
      serverWith({ transport: "streamable-http", url: "http://spellcheck:8000/mcp" }),
    );
    expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
  });

  it("passes the resolved bearer token as an Authorization header on the sse shorthand", () => {
    process.env.MCP_TEST_TOKEN = "secret-token";
    const transport = buildMcpTransport(
      serverWith({ transport: "sse", credentialRef: "MCP_TEST_TOKEN" }),
    );
    expect(transport).toEqual({
      type: "sse",
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "Bearer secret-token" },
    });
  });
});
