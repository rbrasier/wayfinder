import { describe, expect, it } from "vitest";
import { DecideApproval } from "./decide-approval";
import {
  InMemoryApprovals,
  InMemoryFlowEdges,
  InMemorySessions,
  InMemoryStepOutputs,
  RecordingAuditLogger,
  session,
  unitOfWorkFor,
} from "./__fixtures__/approval-doubles";

describe("DecideApproval on an AI task review", () => {
  // An AI task's low-confidence review is an ordinary approval raised on the AI
  // task node itself, so accepting it moves the run past that step (ADR-065 §3).
  it("advances past an AI task when its review is approved", async () => {
    const approvals = new InMemoryApprovals();
    const approval = (
      await approvals.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-ai",
        requestedByUserId: "run-owner-1",
        approverSource: "run_owner",
        approverUserId: "run-owner-1",
      })
    ).data!;
    const sessions = new InMemorySessions();
    sessions.add(session({ userId: "run-owner-1", currentNodeId: "node-ai" }));
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-ai",
      flowId: "flow-1",
      fromNodeId: "node-ai",
      toNodeId: "node-email",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      edges,
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "run-owner-1",
      decision: "approved",
    });

    expect(result.data?.newNodeId).toBe("node-email");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-email");
  });

});
