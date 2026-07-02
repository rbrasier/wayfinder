import { describe, expect, it, vi } from "vitest";
import { err, domainError, ok } from "@rbrasier/domain";
import type {
  FlowNode,
  IMcpClient,
  IMcpServerRepository,
  ISessionRepository,
  McpServer,
  Session,
} from "@rbrasier/domain";
import { ConfirmMcpNode } from "./confirm-mcp-node";

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "sess-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Create ticket",
  currentNodeId: "node-1",
  awaitingConfirmationNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions: {
    "corr-1": {
      nodeId: "node-1",
      status: "awaiting_confirmation",
      sentAt: "2026-06-30T00:00:00.000Z",
      toolName: "create_ticket",
      args: { title: "Broken login" },
    },
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeNode = (config: Record<string, unknown>): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "mcp",
  name: "Create ticket",
  colour: null,
  positionX: 0,
  positionY: 0,
  config,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const actionsServer: McpServer = {
  id: "mcp-1",
  label: "Jira",
  transport: "sse",
  kind: "actions",
  url: "https://mcp.example.com/sse",
  credentialRef: null,
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeSessions = (session: Session): ISessionRepository =>
  ({
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(session)),
    listByUser: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn().mockImplementation(async (_id, patch) => ok({ ...session, ...patch })),
  }) as unknown as ISessionRepository;

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
  callTool: vi.fn().mockResolvedValue(ok({ output: "ticket #42 created" })),
  ...overrides,
});

const config = { instruction: "x", serverId: "mcp-1", allowedToolNames: ["create_ticket"] };

describe("ConfirmMcpNode", () => {
  it("claims the execution and calls the parked tool, returning its output", async () => {
    const session = makeSession();
    const sessions = makeSessions(session);
    const client = makeClient();
    const result = await new ConfirmMcpNode(sessions, makeServers(actionsServer), client).execute({
      session,
      node: makeNode(config),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.correlationId).toBe("corr-1");
    expect(result.data?.status).toBe("completed");
    expect(result.data?.data).toEqual({ output: "ticket #42 created" });
    expect(client.callTool).toHaveBeenCalledWith(actionsServer, "create_ticket", { title: "Broken login" });
    // The awaiting entry is claimed (flipped out of awaiting_confirmation) so a
    // second Proceed is a no-op.
    expect(sessions.update).toHaveBeenCalledWith("sess-1", {
      pendingExecutions: {
        "corr-1": {
          nodeId: "node-1",
          status: "pending",
          sentAt: "2026-06-30T00:00:00.000Z",
          toolName: "create_ticket",
          args: { title: "Broken login" },
        },
      },
    });
  });

  it("runs the operator's edited arguments instead of the parked ones", async () => {
    const client = makeClient();
    await new ConfirmMcpNode(makeSessions(makeSession()), makeServers(actionsServer), client).execute({
      session: makeSession(),
      node: makeNode(config),
      editedArgs: { title: "Login broken on mobile" },
    });

    expect(client.callTool).toHaveBeenCalledWith(actionsServer, "create_ticket", {
      title: "Login broken on mobile",
    });
  });

  it("is idempotent: a second Proceed with no awaiting entry runs no tool", async () => {
    const client = makeClient();
    const result = await new ConfirmMcpNode(
      makeSessions(makeSession({ pendingExecutions: {} })),
      makeServers(actionsServer),
      client,
    ).execute({ session: makeSession({ pendingExecutions: {} }), node: makeNode(config) });

    expect(result.error).toBeUndefined();
    expect(result.data?.alreadyRan).toBe(true);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("propagates a tool-call failure", async () => {
    const client = makeClient({
      callTool: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "unreachable"))),
    });
    const result = await new ConfirmMcpNode(makeSessions(makeSession()), makeServers(actionsServer), client).execute({
      session: makeSession(),
      node: makeNode(config),
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
