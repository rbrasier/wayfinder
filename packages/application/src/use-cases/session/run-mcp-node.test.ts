import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  Flow,
  FlowNode,
  ILanguageModel,
  IMcpClient,
  IMcpServerRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  McpServer,
  Session,
  SessionMessage,
} from "@rbrasier/domain";
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
  credentialRef: null,
  communicatesExternally: false,
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

const makeClient = (overrides: Partial<IMcpClient> = {}): IMcpClient => ({
  listTools: vi.fn().mockResolvedValue(ok([])),
  callTool: vi.fn().mockResolvedValue(ok({ output: "tool says hi" })),
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
  it("resolves fields, records a pending execution, calls the tool, and returns its output", async () => {
    const session = makeSession();
    const sessions = makeSessions(session);
    const client = makeClient();

    const result = await new RunMcpNode(
      sessions,
      makeLanguageModel(),
      makeServers(activeServer),
      client,
      makeStepOutputs(),
      clock,
    ).execute({ session, flow: makeFlow(), node: makeNode(baseConfig), messages: makeMessages(), userId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(result.data?.status).toBe("completed");
    expect(result.data?.data).toEqual({ output: "tool says hi" });
    expect(client.callTool).toHaveBeenCalledWith(activeServer, "search", { query: "X" });
    expect(sessions.update).toHaveBeenCalledWith("sess-1", {
      pendingExecutions: { "corr-1": { nodeId: "node-1", status: "pending", sentAt: "2026-06-30T00:00:00.000Z" } },
    });
  });

  it("fails when no server/tool is configured", async () => {
    const result = await new RunMcpNode(
      makeSessions(makeSession()),
      makeLanguageModel(),
      makeServers(activeServer),
      makeClient(),
      makeStepOutputs(),
      clock,
    ).execute({ session: makeSession(), flow: makeFlow(), node: makeNode({ instruction: "x" }), messages: makeMessages(), userId: "user-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("fails when the referenced server no longer exists", async () => {
    const result = await new RunMcpNode(
      makeSessions(makeSession()),
      makeLanguageModel(),
      makeServers(null),
      makeClient(),
      makeStepOutputs(),
      clock,
    ).execute({ session: makeSession(), flow: makeFlow(), node: makeNode(baseConfig), messages: makeMessages(), userId: "user-1" });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("refuses to call a disabled server", async () => {
    const result = await new RunMcpNode(
      makeSessions(makeSession()),
      makeLanguageModel(),
      makeServers({ ...activeServer, status: "disabled" }),
      makeClient(),
      makeStepOutputs(),
      clock,
    ).execute({ session: makeSession(), flow: makeFlow(), node: makeNode(baseConfig), messages: makeMessages(), userId: "user-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses to call an externally-communicating server", async () => {
    const result = await new RunMcpNode(
      makeSessions(makeSession()),
      makeLanguageModel(),
      makeServers({ ...activeServer, communicatesExternally: true }),
      makeClient(),
      makeStepOutputs(),
      clock,
    ).execute({ session: makeSession(), flow: makeFlow(), node: makeNode(baseConfig), messages: makeMessages(), userId: "user-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("propagates a tool-call failure", async () => {
    const client = makeClient({
      callTool: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "unreachable"))),
    });
    const result = await new RunMcpNode(
      makeSessions(makeSession()),
      makeLanguageModel(),
      makeServers(activeServer),
      client,
      makeStepOutputs(),
      clock,
    ).execute({ session: makeSession(), flow: makeFlow(), node: makeNode(baseConfig), messages: makeMessages(), userId: "user-1" });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
