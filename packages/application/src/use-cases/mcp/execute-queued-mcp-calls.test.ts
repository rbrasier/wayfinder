import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type {
  CachedMcpTool,
  FlowNode,
  IFlowNodeRepository,
  IMcpCallQueue,
  IMcpClient,
  IMcpServerRepository,
  IMcpToolRepository,
  ISessionEventBus,
  ISessionMessageRepository,
  McpCallJob,
  McpCallOptions,
  McpServer,
  McpToolCallOutput,
  SessionEvent,
} from "@wayfinder/domain";
import { ExecuteQueuedMcpCalls } from "./execute-queued-mcp-calls";

const now = new Date("2026-10-17T10:00:00.000Z");

const job = (overrides: Partial<McpCallJob> = {}): McpCallJob => ({
  id: "job-1",
  sessionId: "sess-1",
  flowId: "flow-1",
  nodeId: "node-1",
  correlationId: "corr-1",
  serverId: "mcp-1",
  toolName: "search_tenders",
  arguments: { query: "roads" },
  actorId: "user-1",
  status: "running",
  attempts: 1,
  lastError: null,
  claimedAt: now,
  finishedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const server: McpServer = {
  id: "mcp-1",
  label: "Tenders",
  transport: "streamable-http",
  url: "https://tenders.example/mcp",
  dataClassification: "public-read",
  verbatimOnly: false,
  callTimeoutMs: 30_000,
  hasCredential: false,
  customHeaderNames: [],
  status: "active",
  createdByUserId: null,
  createdAt: now,
  updatedAt: now,
};

const cachedTool: CachedMcpTool = {
  serverId: "mcp-1",
  name: "search_tenders",
  title: "Search tenders",
  description: null,
  inputSchema: null,
  lastSyncedAt: now,
  pagination: { cursorArgument: "cursor", nextCursorPath: "next_cursor", itemsPath: "items", maxPages: 5 },
  status: null,
  citation: null,
};

const citation = {
  serverId: "mcp-1",
  serverLabel: "Tenders",
  toolName: "search_tenders",
  locator: "T-1",
  title: "Road resurfacing",
  url: "https://tenders.example/T-1",
  recordedAt: null,
};

const output = (overrides: Partial<McpToolCallOutput> = {}): McpToolCallOutput => ({
  output: '{"items":[{"id":"T-1"}]}',
  structuredContent: { items: [{ id: "T-1" }] },
  citations: [citation],
  pagesFetched: 2,
  truncatedAtPageLimit: false,
  sourceStatus: null,
  ...overrides,
});

const node: FlowNode = {
  id: "node-1",
  flowId: "flow-1",
  type: "mcp",
  name: "Find tenders",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: {},
  createdAt: now,
  updatedAt: now,
};

interface Harness {
  useCase: ExecuteQueuedMcpCalls;
  queue: IMcpCallQueue;
  client: IMcpClient;
  applyResult: { execute: ReturnType<typeof vi.fn> };
  messages: ISessionMessageRepository;
  events: SessionEvent[];
}

const build = (options: {
  claimed?: McpCallJob[];
  stale?: McpCallJob[];
  serverRow?: McpServer | null;
  callTool?: IMcpClient["callTool"];
}): Harness => {
  const queue: IMcpCallQueue = {
    enqueue: vi.fn(),
    claimPending: vi.fn().mockResolvedValue(ok(options.claimed ?? [job()])),
    markSucceeded: vi.fn().mockResolvedValue(ok(undefined)),
    markFailed: vi.fn().mockResolvedValue(ok(undefined)),
    listStaleRunning: vi.fn().mockResolvedValue(ok(options.stale ?? [])),
  };
  const servers = {
    findById: vi.fn().mockResolvedValue(ok(options.serverRow === undefined ? server : options.serverRow)),
  } as unknown as IMcpServerRepository;
  const tools = {
    listByServer: vi.fn().mockResolvedValue(ok([cachedTool])),
  } as unknown as IMcpToolRepository;
  const client: IMcpClient = {
    listTools: vi.fn(),
    callTool: options.callTool ?? vi.fn().mockResolvedValue(ok(output())),
  };
  const applyResult = { execute: vi.fn().mockResolvedValue(ok({ applied: true, advanced: true })) };
  const flowNodes = { findById: vi.fn().mockResolvedValue(ok(node)) } as unknown as IFlowNodeRepository;
  const messages = {
    create: vi.fn().mockImplementation(async (input) => ok({ ...input, id: "msg-1", seq: 7 })),
  } as unknown as ISessionMessageRepository;
  const events: SessionEvent[] = [];
  const sessionEvents: ISessionEventBus = {
    publish: vi.fn().mockImplementation(async (_sessionId: string, event: SessionEvent) => {
      events.push(event);
      return ok(undefined);
    }),
    subscribe: vi.fn(),
  };

  const useCase = new ExecuteQueuedMcpCalls({
    queue,
    servers,
    tools,
    client,
    applyResult,
    flowNodes,
    sessionMessages: messages,
    sessionEvents,
    clock: { now: () => new Date() },
  });
  return { useCase, queue, client, applyResult, messages, events };
};

const messageContents = (messages: ISessionMessageRepository): string[] =>
  (messages.create as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].content as string);

describe("ExecuteQueuedMcpCalls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the tool with its settings and applies the result with its citations", async () => {
    const harness = build({});

    const result = await harness.useCase.execute({ limit: 5 });
    await result.data?.completion;

    expect(result.data).toMatchObject({ started: 1, failedStale: 0 });
    expect(harness.queue.claimPending).toHaveBeenCalledWith(5);
    expect(harness.client.callTool).toHaveBeenCalledWith(
      server,
      "search_tenders",
      { query: "roads" },
      expect.objectContaining({
        settings: { pagination: cachedTool.pagination, status: null, citation: null },
        context: { actorId: "user-1", sessionId: "sess-1", flowId: "flow-1", nodeId: "node-1", path: "node" },
      }),
    );
    expect(harness.applyResult.execute).toHaveBeenCalledWith({
      sessionId: "sess-1",
      correlationId: "corr-1",
      nodeId: "node-1",
      status: "completed",
      data: { output: '{"items":[{"id":"T-1"}]}' },
      verbatim: false,
      citations: [citation],
    });
    expect(harness.queue.markSucceeded).toHaveBeenCalledWith("job-1");
    expect(messageContents(harness.messages)).toEqual(["Completed tool step: Find tenders."]);
    expect(harness.events).toContainEqual({ type: "message.created", seq: 7 });
    expect(harness.events).toContainEqual({ type: "session.updated" });
  });

  it("keeps a verbatim-only server's result verbatim", async () => {
    const harness = build({ serverRow: { ...server, verbatimOnly: true } });

    await (await harness.useCase.execute({ limit: 5 })).data?.completion;

    expect(harness.applyResult.execute).toHaveBeenCalledWith(expect.objectContaining({ verbatim: true }));
  });

  it("publishes progress at the start, on each page, every 5 seconds and at the end", async () => {
    let finish: (value: Awaited<ReturnType<IMcpClient["callTool"]>>) => void = () => undefined;
    const callTool = vi.fn().mockImplementation(
      (_server: McpServer, _name: string, _args: Record<string, unknown>, options?: McpCallOptions) => {
        options?.onPage?.(1);
        return new Promise((resolve) => {
          finish = resolve;
          setTimeout(() => options?.onPage?.(2), 7_000);
        });
      },
    );
    const harness = build({ callTool });

    const started = await harness.useCase.execute({ limit: 5 });
    await vi.advanceTimersByTimeAsync(11_000);
    finish(ok(output()));
    await started.data?.completion;

    const progress = harness.events.filter((event) => event.type === "tool.progress");
    expect(progress.map((event) => event.type === "tool.progress" && [event.state, event.page, event.elapsedMs])).toEqual([
      ["running", 1, 0],
      ["running", 1, 5_000],
      ["running", 2, 7_000],
      ["running", 2, 10_000],
      ["done", 2, 11_000],
    ]);
    expect(progress[0]).toMatchObject({ callId: "job-1", toolTitle: "Search tenders", serverLabel: "Tenders" });
  });

  it("names a no-data source in the completion message", async () => {
    const harness = build({
      callTool: vi.fn().mockResolvedValue(
        ok(output({ sourceStatus: { kind: "no-data", raw: "no_data", caveats: [], confidence: 1 } })),
      ),
    });

    await (await harness.useCase.execute({ limit: 5 })).data?.completion;

    expect(harness.applyResult.execute).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(messageContents(harness.messages)).toEqual([
      "Completed tool step: Find tenders. The source reported no data.",
    ]);
  });

  it("fails the step when the source reports itself unavailable", async () => {
    const harness = build({
      callTool: vi.fn().mockResolvedValue(
        ok(
          output({
            sourceStatus: { kind: "source-unavailable", raw: "down", caveats: [], confidence: 0 },
          }),
        ),
      ),
    });

    await (await harness.useCase.execute({ limit: 5 })).data?.completion;

    expect(harness.applyResult.execute).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", correlationId: "corr-1" }),
    );
    expect(harness.queue.markFailed).toHaveBeenCalledWith("job-1", "the source is unavailable");
    expect(messageContents(harness.messages)).toEqual([
      "This tool step (Find tenders) could not run: the source is unavailable.",
    ]);
  });

  it("fails the step and clears the pending execution when the call errors or times out", async () => {
    const harness = build({
      callTool: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "MCP operation timed out after 30000ms"))),
    });

    await (await harness.useCase.execute({ limit: 5 })).data?.completion;

    expect(harness.applyResult.execute).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(harness.queue.markFailed).toHaveBeenCalledWith("job-1", "MCP operation timed out after 30000ms");
    const progress = harness.events.filter((event) => event.type === "tool.progress");
    expect(progress.at(-1)).toMatchObject({ state: "done" });
  });

  it("fails a call whose server was disabled or reclassified while it waited, without calling it", async () => {
    for (const serverRow of [
      { ...server, status: "disabled" as const },
      { ...server, dataClassification: "external-write" as const },
      null,
    ]) {
      const harness = build({ serverRow });

      await (await harness.useCase.execute({ limit: 5 })).data?.completion;

      expect(harness.client.callTool).not.toHaveBeenCalled();
      expect(harness.applyResult.execute).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
      expect(harness.queue.markFailed).toHaveBeenCalled();
    }
  });

  it("fails calls a dead worker left running", async () => {
    const harness = build({ claimed: [], stale: [job({ id: "job-stale" })] });

    const result = await harness.useCase.execute({ limit: 5 });

    expect(result.data).toMatchObject({ started: 0, failedStale: 1 });
    expect(harness.queue.listStaleRunning).toHaveBeenCalledWith(new Date(now.getTime() - 660_000));
    expect(harness.queue.markFailed).toHaveBeenCalledWith("job-stale", "the call did not finish");
    expect(harness.applyResult.execute).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("claims nothing when the worker has no room", async () => {
    const harness = build({});

    const result = await harness.useCase.execute({ limit: 0 });

    expect(result.data).toMatchObject({ started: 0 });
    expect(harness.queue.claimPending).not.toHaveBeenCalled();
  });

  it("surfaces a queue failure", async () => {
    const harness = build({});
    (harness.queue.claimPending as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(domainError("INFRA_FAILURE", "db down")),
    );

    const result = await harness.useCase.execute({ limit: 5 });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
