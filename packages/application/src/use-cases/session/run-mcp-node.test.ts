import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@wayfinder/domain";
import type {
  Flow,
  FlowNode,
  ILanguageModel,
  IMcpCallQueue,
  IMcpServerRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  McpCallJob,
  McpServer,
  NewMcpCallJob,
  Session,
  SessionMessage,
} from "@wayfinder/domain";
import { RunMcpNode } from "./run-mcp-node";

const usage = {
  promptTokens: 1,
  completionTokens: 1,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "sess-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Lookup",
  currentNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeFlow = (): Flow => ({
  id: "flow-1",
  name: "Flow",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "user-1",
  status: "published",
  visibility: { kind: "private" },
  permissions: [],
  contextDocs: [],
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeNode = (config: Record<string, unknown>): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "mcp",
  name: "Search the web",
  colour: null,
  positionX: 0,
  positionY: 0,
  config,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeMessages = (): SessionMessage[] => [
  { id: "m1", sessionId: "sess-1", role: "user", content: "find X", confidence: null, stepNodeId: "node-1", document: null, createdAt: new Date() },
];

const makeSessions = (session: Session): ISessionRepository =>
  ({
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(session)),
    listByUser: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn().mockImplementation(async (_id, patch) => ok({ ...session, ...patch })),
  }) as unknown as ISessionRepository;

const makeLanguageModel = (): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(ok({ object: { query: "X" }, usage })),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

const makeStepOutputs = (): ISessionStepOutputRepository =>
  ({
    create: vi.fn(),
    listByFlow: vi.fn().mockResolvedValue(ok([])),
    listBySession: vi.fn().mockResolvedValue(ok([])),
  }) as unknown as ISessionStepOutputRepository;

const activeServer: McpServer = {
  id: "mcp-1",
  label: "Search",
  transport: "sse",
  url: "https://mcp.example.com/sse",
  dataClassification: "internal",
  verbatimOnly: false,
  callTimeoutMs: 30_000,
  hasCredential: false,
  customHeaderNames: [],
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeServers = (server: McpServer | null): IMcpServerRepository =>
  ({
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(server)),
    list: vi.fn(),
    setStatus: vi.fn(),
  }) as unknown as IMcpServerRepository;

const makeQueue = (overrides: Partial<IMcpCallQueue> = {}): IMcpCallQueue => ({
  enqueue: vi.fn().mockImplementation(async (job: NewMcpCallJob) =>
    ok({
      ...job,
      id: "job-1",
      status: "pending",
      attempts: 0,
      lastError: null,
      claimedAt: null,
      finishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies McpCallJob),
  ),
  claimPending: vi.fn(),
  markSucceeded: vi.fn(),
  markFailed: vi.fn(),
  listStaleRunning: vi.fn(),
  ...overrides,
});

const baseConfig = {
  instruction: "Search for the requested topic.",
  serverId: "mcp-1",
  toolName: "search",
  requestFields: [{ key: "query", label: "Query", type: "text", optional: false, raw: "Query" }],
  responseFields: [{ key: "output", label: "Output", type: "text", optional: false, raw: "Output" }],
};

const clock = { generateCorrelationId: () => "corr-1", now: () => new Date("2026-06-30T00:00:00.000Z") };

describe("RunMcpNode", () => {
  const run = (options: {
    session?: Session;
    sessions?: ISessionRepository;
    server?: McpServer | null;
    queue?: IMcpCallQueue;
    config?: Record<string, unknown>;
  }) => {
    const session = options.session ?? makeSession();
    return new RunMcpNode(
      options.sessions ?? makeSessions(session),
      makeLanguageModel(),
      makeServers(options.server === undefined ? activeServer : options.server),
      options.queue ?? makeQueue(),
      makeStepOutputs(),
      clock,
    ).execute({
      session,
      flow: makeFlow(),
      node: makeNode(options.config ?? baseConfig),
      messages: makeMessages(),
      userId: "user-1",
    });
  };

  it("resolves fields, records a pending execution and queues the call without making it", async () => {
    const session = makeSession();
    const sessions = makeSessions(session);
    const queue = makeQueue();

    const result = await run({ session, sessions, queue });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ correlationId: "corr-1", jobId: "job-1", status: "pending" });
    expect(sessions.update).toHaveBeenCalledWith("sess-1", {
      pendingExecutions: { "corr-1": { nodeId: "node-1", status: "pending", sentAt: "2026-06-30T00:00:00.000Z" } },
    });
    expect(queue.enqueue).toHaveBeenCalledWith({
      sessionId: "sess-1",
      flowId: "flow-1",
      nodeId: "node-1",
      correlationId: "corr-1",
      serverId: "mcp-1",
      toolName: "search",
      arguments: { query: "X" },
      actorId: "user-1",
    });
  });

  it("queues a call to a public-data reader", async () => {
    const result = await run({ server: { ...activeServer, dataClassification: "public-read" } });

    expect(result.data?.status).toBe("pending");
  });

  it("fails when no server/tool is configured", async () => {
    const result = await run({ config: { instruction: "x" } });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("fails when the referenced server no longer exists", async () => {
    const result = await run({ server: null });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("refuses to queue a call to a disabled server", async () => {
    const queue = makeQueue();
    const result = await run({ server: { ...activeServer, status: "disabled" }, queue });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("refuses to queue a call to a server that sends records out", async () => {
    const queue = makeQueue();
    const result = await run({ server: { ...activeServer, dataClassification: "external-write" }, queue });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a verbatim-only server whose step is configured to reshape the result", async () => {
    const queue = makeQueue();
    const config = {
      ...baseConfig,
      responseFields: [{ key: "rate", label: "Rate", type: "currency", optional: false, raw: "Rate" }],
    };

    const result = await run({ server: { ...activeServer, verbatimOnly: true }, queue, config });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("rate");
    // Refused before the call is queued — nothing is called and nothing pends.
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("clears the pending execution when the call cannot be queued", async () => {
    // A stateful sessions repo so the cleanup's re-read sees the recorded entry.
    let current = makeSession();
    const sessions = {
      create: vi.fn(),
      findById: vi.fn().mockImplementation(async () => ok(current)),
      listByUser: vi.fn(),
      listAll: vi.fn(),
      update: vi.fn().mockImplementation(async (_id, patch) => {
        current = { ...current, ...patch };
        return ok(current);
      }),
    } as unknown as ISessionRepository;
    const queue = makeQueue({
      enqueue: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "queue down"))),
    });

    const result = await run({ session: current, sessions, queue });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(current.pendingExecutions).toEqual({});
  });
});
