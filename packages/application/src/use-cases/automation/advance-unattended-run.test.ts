import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type ClaimTurnResult,
  type FlowEdge,
  type FlowNode,
  type FlowNodeType,
  type Result,
  type Session,
  type SessionUpdate,
} from "@wayfinder/domain";
import type { UnattendedIncident } from "../notifications/notify-unattended-incident";
import { AdvanceUnattendedRun, type UnattendedStepRunners } from "./advance-unattended-run";

class InMemorySessions {
  rows = new Map<string, Session>();
  leaseHolder: string | null = null;
  async findById(id: string): Promise<Result<Session | null>> {
    return ok(this.rows.get(id) ?? null);
  }
  async update(id: string, patch: SessionUpdate): Promise<Result<Session>> {
    const row = this.rows.get(id)!;
    const { expectedVersion: _ignored, ...fields } = patch;
    const next = { ...row, ...fields } as Session;
    this.rows.set(id, next);
    return ok(next);
  }
  async claimTurn(id: string, turnId: string): Promise<Result<ClaimTurnResult>> {
    if (this.leaseHolder) return ok({ claimed: false, heldBy: this.leaseHolder });
    this.leaseHolder = turnId;
    return ok({ claimed: true, session: this.rows.get(id)! });
  }
  async releaseTurn(): Promise<Result<void>> {
    this.leaseHolder = null;
    return ok(undefined);
  }
}

const node = (id: string, type: FlowNodeType, name = id): FlowNode => ({
  id,
  flowId: "flow-1",
  type,
  name,
  colour: null,
  positionX: 0,
  positionY: 0,
  config: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const edge = (from: string, to: string): FlowEdge =>
  ({ id: `${from}-${to}`, flowId: "flow-1", fromNodeId: from, toNodeId: to, config: {} }) as FlowEdge;

const runSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "owner-1",
  status: "active",
  title: "Hearing H-1",
  currentNodeId: "ai",
  graphCheckpoint: null,
  pendingExecutions: {},
  origin: "watch",
  runError: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

interface Harness {
  sessions: InMemorySessions;
  incidents: UnattendedIncident[];
  calls: string[];
  completed: string[];
  useCase: AdvanceUnattendedRun;
}

const build = (
  graph: { nodes: FlowNode[]; edges: FlowEdge[] },
  session: Session,
  overrides: Partial<UnattendedStepRunners> = {},
  enabled: (type: FlowNodeType) => boolean = () => true,
): Harness => {
  const sessions = new InMemorySessions();
  sessions.rows.set(session.id, session);
  const incidents: UnattendedIncident[] = [];
  const calls: string[] = [];
  const completed: string[] = [];
  let sequence = 0;
  const steps: UnattendedStepRunners = {
    runAiTask: async ({ node: current }) => {
      calls.push(`ai_task:${current.id}`);
      return ok({ outcome: "accepted", confidence: 90, messageId: "m" });
    },
    runEmail: async ({ node: current }) => {
      calls.push(`email:${current.id}`);
      return ok({ recipients: ["a@b.c"] });
    },
    runAuto: async ({ node: current }) => {
      calls.push(`auto:${current.id}`);
      return ok({ correlationId: "c-1", status: "pending", data: {} });
    },
    runMcp: async ({ node: current }) => {
      calls.push(`mcp:${current.id}`);
      return ok({ correlationId: "c-2", status: "completed", data: {} });
    },
    applyExecutionResult: async (input) => {
      calls.push(`apply:${input.nodeId}`);
      const next = graph.edges.find((candidate) => candidate.fromNodeId === input.nodeId);
      await sessions.update(session.id, { currentNodeId: next?.toNodeId ?? null });
      return ok({ applied: true, advanced: true });
    },
    scheduleNode: async ({ node: current }) => {
      calls.push(`schedule:${current.id}`);
      return ok({ status: "active" } as never);
    },
    requestApproval: async (_session, current) => {
      calls.push(`approval:${current.id}`);
      return ok({ approverAssigned: true });
    },
    prepareConversationalStep: async (_session, current) => {
      calls.push(`prepare:${current.id}`);
    },
    ...overrides,
  };
  const useCase = new AdvanceUnattendedRun({
    sessions,
    flows: { findById: async () => ok({ id: "flow-1", name: "Flow", contextDocs: [] } as never) },
    graph: {
      flowVersions: { getById: async () => ok(null) },
      flowNodes: { listByFlow: async () => ok(graph.nodes) },
      flowEdges: { listByFlow: async () => ok(graph.edges) },
    },
    sessionMessages: { listBySession: async () => ok([]) },
    sessionStepOutputs: { listBySession: async () => ok([]) },
    steps,
    isStepEnabled: async (_userId, type) => enabled(type),
    incidents: {
      execute: async (incident) => {
        incidents.push(incident);
        return ok(null);
      },
    },
    sessionCompleteNotifier: {
      execute: async ({ session: done }) => {
        completed.push(done.id);
        return ok(null);
      },
    },
    newId: () => `id-${(sequence += 1)}`,
    now: () => new Date("2026-10-22T00:00:00.000Z"),
  });
  return { sessions, incidents, calls, completed, useCase };
};

describe("AdvanceUnattendedRun", () => {
  it("chains an AI task into an email and completes the run at the end of the flow", async () => {
    const harness = build(
      { nodes: [node("ai", "ai_task"), node("mail", "email")], edges: [edge("ai", "mail")] },
      runSession(),
    );

    const result = await harness.useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual({ status: "completed" });
    expect(harness.calls).toEqual(["ai_task:ai", "email:mail"]);
    expect(harness.sessions.rows.get("session-1")!.status).toBe("complete");
    expect(harness.completed).toEqual(["session-1"]);
    expect(harness.sessions.leaseHolder).toBeNull();
  });

  it("hands a conversational step to a person, preparing it and alerting the run owner", async () => {
    const harness = build(
      { nodes: [node("ai", "ai_task"), node("talk", "conversational", "Confirm details")], edges: [edge("ai", "talk")] },
      runSession(),
    );

    const result = await harness.useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual({ status: "waiting", nodeId: "talk" });
    expect(harness.calls).toEqual(["ai_task:ai", "prepare:talk"]);
    expect(harness.incidents).toEqual([
      expect.objectContaining({ kind: "awaiting_person", nodeId: "talk", stepName: "Confirm details" }),
    ]);
  });

  it("does not alert anyone when a manual session reaches a conversational step", async () => {
    const harness = build(
      { nodes: [node("ai", "ai_task"), node("talk", "conversational")], edges: [edge("ai", "talk")] },
      runSession({ origin: "manual" }),
    );

    await harness.useCase.execute({ sessionId: "session-1" });

    expect(harness.incidents).toEqual([]);
    expect(harness.calls).toContain("prepare:talk");
  });

  it("waits while an AI task's low-confidence result is with its reviewer", async () => {
    const harness = build(
      { nodes: [node("ai", "ai_task"), node("mail", "email")], edges: [edge("ai", "mail")] },
      runSession(),
      { runAiTask: async () => ok({ outcome: "needs_review", confidence: 40, messageId: "m", approvalId: "a" }) },
    );

    const result = await harness.useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual({ status: "waiting", nodeId: "ai" });
    expect(harness.sessions.rows.get("session-1")!.currentNodeId).toBe("ai");
  });

  it("records the failure, alerts once and stops when a step fails", async () => {
    const harness = build({ nodes: [node("mail", "email", "Send summary")], edges: [] }, runSession({ currentNodeId: "mail" }), {
      runEmail: async () => err(domainError("INFRA_FAILURE", "SMTP refused")),
    });

    const result = await harness.useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual({ status: "failed", nodeId: "mail" });
    expect(harness.sessions.rows.get("session-1")!.runError).toEqual({
      incidentId: "id-2",
      nodeId: "mail",
      code: "INFRA_FAILURE",
      message: "SMTP refused",
      at: "2026-10-22T00:00:00.000Z",
    });
    expect(harness.incidents).toEqual([
      expect.objectContaining({ kind: "run_failed", incidentId: "id-2", stepName: "Send summary", reason: "SMTP refused" }),
    ]);
  });

  it("fails with feature_disabled when a step's flag is off for the run owner", async () => {
    const harness = build({ nodes: [node("mail", "email")], edges: [] }, runSession({ currentNodeId: "mail" }), {}, (type) =>
      type !== "email",
    );

    await harness.useCase.execute({ sessionId: "session-1" });

    expect(harness.sessions.rows.get("session-1")!.runError).toMatchObject({
      code: "feature_disabled",
      message: "Email steps are disabled by an administrator",
    });
    expect(harness.calls).toEqual([]);
  });

  it("parks at a fork for a person to choose the branch, without re-running the step", async () => {
    const harness = build(
      {
        nodes: [node("ai", "ai_task"), node("a", "email"), node("b", "email")],
        edges: [edge("ai", "a"), edge("ai", "b")],
      },
      runSession(),
    );

    const first = await harness.useCase.execute({ sessionId: "session-1" });
    const again = await harness.useCase.execute({ sessionId: "session-1" });

    expect(first.data).toEqual({ status: "waiting", nodeId: "ai" });
    expect(again.data).toEqual({ status: "waiting", nodeId: "ai" });
    expect(harness.calls).toEqual(["ai_task:ai"]);
    expect(harness.sessions.rows.get("session-1")!.awaitingConfirmationNodeId).toBe("ai");
    expect(harness.incidents).toHaveLength(1);
  });

  it("lets a synchronous tool step advance the run itself, then carries on", async () => {
    const harness = build(
      { nodes: [node("tool", "mcp"), node("mail", "email")], edges: [edge("tool", "mail")] },
      runSession({ currentNodeId: "tool" }),
    );

    const result = await harness.useCase.execute({ sessionId: "session-1" });

    expect(harness.calls).toEqual(["mcp:tool", "apply:tool", "email:mail"]);
    expect(result.data).toEqual({ status: "completed" });
  });

  it("waits on an automated step that completes later by callback", async () => {
    const harness = build({ nodes: [node("n8n", "auto")], edges: [] }, runSession({ currentNodeId: "n8n" }));

    const result = await harness.useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual({ status: "waiting", nodeId: "n8n" });
  });

  it("raises an approval step's request and alerts the owner only when no approver could be assigned", async () => {
    const assigned = build({ nodes: [node("sign", "approval")], edges: [] }, runSession({ currentNodeId: "sign" }));
    const unassigned = build({ nodes: [node("sign", "approval")], edges: [] }, runSession({ currentNodeId: "sign" }), {
      requestApproval: async () => ok({ approverAssigned: false }),
    });

    await assigned.useCase.execute({ sessionId: "session-1" });
    await unassigned.useCase.execute({ sessionId: "session-1" });

    expect(assigned.calls).toEqual(["approval:sign"]);
    expect(assigned.incidents).toEqual([]);
    expect(unassigned.incidents).toEqual([expect.objectContaining({ kind: "awaiting_person", nodeId: "sign" })]);
  });

  it("does nothing when another turn holds the session", async () => {
    const harness = build({ nodes: [node("ai", "ai_task")], edges: [] }, runSession());
    harness.sessions.leaseHolder = "someone-else";

    const result = await harness.useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual({ status: "busy" });
    expect(harness.calls).toEqual([]);
  });

  it("runs within a chat turn that already holds the session's lease", async () => {
    const harness = build({ nodes: [node("ai", "ai_task")], edges: [] }, runSession({ origin: "manual" }));
    harness.sessions.leaseHolder = "the-chat-turn";

    const result = await harness.useCase.execute({ sessionId: "session-1", alreadyHoldsLease: true });

    expect(result.data).toEqual({ status: "completed" });
    expect(harness.sessions.leaseHolder).toBe("the-chat-turn");
  });

  it("leaves a failed run alone until it is retried", async () => {
    const harness = build({ nodes: [node("ai", "ai_task")], edges: [] }, runSession({
      runError: { incidentId: "i", nodeId: "ai", code: "x", message: "x", at: "" },
    }));

    const result = await harness.useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual({ status: "failed", nodeId: "ai" });
    expect(harness.calls).toEqual([]);
  });

  it("only resumes an unattended-capable step when asked to resume", async () => {
    const harness = build({ nodes: [node("talk", "conversational")], edges: [] }, runSession({ currentNodeId: "talk" }));

    const result = await harness.useCase.execute({ sessionId: "session-1", resumeOnly: true });

    expect(result.data).toEqual({ status: "waiting", nodeId: "talk" });
    expect(harness.calls).toEqual([]);
    expect(harness.incidents).toEqual([]);
  });

  it("stops a run that loops through unattended steps without end", async () => {
    const harness = build({ nodes: [node("ai", "ai_task")], edges: [edge("ai", "ai")] }, runSession());

    const result = await harness.useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual({ status: "failed", nodeId: "ai" });
    expect(harness.sessions.rows.get("session-1")!.runError?.code).toBe("loop_limit");
    expect(harness.calls).toHaveLength(50);
  });
});
