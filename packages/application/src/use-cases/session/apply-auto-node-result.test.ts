import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  FlowEdge,
  FlowNode,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  PendingExecutions,
  Session,
} from "@rbrasier/domain";
import { ApplyAutoNodeResult } from "./apply-auto-node-result";

const makeSession = (pendingExecutions: PendingExecutions): Session => ({
  id: "sess-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Buy laptops",
  currentNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const autoNode: FlowNode = {
  id: "node-1",
  flowId: "flow-1",
  type: "auto",
  name: "Vendor lookup",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: {
    instruction: "x",
    executor: "n8n",
    webhookUrl: "https://example.com",
    responseFields: [
      { key: "vendor", label: "Vendor", type: "text", optional: false, raw: "Vendor" },
      { key: "tier", label: "Tier", type: "text", options: ["Gold", "Silver"], optional: false, raw: "Tier" },
    ],
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeSessions = (session: Session) => {
  const updates: Array<Record<string, unknown>> = [];
  const repo = {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(session)),
    listByUser: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn().mockImplementation(async (_id, patch) => {
      updates.push(patch);
      return ok({ ...session, ...patch });
    }),
  } as unknown as ISessionRepository;
  return { repo, updates };
};

const makeNodes = (): IFlowNodeRepository =>
  ({
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(autoNode)),
    listByFlow: vi.fn(),
    update: vi.fn(),
    updatePosition: vi.fn(),
    delete: vi.fn(),
  }) as unknown as IFlowNodeRepository;

const makeEdges = (edges: FlowEdge[]): IFlowEdgeRepository =>
  ({
    create: vi.fn(),
    listByFlow: vi.fn().mockResolvedValue(ok(edges)),
    delete: vi.fn(),
  }) as unknown as IFlowEdgeRepository;

const makeStepOutputs = () => {
  const repo = {
    create: vi.fn().mockResolvedValue(ok({ id: "out-1" })),
    listByFlow: vi.fn(),
  } as unknown as ISessionStepOutputRepository;
  return repo;
};

const edge = (from: string, to: string): FlowEdge => ({
  id: `${from}-${to}`,
  flowId: "flow-1",
  fromNodeId: from,
  toNodeId: to,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const pending = (): PendingExecutions => ({
  "corr-1": { nodeId: "node-1", status: "pending", sentAt: "2026-05-30T10:00:00.000Z" },
});

describe("ApplyAutoNodeResult", () => {
  it("coerces the response, persists a step output, clears the pending entry and advances", async () => {
    const session = makeSession(pending());
    const { repo: sessions, updates } = makeSessions(session);
    const stepOutputs = makeStepOutputs();

    const useCase = new ApplyAutoNodeResult(sessions, makeNodes(), makeEdges([edge("node-1", "node-2")]), stepOutputs);

    const result = await useCase.execute({
      sessionId: "sess-1",
      correlationId: "corr-1",
      nodeId: "node-1",
      status: "completed",
      data: { vendor: "Acme", tier: "gold", extra: "ignored" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.applied).toBe(true);
    expect(result.data?.advanced).toBe(true);

    expect(stepOutputs.create).toHaveBeenCalledWith({
      sessionId: "sess-1",
      flowId: "flow-1",
      nodeId: "node-1",
      messageId: null,
      fields: [
        { key: "vendor", label: "Vendor", type: "text", options: undefined, value: "Acme" },
        { key: "tier", label: "Tier", type: "text", options: ["Gold", "Silver"], value: "Gold" },
      ],
    });

    const advanceUpdate = updates.find((patch) => "currentNodeId" in patch);
    expect(advanceUpdate?.currentNodeId).toBe("node-2");
    expect((advanceUpdate?.pendingExecutions as PendingExecutions)["corr-1"]).toBeUndefined();
  });

  it("completes the session when the auto node has no outgoing edge", async () => {
    const session = makeSession(pending());
    const { repo: sessions, updates } = makeSessions(session);

    const useCase = new ApplyAutoNodeResult(sessions, makeNodes(), makeEdges([]), makeStepOutputs());

    const result = await useCase.execute({
      sessionId: "sess-1",
      correlationId: "corr-1",
      nodeId: "node-1",
      status: "completed",
      data: { vendor: "Acme" },
    });

    expect(result.data?.advanced).toBe(true);
    const statusUpdate = updates.find((patch) => patch.status === "complete");
    expect(statusUpdate).toBeDefined();
  });

  it("invokes the session-complete notifier when the callback completes the session", async () => {
    const session = makeSession(pending());
    const { repo: sessions } = makeSessions(session);
    const notified: Session[] = [];
    const notifier = {
      execute: async (input: { session: Session }) => {
        notified.push(input.session);
        return ok(null);
      },
    };

    const useCase = new ApplyAutoNodeResult(
      sessions,
      makeNodes(),
      makeEdges([]),
      makeStepOutputs(),
      notifier,
    );

    await useCase.execute({
      sessionId: "sess-1",
      correlationId: "corr-1",
      nodeId: "node-1",
      status: "completed",
      data: { vendor: "Acme" },
    });

    expect(notified).toHaveLength(1);
    expect(notified[0]?.status).toBe("complete");
  });

  it("does not invoke the notifier when the callback advances to a next node", async () => {
    const session = makeSession(pending());
    const { repo: sessions } = makeSessions(session);
    const notified: Session[] = [];
    const notifier = {
      execute: async (input: { session: Session }) => {
        notified.push(input.session);
        return ok(null);
      },
    };

    const useCase = new ApplyAutoNodeResult(
      sessions,
      makeNodes(),
      makeEdges([edge("node-1", "node-2")]),
      makeStepOutputs(),
      notifier,
    );

    await useCase.execute({
      sessionId: "sess-1",
      correlationId: "corr-1",
      nodeId: "node-1",
      status: "completed",
      data: { vendor: "Acme" },
    });

    expect(notified).toHaveLength(0);
  });

  it("ignores a callback whose correlation id is not pending (duplicate/stale)", async () => {
    const session = makeSession(pending());
    const { repo: sessions } = makeSessions(session);
    const stepOutputs = makeStepOutputs();

    const useCase = new ApplyAutoNodeResult(sessions, makeNodes(), makeEdges([edge("node-1", "node-2")]), stepOutputs);

    const result = await useCase.execute({
      sessionId: "sess-1",
      correlationId: "unknown-corr",
      nodeId: "node-1",
      status: "completed",
      data: { vendor: "Acme" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.applied).toBe(false);
    expect(stepOutputs.create).not.toHaveBeenCalled();
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it("ignores a callback whose nodeId does not match the pending entry (session moved on)", async () => {
    const session = makeSession(pending());
    const { repo: sessions } = makeSessions(session);
    const stepOutputs = makeStepOutputs();

    const useCase = new ApplyAutoNodeResult(sessions, makeNodes(), makeEdges([]), stepOutputs);

    const result = await useCase.execute({
      sessionId: "sess-1",
      correlationId: "corr-1",
      nodeId: "node-999",
      status: "completed",
      data: {},
    });

    expect(result.data?.applied).toBe(false);
    expect(stepOutputs.create).not.toHaveBeenCalled();
  });

  it("clears the pending entry without advancing on a failed status", async () => {
    const session = makeSession(pending());
    const { repo: sessions, updates } = makeSessions(session);
    const stepOutputs = makeStepOutputs();

    const useCase = new ApplyAutoNodeResult(sessions, makeNodes(), makeEdges([edge("node-1", "node-2")]), stepOutputs);

    const result = await useCase.execute({
      sessionId: "sess-1",
      correlationId: "corr-1",
      nodeId: "node-1",
      status: "failed",
      data: {},
      message: "vendor service unavailable",
    });

    expect(result.data?.applied).toBe(true);
    expect(result.data?.advanced).toBe(false);
    expect(stepOutputs.create).not.toHaveBeenCalled();
    const advanceUpdate = updates.find((patch) => "currentNodeId" in patch);
    expect(advanceUpdate).toBeUndefined();
    const clearUpdate = updates.find((patch) => "pendingExecutions" in patch);
    expect((clearUpdate?.pendingExecutions as PendingExecutions)["corr-1"]).toBeUndefined();
  });

  it("reloads and retries once when a concurrent writer wins the version race", async () => {
    const session = { ...makeSession(pending()), version: 3 };
    const updates: Array<Record<string, unknown>> = [];
    let updateCalls = 0;
    const sessions = {
      create: vi.fn(),
      // Fresh read each attempt returns the (still-pending) session; the second
      // read carries the bumped version the retry writes against.
      findById: vi.fn().mockResolvedValue(ok(session)),
      listByUser: vi.fn(),
      listAll: vi.fn(),
      update: vi.fn().mockImplementation(async (_id, patch) => {
        updates.push(patch);
        updateCalls += 1;
        // First write loses the optimistic-version race, second wins.
        if (updateCalls === 1) return err(domainError("CONFLICT", "modified concurrently"));
        return ok({ ...session, ...patch });
      }),
    } as unknown as ISessionRepository;

    const useCase = new ApplyAutoNodeResult(
      sessions,
      makeNodes(),
      makeEdges([edge("node-1", "node-2")]),
      makeStepOutputs(),
    );

    const result = await useCase.execute({
      sessionId: "sess-1",
      correlationId: "corr-1",
      nodeId: "node-1",
      status: "completed",
      data: { vendor: "Acme" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.advanced).toBe(true);
    expect(updateCalls).toBe(2);
    // Both attempts thread the expected version so the guard can fire.
    expect(updates.every((patch) => "expectedVersion" in patch)).toBe(true);
  });

  it("matches by nodeId when the callback omits a correlation id", async () => {
    const session = makeSession(pending());
    const { repo: sessions } = makeSessions(session);
    const stepOutputs = makeStepOutputs();

    const useCase = new ApplyAutoNodeResult(sessions, makeNodes(), makeEdges([edge("node-1", "node-2")]), stepOutputs);

    const result = await useCase.execute({
      sessionId: "sess-1",
      nodeId: "node-1",
      status: "completed",
      data: { vendor: "Acme" },
    });

    expect(result.data?.applied).toBe(true);
    expect(stepOutputs.create).toHaveBeenCalled();
  });
});
