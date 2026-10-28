import { domainError, err, type McpServer } from "@rbrasier/domain";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSdkMcpClient, buildMcpTransport } from "./ai-sdk-mcp-client";
import { EnvLegacyMcpCredentialSource } from "./env-legacy-mcp-credential-source";

const serverWith = (overrides: Partial<McpServer>): McpServer => ({
  id: "s",
  label: "S",
  transport: "sse",
  url: "https://mcp.example.com/sse",
  credentialRef: null,
  hasCredential: false,
  oauth: null,
  communicatesExternally: false,
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("buildMcpTransport", () => {
  const original = process.env.MCP_CRED_TEST_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.MCP_CRED_TEST_TOKEN;
    else process.env.MCP_CRED_TEST_TOKEN = original;
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
    process.env.MCP_CRED_TEST_TOKEN = "secret-token";
    const transport = buildMcpTransport(
      serverWith({ transport: "sse", credentialRef: "MCP_CRED_TEST_TOKEN" }),
    );
    expect(transport).toEqual({
      type: "sse",
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "Bearer secret-token" },
    });
  });

  it("ignores a credential reference outside the MCP_CRED_ namespace", () => {
    // The reference is rejected before any env lookup, so a name like DATABASE_URL
    // can never be read and shipped as a bearer token.
    const transport = buildMcpTransport(
      serverWith({ transport: "sse", credentialRef: "DATABASE_URL" }),
    );
    expect(transport).toEqual({ type: "sse", url: "https://mcp.example.com/sse", headers: {} });
  });

  it("sends a stored token, and prefers it over a legacy environment variable", () => {
    process.env.MCP_CRED_TEST_TOKEN = "from-env";
    const transport = buildMcpTransport(
      serverWith({ transport: "sse", credentialRef: "MCP_CRED_TEST_TOKEN", hasCredential: true }),
      "stored-token",
    );
    expect(transport).toEqual({
      type: "sse",
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "Bearer stored-token" },
    });
  });
});

describe("AiSdkMcpClient", () => {
  it("reports a failed token request, such as on Test connection, without trying to connect", async () => {
    const resolve = vi.fn(async () =>
      err(domainError("INFRA_FAILURE", "Couldn't get an access token from login.example.com: invalid_client")),
    );
    const client = new AiSdkMcpClient({ resolve });

    const result = await client.listTools(serverWith({ url: "http://127.0.0.1:1/never-called" }));

    expect(result.error?.message).toBe("Couldn't get an access token from login.example.com: invalid_client");
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("EnvLegacyMcpCredentialSource", () => {
  const source = new EnvLegacyMcpCredentialSource({
    MCP_CRED_GITHUB: "ghp_legacy",
    DATABASE_URL: "postgres://secret",
    MCP_CRED_EMPTY: "",
  });

  it("reads a variable inside the MCP_CRED_ namespace", () => {
    expect(source.read("MCP_CRED_GITHUB")).toBe("ghp_legacy");
  });

  it("refuses any other process variable, so it cannot be copied into a stored token", () => {
    expect(source.read("DATABASE_URL")).toBeNull();
  });

  it("treats an unset or empty variable as no token", () => {
    expect(source.read("MCP_CRED_MISSING")).toBeNull();
    expect(source.read("MCP_CRED_EMPTY")).toBeNull();
  });
});
