import { generateText, type ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type {
  CachedMcpTool,
  IMcpClient,
  IMcpToolRepository,
  IntervalScheduler,
  McpServer,
  McpTool,
  McpToolCallOutput,
  SessionToolProgressEvent,
} from "@wayfinder/domain";
import {
  buildCallRecord,
  buildPrepassTools,
  McpToolPrepass,
  PREPASS_RESULT_MAX_CHARS,
  prefixToolName,
  prepassBudgetMs,
  selectAllowedTools,
} from "./mcp-tool-prepass";
import { recordTokenUsage } from "../observability/usage-tracking-adapter";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
}));
vi.mock("../observability/usage-tracking-adapter", () => ({ recordTokenUsage: vi.fn() }));

const tool = (name: string, overrides: Partial<McpTool> = {}): McpTool => ({
  name,
  title: null,
  description: null,
  inputSchema: null,
  ...overrides,
});

const server = (overrides: Partial<McpServer> = {}): McpServer => ({
  id: "mcp-1",
  label: "Legislation",
  transport: "streamable-http",
  url: "https://legislation.example/mcp",
  dataClassification: "public-read",
  verbatimOnly: false,
  callTimeoutMs: 30_000,
  hasCredential: false,
  customHeaderNames: [],
  oauth: null,
  status: "active",
  createdByUserId: null,
  createdAt: new Date("2026-10-01"),
  updatedAt: new Date("2026-10-01"),
  ...overrides,
});

const cached = (name: string, overrides: Partial<CachedMcpTool> = {}): CachedMcpTool => ({
  ...tool(name),
  serverId: "mcp-1",
  lastSyncedAt: new Date(),
  pagination: null,
  status: null,
  citation: null,
  ...overrides,
});

const citation = {
  serverId: "mcp-1",
  serverLabel: "Legislation",
  toolName: "search",
  locator: "act-1",
  title: "Water Act",
  url: "https://legislation.example/act-1",
  recordedAt: null,
};

const output = (overrides: Partial<McpToolCallOutput> = {}): McpToolCallOutput => ({
  output: "Water Act",
  structuredContent: null,
  citations: [citation],
  pagesFetched: 2,
  truncatedAtPageLimit: false,
  sourceStatus: null,
  ...overrides,
});

const context = { actorId: "user-1", sessionId: "sess-1", flowId: "flow-1", nodeId: "node-1", path: "prepass" as const };
const now = () => new Date("2026-10-17T00:00:00.000Z");
const noBeats: IntervalScheduler = { every: () => () => undefined };

describe("selectAllowedTools", () => {
  const listed = [tool("search"), tool("fetch_page"), tool("delete_everything")];

  it("keeps only the allow-listed tools", () => {
    expect(selectAllowedTools(listed, ["search", "fetch_page"]).map((entry) => entry.name)).toEqual([
      "search",
      "fetch_page",
    ]);
  });

  it("never assembles a tool that is not allow-listed, and ignores names the server lacks", () => {
    expect(selectAllowedTools(listed, ["search", "nonexistent"]).map((entry) => entry.name)).toEqual(["search"]);
    expect(selectAllowedTools(listed, [])).toEqual([]);
  });
});

describe("prefixToolName", () => {
  it("namespaces a tool under its server label", () => {
    expect(prefixToolName("Docs Search", "query")).toBe("Docs_Search__query");
  });

  it("gives two servers exposing the same tool distinct keys", () => {
    expect(prefixToolName("Alpha", "search")).not.toBe(prefixToolName("Beta", "search"));
  });

  it("falls back to a stable prefix when the label has no usable characters", () => {
    expect(prefixToolName("***", "run")).toBe("server__run");
  });
});

describe("prepassBudgetMs", () => {
  it("allows each step its slowest server's timeout", () => {
    expect(prepassBudgetMs([server({ callTimeoutMs: 10_000 }), server({ callTimeoutMs: 20_000 })], 4)).toBe(80_000);
  });

  it("caps the whole pre-pass at two minutes", () => {
    expect(prepassBudgetMs([server({ callTimeoutMs: 60_000 })], 4)).toBe(120_000);
  });
});

describe("buildCallRecord", () => {
  const origin = { serverId: "mcp-1", serverLabel: "Legislation", toolName: "search" };

  it("keeps the whole result with its status, pages and citations", () => {
    const long = "x".repeat(50_000);
    const record = buildCallRecord(origin, { q: "water" }, ok(output({ output: long })), now);

    expect(record).toEqual({
      serverId: "mcp-1",
      serverLabel: "Legislation",
      toolName: "search",
      arguments: '{"q":"water"}',
      result: long,
      truncated: false,
      calledAt: "2026-10-17T00:00:00.000Z",
      pagesFetched: 2,
      sourceStatus: null,
      citations: [citation],
    });
  });

  it("cuts only past the ceiling, and marks the cut", () => {
    const record = buildCallRecord(origin, {}, ok(output({ output: "y".repeat(PREPASS_RESULT_MAX_CHARS + 10) })), now);

    expect(record.result).toHaveLength(PREPASS_RESULT_MAX_CHARS);
    expect(record.truncated).toBe(true);
  });

  it("records a failed call with its reason", () => {
    const record = buildCallRecord(origin, {}, err(domainError("INFRA_FAILURE", "timed out")), now);

    expect(record).toMatchObject({ result: "The tool call failed: timed out", pagesFetched: 0, citations: [] });
  });
});

describe("buildPrepassTools", () => {
  const listed = [cached("search", { title: "Search legislation", description: "Finds acts", inputSchema: { type: "object", properties: { q: { type: "string" } } } }), cached("delete_everything")];

  const build = (callTool: IMcpClient["callTool"], events: SessionToolProgressEvent[] = []) => {
    const client: IMcpClient = { listTools: vi.fn(), callTool };
    return {
      client,
      built: buildPrepassTools({
        servers: [server()],
        toolsByServer: new Map([["mcp-1", listed]]),
        allowedToolNamesByServer: { "mcp-1": ["search"] },
        client,
        context,
        onToolProgress: (event) => events.push(event),
        scheduler: noBeats,
        now,
      }),
    };
  };

  it("offers only allow-listed tools, keyed by server, with their descriptions", () => {
    const { built } = build(vi.fn());

    expect(Object.keys(built.tools)).toEqual(["Legislation__search"]);
    expect(built.tools["Legislation__search"]!.description).toBe("Finds acts");
  });

  it("calls the audited client with the tool's settings and the turn's context, and records the call", async () => {
    const events: SessionToolProgressEvent[] = [];
    const callTool = vi.fn().mockResolvedValue(ok(output()));
    const { built } = build(callTool, events);

    const answer = await built.tools["Legislation__search"]!.execute!({ q: "water" }, { toolCallId: "t1", messages: [] });

    expect(answer).toBe("Water Act");
    expect(callTool).toHaveBeenCalledWith(
      server(),
      "search",
      { q: "water" },
      expect.objectContaining({ settings: { pagination: null, status: null, citation: null }, context }),
    );
    expect(built.records).toHaveLength(1);
    expect(built.records[0]).toMatchObject({ toolName: "search", result: "Water Act", citations: [citation] });
    expect(events.map((event) => event.state)).toEqual(["running", "done"]);
    expect(events[0]).toMatchObject({ toolTitle: "Search legislation", serverLabel: "Legislation" });
  });

  it("tells the model a call failed rather than throwing, and still records it", async () => {
    const { built } = build(vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "timed out"))));

    const answer = await built.tools["Legislation__search"]!.execute!({}, { toolCallId: "t1", messages: [] });

    expect(answer).toBe("The tool call failed: timed out");
    expect(built.records).toHaveLength(1);
  });
});

describe("McpToolPrepass.run", () => {
  const transcriptServer = server({ callTimeoutMs: 20 });

  const makePrepass = () => {
    const client = {
      listTools: vi.fn(),
      callTool: vi.fn(async () => ok(output({ output: "Senators asked about staffing levels." }))),
    } as unknown as IMcpClient;
    const toolCache = {
      listByServer: vi.fn(async () => ok([cached("get_transcript")])),
      replaceForServer: vi.fn(),
    } as unknown as IMcpToolRepository;
    return new McpToolPrepass(
      {} as never,
      { check: vi.fn(async () => ({ data: undefined })) } as never,
      client,
      toolCache,
    );
  };

  const input = {
    model: {} as never,
    provider: "anthropic" as const,
    modelName: "chat-model",
    system: "Look things up.",
    messages: [{ role: "user" as const, content: "What did the hearing cover?" }],
    servers: [transcriptServer],
    allowedToolNamesByServer: { "mcp-1": ["get_transcript"] },
    maxSteps: 1,
  };

  const waitForAbort = (signal?: AbortSignal) =>
    new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));

  it("keeps what the tools returned before the time limit, rather than nothing", async () => {
    vi.mocked(generateText).mockImplementation((async (options: {
      tools: ToolSet;
      onStepFinish?: (step: unknown) => void;
      abortSignal?: AbortSignal;
    }) => {
      const [onlyTool] = Object.values(options.tools);
      await onlyTool.execute?.({ parlViewId: "5976131" }, { toolCallId: "c1", messages: [] });
      options.onStepFinish?.({ usage: { inputTokens: 10, outputTokens: 5 } });
      await waitForAbort(options.abortSignal);
    }) as never);

    const result = await makePrepass().run(input);

    expect(result.error).toBeUndefined();
    expect(result.data?.toolCalls.map((call) => call.result)).toEqual(["Senators asked about staffing levels."]);
    expect(recordTokenUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ promptTokens: 10, completionTokens: 5 }),
    );
  });

  it("bills the whole tool loop from totalUsage, not just the last step", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "done",
      usage: { inputTokens: 1, outputTokens: 1 },
      totalUsage: { inputTokens: 30, outputTokens: 12, cachedInputTokens: 4 },
      providerMetadata: { anthropic: { cacheCreationInputTokens: 7 } },
    } as never);

    await makePrepass().run(input);

    expect(recordTokenUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ promptTokens: 30, completionTokens: 12, cacheReadTokens: 4, cacheWriteTokens: 7 }),
    );
  });

  it("still fails when the time limit passes before any tool returned", async () => {
    vi.mocked(generateText).mockImplementation((async (options: { abortSignal?: AbortSignal }) => {
      await waitForAbort(options.abortSignal);
    }) as never);

    const result = await makePrepass().run(input);

    expect(result.error?.code).toBe("AGENT_FAILED");
  });
});
