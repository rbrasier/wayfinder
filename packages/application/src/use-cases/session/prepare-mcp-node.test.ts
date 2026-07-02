import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import type {
  FlowNode,
  IMcpServerRepository,
  ISessionRepository,
  McpServer,
  Session,
} from "@rbrasier/domain";
import { PrepareMcpNode } from "./prepare-mcp-node";

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "sess-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Create ticket",
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
  name: "Create ticket",
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

const makeServers = (server: McpServer | null): IMcpServerRepository =>
  ({
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(server)),
    list: vi.fn(),
    setStatus: vi.fn(),
  }) as unknown as IMcpServerRepository;

const baseConfig = { instruction: "Create a ticket.", serverId: "mcp-1", allowedToolNames: ["create_ticket"] };
const clock = { generateCorrelationId: () => "corr-1", now: () => new Date("2026-06-30T00:00:00.000Z") };

describe("PrepareMcpNode", () => {
  it("parks the planned tool call as an awaiting_confirmation execution without calling any tool", async () => {
    const session = makeSession();
    const sessions = makeSessions(session);

    const result = await new PrepareMcpNode(sessions, makeServers(actionsServer), clock).execute({
      session,
      node: makeNode(baseConfig),
      toolName: "create_ticket",
      args: { title: "Broken login" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.toolName).toBe("create_ticket");
    expect(result.data?.serverLabel).toBe("Jira");
    expect(result.data?.args).toEqual({ title: "Broken login" });
    expect(sessions.update).toHaveBeenCalledWith("sess-1", {
      awaitingConfirmationNodeId: "node-1",
      pendingExecutions: {
        "corr-1": {
          nodeId: "node-1",
          status: "awaiting_confirmation",
          sentAt: "2026-06-30T00:00:00.000Z",
          toolName: "create_ticket",
          args: { title: "Broken login" },
        },
      },
    });
  });

  it("fails when no server is configured", async () => {
    const result = await new PrepareMcpNode(makeSessions(makeSession()), makeServers(actionsServer), clock).execute({
      session: makeSession(),
      node: makeNode({ instruction: "x" }),
      toolName: "create_ticket",
      args: {},
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a disabled server", async () => {
    const result = await new PrepareMcpNode(
      makeSessions(makeSession()),
      makeServers({ ...actionsServer, status: "disabled" }),
      clock,
    ).execute({ session: makeSession(), node: makeNode(baseConfig), toolName: "create_ticket", args: {} });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
