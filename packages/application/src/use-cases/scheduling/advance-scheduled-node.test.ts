import { describe, expect, it } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  FlowEdge,
  IFlowEdgeRepository,
  ISessionRepository,
  Session,
  SessionUpdate,
} from "@rbrasier/domain";
import { AdvanceScheduledNode } from "./advance-scheduled-node";

const makeSession = (overrides: Partial<Session> = {}): Session =>
  ({
    id: "sess-1",
    flowId: "flow-1",
    userId: "user-1",
    status: "active",
    title: null,
    currentNodeId: "node-sched",
    graphCheckpoint: null,
    pendingExecutions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Session;

const edge = (fromNodeId: string, toNodeId: string): FlowEdge =>
  ({ id: `${fromNodeId}->${toNodeId}`, flowId: "flow-1", fromNodeId, toNodeId } as FlowEdge);

const makeRepos = (session: Session | null, edges: FlowEdge[]) => {
  const updates: SessionUpdate[] = [];
  const sessions: ISessionRepository = {
    findById: async () => ok(session),
    update: async (_id, patch) => {
      updates.push(patch);
      return ok(makeSession({ ...(session ?? {}), ...patch } as Partial<Session>));
    },
  } as unknown as ISessionRepository;
  const flowEdges: IFlowEdgeRepository = {
    listByFlow: async () => ok(edges),
  } as unknown as IFlowEdgeRepository;
  return { sessions, flowEdges, updates };
};

describe("AdvanceScheduledNode", () => {
  it("advances along the single outgoing edge", async () => {
    const { sessions, flowEdges, updates } = makeRepos(makeSession(), [edge("node-sched", "node-next")]);
    const useCase = new AdvanceScheduledNode(sessions, flowEdges);

    const result = await useCase.execute({ sessionId: "sess-1", scheduledNodeId: "node-sched" });

    expect(result.data?.status).toBe("advanced");
    expect(result.data?.newNodeId).toBe("node-next");
    expect(updates[0]).toMatchObject({ currentNodeId: "node-next" });
  });

  it("completes the session when there are no outgoing edges", async () => {
    const { sessions, flowEdges, updates } = makeRepos(makeSession(), []);
    const useCase = new AdvanceScheduledNode(sessions, flowEdges);

    const result = await useCase.execute({ sessionId: "sess-1", scheduledNodeId: "node-sched" });

    expect(result.data?.status).toBe("completed");
    expect(updates[0]).toMatchObject({ status: "complete" });
  });

  it("reports needs_branch_choice at a fork when no choice is supplied", async () => {
    const { sessions, flowEdges, updates } = makeRepos(makeSession(), [
      edge("node-sched", "node-a"),
      edge("node-sched", "node-b"),
    ]);
    const useCase = new AdvanceScheduledNode(sessions, flowEdges);

    const result = await useCase.execute({ sessionId: "sess-1", scheduledNodeId: "node-sched" });

    expect(result.data?.status).toBe("needs_branch_choice");
    expect(result.data?.branchNodeIds.sort()).toEqual(["node-a", "node-b"]);
    expect(updates).toHaveLength(0);
  });

  it("advances to the chosen branch when a valid choice is supplied", async () => {
    const { sessions, flowEdges, updates } = makeRepos(makeSession(), [
      edge("node-sched", "node-a"),
      edge("node-sched", "node-b"),
    ]);
    const useCase = new AdvanceScheduledNode(sessions, flowEdges);

    const result = await useCase.execute({
      sessionId: "sess-1",
      scheduledNodeId: "node-sched",
      branchChoice: "node-b",
    });

    expect(result.data?.status).toBe("advanced");
    expect(result.data?.newNodeId).toBe("node-b");
    expect(updates[0]).toMatchObject({ currentNodeId: "node-b" });
  });

  it("treats an invalid branch choice as needs_branch_choice", async () => {
    const { sessions, flowEdges } = makeRepos(makeSession(), [
      edge("node-sched", "node-a"),
      edge("node-sched", "node-b"),
    ]);
    const useCase = new AdvanceScheduledNode(sessions, flowEdges);

    const result = await useCase.execute({
      sessionId: "sess-1",
      scheduledNodeId: "node-sched",
      branchChoice: "node-z",
    });

    expect(result.data?.status).toBe("needs_branch_choice");
  });

  it("is a no-op (stale) when the session has moved off the scheduled node", async () => {
    const { sessions, flowEdges, updates } = makeRepos(
      makeSession({ currentNodeId: "node-other" }),
      [edge("node-sched", "node-next")],
    );
    const useCase = new AdvanceScheduledNode(sessions, flowEdges);

    const result = await useCase.execute({ sessionId: "sess-1", scheduledNodeId: "node-sched" });

    expect(result.data?.status).toBe("stale");
    expect(updates).toHaveLength(0);
  });

  it("is a no-op (stale) when the session is no longer active", async () => {
    const { sessions, flowEdges } = makeRepos(makeSession({ status: "complete" }), [
      edge("node-sched", "node-next"),
    ]);
    const useCase = new AdvanceScheduledNode(sessions, flowEdges);

    const result = await useCase.execute({ sessionId: "sess-1", scheduledNodeId: "node-sched" });

    expect(result.data?.status).toBe("stale");
  });

  it("is a no-op (stale) when the session is missing", async () => {
    const { sessions, flowEdges } = makeRepos(null, []);
    const useCase = new AdvanceScheduledNode(sessions, flowEdges);

    const result = await useCase.execute({ sessionId: "sess-1", scheduledNodeId: "node-sched" });

    expect(result.data?.status).toBe("stale");
  });
});
