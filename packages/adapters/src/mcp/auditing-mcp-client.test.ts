import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type { IAuditLogger, IMcpClient, ILogger, McpServer, McpToolCallOutput } from "@wayfinder/domain";
import { AuditingMcpClient } from "./auditing-mcp-client";

const server: McpServer = {
  id: "mcp-1",
  label: "Legislation",
  transport: "streamable-http",
  url: "https://legislation.example/mcp",
  dataClassification: "public-read",
  verbatimOnly: false,
  callTimeoutMs: 30_000,
  hasCredential: false,
  customHeaderNames: [],
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const output: McpToolCallOutput = {
  output: "twelve acts",
  structuredContent: null,
  citations: [],
  pagesFetched: 3,
  truncatedAtPageLimit: false,
  sourceStatus: { kind: "ok", raw: "ok", caveats: [], confidence: 1 },
};

const context = { actorId: "user-1", sessionId: "sess-1", flowId: "flow-1", nodeId: "node-1", path: "node" as const };

const build = (callTool: IMcpClient["callTool"], log = vi.fn().mockResolvedValue(ok(true))) => {
  const inner: IMcpClient = { listTools: vi.fn().mockResolvedValue(ok([])), callTool };
  const auditLogger: IAuditLogger = { log };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as ILogger;
  return { client: new AuditingMcpClient(inner, auditLogger, logger), log, logger, inner };
};

describe("AuditingMcpClient", () => {
  it("writes one audit row for a successful call, with what was sent to the source", async () => {
    const { client, log } = build(vi.fn().mockResolvedValue(ok(output)));

    const result = await client.callTool(server, "search_legislation", { query: "water" }, { context });

    expect(result.data).toEqual(output);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({
      actorId: "user-1",
      action: "mcp.tool.called",
      resourceType: "mcp_server",
      resourceId: "mcp-1",
      metadata: expect.objectContaining({
        toolName: "search_legislation",
        path: "node",
        sessionId: "sess-1",
        flowId: "flow-1",
        nodeId: "node-1",
        arguments: '{"query":"water"}',
        argumentsTruncated: false,
        outcome: "ok",
        errorMessage: null,
        pagesFetched: 3,
        truncatedAtPageLimit: false,
        resultChars: 11,
        sourceStatus: "ok",
        durationMs: expect.any(Number),
      }),
    });
  });

  it("writes an audit row for a failed call too", async () => {
    const { client, log } = build(vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "timed out"))));

    const result = await client.callTool(server, "search_legislation", {}, { context });

    expect(result.error?.message).toBe("timed out");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "error", errorMessage: "timed out", pagesFetched: 0 }),
      }),
    );
  });

  it("caps the arguments it records and says it did", async () => {
    const { client, log } = build(vi.fn().mockResolvedValue(ok(output)));

    await client.callTool(server, "search_legislation", { query: "x".repeat(10_000) }, { context });

    const metadata = log.mock.calls[0]![0].metadata;
    expect(metadata.arguments.length).toBeLessThanOrEqual(8_000);
    expect(metadata.argumentsTruncated).toBe(true);
  });

  it("records a call with no context as having no actor", async () => {
    const { client, log } = build(vi.fn().mockResolvedValue(ok(output)));

    await client.callTool(server, "search_legislation", {});

    expect(log).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }));
  });

  it("never fails the call because the audit write failed", async () => {
    const { client, logger } = build(
      vi.fn().mockResolvedValue(ok(output)),
      vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "audit down"))),
    );

    const result = await client.callTool(server, "search_legislation", {}, { context });

    expect(result.data).toEqual(output);
    expect(logger.error).toHaveBeenCalled();
  });

  it("passes listTools straight through without auditing", async () => {
    const { client, log, inner } = build(vi.fn());

    await client.listTools(server);

    expect(inner.listTools).toHaveBeenCalledWith(server);
    expect(log).not.toHaveBeenCalled();
  });
});
