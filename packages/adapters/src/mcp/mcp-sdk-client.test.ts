import { afterEach, describe, expect, it } from "vitest";
import { ok } from "@wayfinder/domain";
import type { IMcpServerSecretStore, McpServer, McpServerSecrets, McpToolSettings } from "@wayfinder/domain";
import { McpSdkClient } from "./mcp-sdk-client";
import { startMcpFixture, type FixtureMode, type McpFixture } from "./mcp-fixture-server.test-support";

const serverFor = (fixture: McpFixture, mode: FixtureMode, overrides: Partial<McpServer> = {}): McpServer => ({
  id: "mcp-1",
  label: "Legislation",
  transport: mode === "sse" ? "sse" : "streamable-http",
  url: fixture.url,
  dataClassification: "public-read",
  verbatimOnly: false,
  callTimeoutMs: 5_000,
  hasCredential: false,
  customHeaderNames: [],
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const secretsOf = (secrets: McpServerSecrets): IMcpServerSecretStore => ({
  get: async () => ok(secrets),
  set: async () => ok(undefined),
});

const noSecrets = secretsOf({ bearerToken: null, headers: {} });

const settings = (overrides: Partial<McpToolSettings> = {}): McpToolSettings => ({
  pagination: null,
  status: null,
  citation: null,
  ...overrides,
});

const pagination = { cursorArgument: "cursor", nextCursorPath: "next_cursor", itemsPath: "items", maxPages: 5 };
const citation = { recordsPath: "items", locatorField: "id", titleField: "title", urlField: "url", timestampField: null };

let fixture: McpFixture | null = null;

afterEach(async () => {
  await fixture?.close();
  fixture = null;
});

describe.each<FixtureMode>(["stateless", "stateful", "sse"])("McpSdkClient against a %s server", (mode) => {
  it("lists tools with their titles and input schemas", async () => {
    fixture = await startMcpFixture(mode);
    const tools = await new McpSdkClient(noSecrets).listTools(serverFor(fixture, mode));

    const pagedSearch = tools.data?.find((tool) => tool.name === "paged_search");
    expect(pagedSearch?.title).toBe("Paged search");
    expect(pagedSearch?.inputSchema).toMatchObject({ type: "object", properties: { query: { type: "string" } } });
  });

  it("calls a tool and returns its text", async () => {
    fixture = await startMcpFixture(mode);
    const result = await new McpSdkClient(noSecrets).callTool(serverFor(fixture, mode), "plain_text", { message: "hi" });

    expect(result.data).toMatchObject({ output: "echo: hi", structuredContent: null, pagesFetched: 1, citations: [] });
  });
});

describe("McpSdkClient", () => {
  it("never sends a session id to a stateless server", async () => {
    fixture = await startMcpFixture("stateless");
    await new McpSdkClient(noSecrets).callTool(serverFor(fixture, "stateless"), "plain_text", { message: "hi" });

    expect(fixture.sessionIdsSent.every((sessionId) => sessionId === undefined)).toBe(true);
    expect(fixture.seenHeaders.every((headers) => headers["mcp-session-id"] === undefined)).toBe(true);
  });

  it("follows pagination, combines the items and keeps them as structured content", async () => {
    fixture = await startMcpFixture("stateless");
    const pages: number[] = [];

    const result = await new McpSdkClient(noSecrets).callTool(
      serverFor(fixture, "stateless"),
      "paged_search",
      { query: "acts" },
      { settings: settings({ pagination, citation }), onPage: (page) => pages.push(page) },
    );

    expect(pages).toEqual([1, 2, 3]);
    expect(result.data?.pagesFetched).toBe(3);
    expect(result.data?.truncatedAtPageLimit).toBe(false);
    expect((result.data?.structuredContent as { items: unknown[] }).items).toHaveLength(3);
    expect(result.data?.citations.map((entry) => entry.locator)).toEqual(["act-1", "act-2", "act-3"]);
    expect(result.data?.citations[0]).toMatchObject({ serverId: "mcp-1", serverLabel: "Legislation", toolName: "paged_search" });
  });

  it("stops at the page limit and says so in the output", async () => {
    fixture = await startMcpFixture("stateless");

    const result = await new McpSdkClient(noSecrets).callTool(
      serverFor(fixture, "stateless"),
      "paged_search",
      { query: "acts" },
      { settings: settings({ pagination: { ...pagination, maxPages: 2 } }) },
    );

    expect(result.data?.pagesFetched).toBe(2);
    expect(result.data?.truncatedAtPageLimit).toBe(true);
    expect((result.data?.structuredContent as { items: unknown[] }).items).toHaveLength(2);
    expect(result.data?.output).toContain("Stopped after 2 pages");
  });

  it("calls a paginating tool once when it has no pagination settings", async () => {
    fixture = await startMcpFixture("stateless");

    const result = await new McpSdkClient(noSecrets).callTool(serverFor(fixture, "stateless"), "paged_search", { query: "acts" });

    expect(result.data?.pagesFetched).toBe(1);
    expect(result.data?.structuredContent).toMatchObject({ next_cursor: "p2" });
  });

  it("turns resource links into citations", async () => {
    fixture = await startMcpFixture("stateless");

    const result = await new McpSdkClient(noSecrets).callTool(serverFor(fixture, "stateless"), "linked", {});

    expect(result.data?.output).toBe("See the release.");
    expect(result.data?.citations).toEqual([
      expect.objectContaining({ locator: "https://stats.example/r/9", title: "June release", url: "https://stats.example/r/9" }),
    ]);
  });

  it("maps the source's status and caveats and states them in the output", async () => {
    fixture = await startMcpFixture("stateless");

    const result = await new McpSdkClient(noSecrets).callTool(serverFor(fixture, "stateless"), "status_down", {}, {
      settings: settings({ status: { statusPath: "status", meanings: { down: "source-unavailable" }, caveatsPath: "caveats" } }),
    });

    expect(result.data?.sourceStatus).toEqual({
      kind: "source-unavailable",
      raw: "down",
      caveats: ["Feed offline since 09:00"],
      confidence: 0,
    });
    expect(result.data?.output).toContain("Source status: source unavailable");
    expect(result.data?.output).toContain("Caveat: Feed offline since 09:00");
  });

  it("fails a call that runs past the server's timeout", async () => {
    fixture = await startMcpFixture("stateless");
    const started = Date.now();

    const result = await new McpSdkClient(noSecrets).callTool(
      serverFor(fixture, "stateless", { callTimeoutMs: 1_000 }),
      "slow",
      { ms: 3_000 },
    );

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it("returns a tool error as a failure carrying the tool's message", async () => {
    fixture = await startMcpFixture("stateless");

    const result = await new McpSdkClient(noSecrets).callTool(serverFor(fixture, "stateless"), "broken", {});

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toContain("upstream exploded");
  });

  it("returns NOT_FOUND for a tool the server does not list", async () => {
    fixture = await startMcpFixture("stateless");

    const result = await new McpSdkClient(noSecrets).callTool(serverFor(fixture, "stateless"), "missing", {});

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it.each<FixtureMode>(["stateless", "sse"])("sends the bearer token and custom headers to a %s server", async (mode) => {
    fixture = await startMcpFixture(mode);
    const secrets = secretsOf({ bearerToken: "token-1", headers: { "X-Api-Key": "key-1" } });

    await new McpSdkClient(secrets).listTools(serverFor(fixture, mode));

    expect(fixture.seenHeaders.length).toBeGreaterThan(0);
    for (const headers of fixture.seenHeaders) {
      expect(headers.authorization).toBe("Bearer token-1");
      expect(headers["x-api-key"]).toBe("key-1");
    }
  });
});
