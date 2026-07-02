import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  FlowNode,
  IMcpClient,
  IMcpServerRepository,
  ISessionRepository,
  McpServer,
  Session,
} from "@rbrasier/domain";
import { RunMcpNode } from "./run-mcp-node";

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

const makeSessions = (session: Session): ISessionRepository =>
  ({
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(session)),
    listByUser: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn().mockImplementation(async (_id, patch) => ok({ ...session, ...patch })),
  }) as unknown as ISessionRepository;

const activeServer: McpServer = {
  id: "mcp-1",
  label: "Search",
  transport: "sse",
  kind: "actions",
  url: "https://mcp.example.com/sse",
  credentialRef: null,
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

const baseConfig = { instruction: "Search.", serverId: "mcp-1", allowedToolNames: ["search"] };
const clock = { generateCorrelationId: () => "corr-1", now: () => new Date("2026-06-30T00:00:00.000Z") };

describe("RunMcpNode", () => {
  it("records a pending execution, calls the planned tool, and returns its output", async () => {
    const session = makeSession();
    const sessions = makeSessions(session);
    const client = makeClient();

    const result = await new RunMcpNode(sessions, makeServers(activeServer), client, clock).execute({
      session,
      node: makeNode(baseConfig),
      toolName: "search",
      args: { query: "X" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.status).toBe("completed");
    expect(result.data?.data).toEqual({ output: "tool says hi" });
    expect(client.callTool).toHaveBeenCalledWith(activeServer, "search", { query: "X" });
    expect(sessions.update).toHaveBeenCalledWith("sess-1", {
      pendingExecutions: {
        "corr-1": {
          nodeId: "node-1",
          status: "pending",
          sentAt: "2026-06-30T00:00:00.000Z",
          toolName: "search",
          args: { query: "X" },
        },
      },
    });
  });

  it("fails when no server is configured", async () => {
    const result = await new RunMcpNode(makeSessions(makeSession()), makeServers(activeServer), makeClient(), clock).execute({
      session: makeSession(),
      node: makeNode({ instruction: "x" }),
      toolName: "search",
      args: {},
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("fails when the referenced server no longer exists", async () => {
    const result = await new RunMcpNode(makeSessions(makeSession()), makeServers(null), makeClient(), clock).execute({
      session: makeSession(),
      node: makeNode(baseConfig),
      toolName: "search",
      args: {},
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("refuses to call a disabled server", async () => {
    const result = await new RunMcpNode(
      makeSessions(makeSession()),
      makeServers({ ...activeServer, status: "disabled" }),
      makeClient(),
      clock,
    ).execute({ session: makeSession(), node: makeNode(baseConfig), toolName: "search", args: {} });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("propagates a tool-call failure", async () => {
    const client = makeClient({
      callTool: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "unreachable"))),
    });
    const result = await new RunMcpNode(makeSessions(makeSession()), makeServers(activeServer), client, clock).execute({
      session: makeSession(),
      node: makeNode(baseConfig),
      toolName: "search",
      args: {},
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
