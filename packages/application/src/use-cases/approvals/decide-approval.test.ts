import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  ok,
  type Approval,
  type NewApproval,
  type Result,
} from "@rbrasier/domain";
import { DecideApproval } from "./decide-approval";
import { ResolveApprovalSubject } from "./resolve-approval-subject";
import { FakeUnitOfWork, InMemoryApprovals, InMemoryFlowEdges, InMemoryFlowNodes, InMemoryMessages, InMemorySessions, InMemoryStepOutputs, InMemoryUsers, RecordingAuditLogger, RecordingNotifier, approvalNode, session, unitOfWorkFor, user } from "./__fixtures__/approval-doubles";

describe("DecideApproval", () => {
  const seedConfirmed = async (
    approvals: InMemoryApprovals,
    overrides: Partial<NewApproval> = {},
  ) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
      ...overrides,
    });
    return created.data!;
  };

  it("approves, snapshots, and advances along the single outgoing edge", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const stepOutputs = new InMemoryStepOutputs();
    const audit = new RecordingAuditLogger();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      edges,
      stepOutputs,
      audit,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
      comment: "Looks good",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-next");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-next");
    // Decision projected onto the node's step-output metadata for reporting.
    const projected = stepOutputs.rows.find((row) => row.nodeId === "node-appr");
    expect(projected?.fields.find((f) => f.key === "outcome")?.value).toBe("approved");
  });

  it("commits the approval update and the session advance through one transaction", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const unitOfWork = new FakeUnitOfWork({
      approvals,
      sessions,
      sessionMessages: new InMemoryMessages(),
    });
    const sut = new DecideApproval(
      unitOfWork,
      approvals,
      sessions,
      edges,
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.error).toBeUndefined();
    // Decision and advance are one atomic unit — a single transaction carries both.
    expect(unitOfWork.transactionCount).toBe(1);
    expect(approvals.rows.get(approval.id)?.status).toBe("approved");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-next");
  });

  it("completes the session when the approval node has no outgoing edge", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.data?.sessionCompleted).toBe(true);
    expect(sessions.rows.get("session-1")?.status).toBe("complete");
  });

  const checkpointedSession = () =>
    session({ graphCheckpoint: { currentNodeId: "node-appr", advancedFrom: "node-prev" } });

  it("changes_requested: routes the session back to the previous node and notifies the originator", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const notifier = new RecordingNotifier();
    const { nodes, stepOutputs } = await routableFlow();
    const sut = routingSut({ approvals, sessions, nodes, stepOutputs, notifier });

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "changes_requested",
      comment: "Please revise section 2",
    });

    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
    expect(approvals.rows.get(approval.id)?.comment).toBe("Please revise section 2");
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.routedBack).toBe(true);
    expect(result.data?.advanced).toBe(true);
  });

  // A flow of `Prepare instrument (conversational) → Manager review (approval)`
  // where the conversational step has run — the ordinary shape a change request
  // has to return to.
  const routableFlow = async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
    nodes.add(
      approvalNode({ id: "node-prev", type: "conversational", name: "Prepare instrument" }),
    );
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-prev",
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
    });
    return { nodes, stepOutputs };
  };

  const routingSut = (parts: {
    approvals: InMemoryApprovals;
    sessions: InMemorySessions;
    nodes: InMemoryFlowNodes;
    stepOutputs: InMemoryStepOutputs;
    messages?: InMemoryMessages;
    notifier?: RecordingNotifier;
  }) =>
    new DecideApproval(
      unitOfWorkFor(parts.approvals, parts.sessions),
      parts.approvals,
      parts.sessions,
      new InMemoryFlowEdges(),
      parts.stepOutputs,
      new RecordingAuditLogger(),
      parts.notifier,
      parts.messages ?? new InMemoryMessages(),
      new InMemoryUsers(),
      parts.nodes,
    );

  it("changes_requested: returns to the nearest editable step", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const { nodes, stepOutputs } = await routableFlow();
    const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "changes_requested",
      comment: "Revise",
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-prev");
    expect(result.data?.sessionCompleted).toBe(false);
  });

  it("rejected + routeBack: routes the session back to the nearest editable step", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const { nodes, stepOutputs } = await routableFlow();
    const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: true,
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
  });

  it("rejected + routeBack:false: cancels the session and notifies the originator", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const notifier = new RecordingNotifier();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      notifier,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: false,
    });

    expect(result.data?.advanced).toBe(false);
    expect(result.data?.sessionCompleted).toBe(true);
    expect(sessions.rows.get("session-1")?.status).toBe("cancelled");
    expect(notifier.calls[0]?.routedBack).toBe(false);
  });

  describe("change-request routing", () => {
    it("holds the session when no return target resolves, and never cancels it", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(session({ graphCheckpoint: null }));
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
      const messages = new InMemoryMessages();
      const sut = routingSut({
        approvals,
        sessions,
        nodes,
        stepOutputs: new InMemoryStepOutputs(),
        messages,
      });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.advanced).toBe(false);
      expect(sessions.rows.get("session-1")?.status).toBe("active");
      expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
      const decisionMessage = messages.rows.find((row) => row.role === "user");
      expect(decisionMessage?.content).toContain("no step to return to");
    });

    it("holds rather than cancels when a rejection asks to route back and cannot", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(session({ graphCheckpoint: null }));
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
      const sut = routingSut({
        approvals,
        sessions,
        nodes,
        stepOutputs: new InMemoryStepOutputs(),
      });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "rejected",
        routeBack: true,
      });

      expect(result.data?.sessionCompleted).toBe(false);
      expect(sessions.rows.get("session-1")?.status).toBe("active");
    });

    it("returns to the step the author named, not the nearest editable one", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { stepOutputs } = await routableFlow();
      await stepOutputs.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-intake",
        fields: [],
      });
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-intake", type: "conversational", name: "Gather" }));
      nodes.add(approvalNode({ id: "node-prev", type: "conversational", name: "Prepare" }));
      nodes.add(
        approvalNode({
          id: "node-appr",
          name: "Manager review",
          config: {
            approverSource: "first_level_supervisor",
            changesRequestedTarget: { kind: "step", nodeId: "node-intake" },
          },
        }),
      );
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(result.data?.newNodeId).toBe("node-intake");
    });

    it("holds when the named target has been deleted from the flow", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { stepOutputs } = await routableFlow();
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-prev", type: "conversational", name: "Prepare" }));
      nodes.add(
        approvalNode({
          id: "node-appr",
          name: "Manager review",
          config: {
            approverSource: "first_level_supervisor",
            changesRequestedTarget: { kind: "step", nodeId: "node-deleted" },
          },
        }),
      );
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(result.data?.advanced).toBe(false);
      expect(sessions.rows.get("session-1")?.status).toBe("active");
    });

    it("skips a preceding approval, which has nothing an operator can change", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals, { nodeId: "node-appr-b" });
      const sessions = new InMemorySessions();
      sessions.add(
        session({ graphCheckpoint: { currentNodeId: "node-appr-b", advancedFrom: "node-appr" } }),
      );
      const { nodes, stepOutputs } = await routableFlow();
      nodes.add(approvalNode({ id: "node-appr-b", name: "Finance review" }));
      await stepOutputs.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-appr",
        fields: [{ key: "outcome", label: "Outcome", type: "text", value: "approved" }],
      });
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(result.data?.newNodeId).toBe("node-prev");
    });

    // The build before ADR-044 wrote `advancedFrom: null` on route-back, so
    // `routeBackOrCancel` found no previous node the second time and cancelled
    // the session outright.
    it("routes two change requests in a row, instead of cancelling on the second", async () => {
      const approvals = new InMemoryApprovals();
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { nodes, stepOutputs } = await routableFlow();
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const first = await seedConfirmed(approvals);
      const firstResult = await sut.execute({
        approvalId: first.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      // The operator makes the changes and reaches the approval again, raising a
      // new row — a decided approval is never reopened (ADR-044 §5).
      const second = await seedConfirmed(approvals);
      const secondResult = await sut.execute({
        approvalId: second.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(firstResult.data?.newNodeId).toBe("node-prev");
      expect(secondResult.data?.newNodeId).toBe("node-prev");
      expect(sessions.rows.get("session-1")?.status).toBe("active");
    });

    it("keeps the approval node on the checkpoint rather than blanking it", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { nodes, stepOutputs } = await routableFlow();
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(sessions.rows.get("session-1")?.graphCheckpoint).toEqual({
        currentNodeId: "node-prev",
        advancedFrom: "node-appr",
      });
    });

    it("still cancels on an explicit reject-and-close", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { nodes, stepOutputs } = await routableFlow();
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "rejected",
        routeBack: false,
      });

      expect(result.data?.sessionCompleted).toBe(true);
      expect(sessions.rows.get("session-1")?.status).toBe("cancelled");
    });
  });

  it("rejects a second decision on an already-decided approval", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );
    await sut.execute({ approvalId: approval.id, decidedByUserId: "manager-1", decision: "approved" });

    const second = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
    });

    expect(second.error?.code).toBe("VALIDATION_FAILED");
  });

  it("forbids a decision by anyone other than the confirmed approver", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "intruder-1",
      decision: "approved",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("forbids deciding an email-assigned approval when the decider's email does not match", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, {
      approverUserId: null,
      approverEmail: "manager@corp.test",
    });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const users = new InMemoryUsers();
    users.add(user("intruder-1", "intruder@corp.test"));
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      undefined,
      users,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "intruder-1",
      decision: "approved",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("allows deciding an email-assigned approval when the decider's email matches (case-insensitively)", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, {
      approverUserId: null,
      approverEmail: "manager@corp.test",
    });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const users = new InMemoryUsers();
    users.add(user("manager-1", "Manager@Corp.test"));
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      undefined,
      users,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.sessionCompleted).toBe(true);
  });

  it("lets an admin decide an email-assigned approval regardless of email", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, {
      approverUserId: null,
      approverEmail: "manager@corp.test",
    });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      undefined,
      new InMemoryUsers(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "some-admin",
      decision: "approved",
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
  });

  it("does not run decision side effects when a concurrent decider already won the race", async () => {
    class RaceLostApprovals extends InMemoryApprovals {
      async updateIfPending(): Promise<Result<Approval | null>> {
        return ok(null);
      }
    }
    const approvals = new RaceLostApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const audit = new RecordingAuditLogger();
    const notifier = new RecordingNotifier();
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      edges,
      new InMemoryStepOutputs(),
      audit,
      notifier,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(audit.entries).toHaveLength(0);
    expect(notifier.calls).toHaveLength(0);
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
  });

  it("writes a chat message recording the decision and comment", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
      comment: "Looks good",
    });

    const decisionMessage = messages.rows.find((row) => row.role === "user");
    expect(decisionMessage?.content).toContain("Approval granted.");
    expect(decisionMessage?.content).toContain("Looks good");
    expect(decisionMessage?.stepNodeId).toBe("node-appr");
  });

  // The decision is the approver's, so the thread records it as theirs: it reads
  // as their message rather than the assistant's, and it joins the transcript the
  // model reasons over instead of sitting outside it as a system aside.
  it("attributes the decision message to the approver who made it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const users = new InMemoryUsers();
    users.add({ ...user("manager-1", "rosa.okafor@example.com"), name: "Rosa Okafor" });
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
      users,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    const decisionMessage = messages.rows.find((row) => row.role === "user");
    expect(decisionMessage?.senderUserId).toBe("manager-1");
    expect(decisionMessage?.content).toContain("Rosa Okafor");
    expect(decisionMessage?.content).toContain("rosa.okafor@example.com");
  });

  // No system-role row is written at all, so a decision can never leave a
  // mid-conversation system message for the next turn to hand to the model.
  it("writes no system-role message for a decision", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(messages.rows.filter((row) => row.role === "system")).toHaveLength(0);
  });

  it("records a routed-back message when a rejection routes back to the originator", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session({ graphCheckpoint: { currentNodeId: "node-appr", advancedFrom: "node-prev" } }));
    const messages = new InMemoryMessages();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: true,
      comment: "Not yet",
    });

    const decisionMessage = messages.rows.find((row) => row.role === "user");
    expect(decisionMessage?.content).toContain("routed back to the originator");
  });

  describe("record locked at decision time", () => {
    const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

    const buildRecording = (parts: {
      approvals: InMemoryApprovals;
      sessions: InMemorySessions;
      nodes: InMemoryFlowNodes;
      stepOutputs?: InMemoryStepOutputs;
      messages?: InMemoryMessages;
      users?: InMemoryUsers;
      applySignature?: { execute: (input: { approvalId: string }) => Promise<unknown> };
    }) => {
      const stepOutputs = parts.stepOutputs ?? new InMemoryStepOutputs();
      const messages = parts.messages ?? new InMemoryMessages();
      const users = parts.users ?? new InMemoryUsers();
      const subject = new ResolveApprovalSubject(
        parts.approvals,
        parts.nodes,
        stepOutputs,
        messages,
      );
      return new DecideApproval(
        unitOfWorkFor(parts.approvals, parts.sessions),
        parts.approvals,
        parts.sessions,
        new InMemoryFlowEdges(),
        stepOutputs,
        new RecordingAuditLogger(),
        undefined,
        messages,
        users,
        parts.nodes,
        sha256Hex,
        subject,
        parts.applySignature as never,
      );
    };

    const seedFlow = async () => {
      const approvals = new InMemoryApprovals();
      const sessions = new InMemorySessions();
      sessions.add(session());
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
      nodes.add(approvalNode({ id: "node-draft", type: "conversational", name: "Prepare instrument" }));
      const stepOutputs = new InMemoryStepOutputs();
      await stepOutputs.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-draft",
        fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
      });
      const users = new InMemoryUsers();
      users.add({ ...user("manager-1", "manager@corp.test"), name: "Jane Doe" });
      return { approvals, sessions, nodes, stepOutputs, users };
    };

    it("writes the five guaranteed keys, prefixed by the step key", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
        comment: "Within delegated authority.",
      });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record["manager_review.decision"]).toBe("approved");
      expect(record["manager_review.approver_name"]).toBe("Jane Doe");
      expect(record["manager_review.approver_email"]).toBe("manager@corp.test");
      expect(record["manager_review.decided_at"]).toEqual(expect.any(String));
      expect(record["manager_review.comment"]).toBe("Within delegated authority.");
    });

    it("copies the approver's name and does not re-read it after a rename", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });
      users.add({ ...user("manager-1", "new@corp.test"), name: "Jane Married" });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record["manager_review.approver_name"]).toBe("Jane Doe");
      expect(record["manager_review.approver_email"]).toBe("manager@corp.test");
    });

    it("locks the resolved subject into the record", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record["manager_review.subject_description"]).toContain("Prepare instrument");
      expect(record["manager_review.subject_node_id"]).toBe("node-draft");
    });

    it("does not change the record when the session continues past the approval", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });
      const locked = { ...approvals.rows.get(approval.id)!.recordSnapshot! };

      // The session carries on and the draft step captures a different value.
      await stepOutputs.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-draft",
        fields: [{ key: "amount", label: "Amount", type: "text", value: "$9,999" }],
      });

      expect(approvals.rows.get(approval.id)!.recordSnapshot).toEqual(locked);
    });

    it("gives two approval steps non-colliding key sets", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      nodes.add(approvalNode({ id: "node-appr-2", name: "Finance review" }));
      const first = await seedConfirmed(approvals);
      const second = await seedConfirmed(approvals, { nodeId: "node-appr-2" });
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({ approvalId: first.id, decidedByUserId: "manager-1", decision: "approved" });
      await sut.execute({
        approvalId: second.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      const firstKeys = Object.keys(approvals.rows.get(first.id)!.recordSnapshot!);
      const secondKeys = Object.keys(approvals.rows.get(second.id)!.recordSnapshot!);
      expect(firstKeys).toContain("manager_review.decision");
      expect(secondKeys).toContain("finance_review.decision");
      expect(secondKeys).not.toContain("manager_review.decision");
    });

    it("suffixes the key when two approval steps share a label", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      nodes.add(approvalNode({ id: "node-appr-2", name: "Manager review" }));
      const second = await seedConfirmed(approvals, { nodeId: "node-appr-2" });
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: second.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      expect(approvals.rows.get(second.id)!.recordSnapshot).toHaveProperty(
        "manager_review_2.decision",
      );
    });

    it("records a change request too, so every decision leaves a trail", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
        comment: "Fix the date.",
      });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record["manager_review.decision"]).toBe("changes_requested");
      expect(record["manager_review.comment"]).toBe("Fix the date.");
    });

    describe("projected onto step outputs for the insights report", () => {
      const projected = (stepOutputs: InMemoryStepOutputs, key: string): string | undefined =>
        stepOutputs.rows
          .find((row) => row.nodeId === "node-appr" && row.fields.some((f) => f.key === "outcome"))
          ?.fields.find((f) => f.key === key)?.value;

      it("names the approver rather than projecting their user id", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(projected(stepOutputs, "decided_by")).toBe("Jane Doe");
        expect(projected(stepOutputs, "approver_email")).toBe("manager@corp.test");
      });

      // The subject is still frozen into the record and still shown on every
      // approval surface; what it no longer does is take a report column, where
      // it only restated the step name the column group is already headed by.
      it("projects six fields and no longer says what the approval applies to", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const projection = stepOutputs.rows.find(
          (row) => row.nodeId === "node-appr" && row.fields.some((f) => f.key === "outcome"),
        );
        expect(projection?.fields.map((f) => f.key)).toEqual([
          "outcome",
          "revision",
          "decided_at",
          "decided_by",
          "approver_email",
          "comment",
        ]);
      });

      it("falls back to the approver's email when no name was recorded", async () => {
        const { approvals, sessions, nodes, stepOutputs } = await seedFlow();
        const users = new InMemoryUsers();
        users.add({ ...user("manager-1", "manager@corp.test"), name: null });
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(projected(stepOutputs, "decided_by")).toBe("manager@corp.test");
      });

      // The record's dependencies are optional, so an unwired decision path still
      // has to project something that identifies the decider — a blank cell in a
      // governance report is worse than a raw id.
      it("falls back to the decider's user id when the record carries no identity", async () => {
        const approvals = new InMemoryApprovals();
        const approval = await seedConfirmed(approvals);
        const sessions = new InMemorySessions();
        sessions.add(session());
        const stepOutputs = new InMemoryStepOutputs();
        const sut = new DecideApproval(
          unitOfWorkFor(approvals, sessions),
          approvals,
          sessions,
          new InMemoryFlowEdges(),
          stepOutputs,
          new RecordingAuditLogger(),
        );

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(projected(stepOutputs, "decided_by")).toBe("manager-1");
        expect(projected(stepOutputs, "approver_email")).toBe("");
      });

      // A change request routes work back; re-entering the step raises a fresh
      // request, so one approval step holds several decisions. The report reads
      // the latest projected row, and the revision says how many passes it took.
      it("numbers each pass, so a re-decided step reports its revision", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        const first = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: first.id,
          decidedByUserId: "manager-1",
          decision: "changes_requested",
          comment: "Fix the date.",
        });

        const second = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: second.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const projections = stepOutputs.rows.filter(
          (row) => row.nodeId === "node-appr" && row.fields.some((f) => f.key === "outcome"),
        );
        expect(projections).toHaveLength(2);
        expect(projections[0]!.fields.find((f) => f.key === "revision")?.value).toBe("1");
        expect(projections[0]!.fields.find((f) => f.key === "outcome")?.value).toBe(
          "changes_requested",
        );
        expect(projections[1]!.fields.find((f) => f.key === "revision")?.value).toBe("2");
        expect(projections[1]!.fields.find((f) => f.key === "outcome")?.value).toBe("approved");
      });

      // Nothing caps the count: a step can go back and round as many times as
      // the work needs, and each pass numbers itself.
      it("keeps numbering past a second pass", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        for (const decision of ["changes_requested", "rejected", "changes_requested"] as const) {
          const pass = await seedConfirmed(approvals);
          await sut.execute({ approvalId: pass.id, decidedByUserId: "manager-1", decision });
        }
        const final = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: final.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const revisions = stepOutputs.rows
          .filter((row) => row.nodeId === "node-appr" && row.fields.some((f) => f.key === "outcome"))
          .map((row) => row.fields.find((f) => f.key === "revision")?.value);
        expect(revisions).toEqual(["1", "2", "3", "4"]);

        const latest = stepOutputs.rows
          .filter((row) => row.nodeId === "node-appr" && row.fields.some((f) => f.key === "outcome"))
          .at(-1);
        expect(latest?.fields.find((f) => f.key === "outcome")?.value).toBe("approved");
      });

      it("numbers a first-pass decision as revision 1", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(projected(stepOutputs, "revision")).toBe("1");
      });

      // Two approval steps each count their own passes — a second sign-off on
      // its first pass is revision 1, however many times the first was decided.
      it("counts passes per approval step, not per session", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        nodes.add(approvalNode({ id: "node-appr-2", name: "Finance review" }));
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        const first = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: first.id,
          decidedByUserId: "manager-1",
          decision: "changes_requested",
        });
        const retry = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: retry.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });
        const other = await seedConfirmed(approvals, { nodeId: "node-appr-2" });
        await sut.execute({
          approvalId: other.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const financeProjection = stepOutputs.rows.find(
          (row) => row.nodeId === "node-appr-2" && row.fields.some((f) => f.key === "outcome"),
        );
        expect(financeProjection?.fields.find((f) => f.key === "revision")?.value).toBe("1");
      });

      it("keeps the outcome, timestamp and comment the report already reads", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
          comment: "Within delegated authority.",
        });

        expect(projected(stepOutputs, "outcome")).toBe("approved");
        expect(projected(stepOutputs, "comment")).toBe("Within delegated authority.");
        expect(projected(stepOutputs, "decided_at")).toEqual(expect.any(String));
      });

    });

    it("freezes the attestation block when the node targets a signature slot", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      nodes.add(
        approvalNode({
          id: "node-appr",
          name: "Manager review",
          config: {
            approverSource: "first_level_supervisor",
            signatureFieldKey: "delegate_signature",
          },
        }),
      );
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
        comment: "Signed off.",
      });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record.signatureFieldKey).toBe("delegate_signature");
      expect(record.attestationText).toContain("Jane Doe");
      expect(record.attestationText).toContain("Approved");
      expect(record["manager_review.verification_code"]).toMatch(/^[0-9A-F]{12}$/);
    });

    // Flows authored before v0.26.2 saw no slot dropdown when their template
    // declared exactly one signature, so `signatureFieldKey` was never written
    // and every one of those approvals decided without signing anything. The
    // fallback binds the lone slot so those flows sign without being re-saved.
    const seedSubjectTemplate = (
      nodes: Awaited<ReturnType<typeof seedFlow>>["nodes"],
      signatureKeys: string[],
    ) => {
      nodes.add(
        approvalNode({
          id: "node-draft",
          type: "conversational",
          name: "Prepare instrument",
          config: {
            outputType: "generate_document",
            documentTemplateFields: [
              { key: "amount", label: "Amount", type: "text", optional: false, raw: "Amount" },
              ...signatureKeys.map((key) => ({
                key,
                label: key.replace(/_/g, " "),
                type: "signature",
                optional: true,
                raw: `${key} (approval)`,
              })),
            ],
          },
        }),
      );
    };

    it("signs the lone slot when the node config never named one", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      seedSubjectTemplate(nodes, ["delegate_signature"]);
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record.signatureFieldKey).toBe("delegate_signature");
      expect(record.attestationText).toContain("Jane Doe");
    });

    it("signs nothing rather than guessing when the subject declares several", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      seedSubjectTemplate(nodes, ["delegate_signature", "finance_signature"]);
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      // Writing a named person's attestation into the wrong signature line on a
      // governance document is worse than leaving the document unsigned.
      expect(approvals.rows.get(approval.id)!.recordSnapshot!.signatureFieldKey).toBeUndefined();
    });

    it("keeps an explicit slot in preference to the fallback", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      seedSubjectTemplate(nodes, ["delegate_signature", "finance_signature"]);
      nodes.add(
        approvalNode({
          id: "node-appr",
          name: "Manager review",
          config: {
            approverSource: "first_level_supervisor",
            signatureFieldKey: "finance_signature",
          },
        }),
      );
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      expect(approvals.rows.get(approval.id)!.recordSnapshot!.signatureFieldKey).toBe(
        "finance_signature",
      );
    });

    it("signs nothing when the subject step declares no signature at all", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      seedSubjectTemplate(nodes, []);
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      expect(approvals.rows.get(approval.id)!.recordSnapshot!.signatureFieldKey).toBeUndefined();
    });

    it("triggers the document re-render after the decision commits", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const applied: string[] = [];
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({
        approvals,
        sessions,
        nodes,
        stepOutputs,
        users,
        applySignature: {
          execute: async (input) => {
            applied.push(input.approvalId);
            return ok({ applied: false, reason: "no_signature_slot" });
          },
        },
      });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      expect(applied).toEqual([approval.id]);
    });

    describe("approved_with_edits", () => {
      // A document on the subject step whose edit history the derivation reads.
      const seedEditedDocument = async (
        messages: InMemoryMessages,
        edits: Array<{ editedByUserId: string; editedAt: string; keys: string[] }>,
      ) => {
        await messages.create({
          sessionId: "session-1",
          role: "assistant",
          content: "Here is the draft.",
          stepNodeId: "node-draft",
          document: {
            filename: "instrument.docx",
            storagePath: "generated/session-1/instrument-r1.docx",
            summary: null,
            generatedAt: "2026-08-01T11:00:00.000Z",
            editHistory: edits.map((edit) => ({
              editedAt: edit.editedAt,
              editedByUserId: edit.editedByUserId,
              storagePath: "generated/session-1/instrument-r1.docx",
              changes: edit.keys.map((key) => ({ key, previousValue: "a", newValue: "b" })),
            })),
          },
        });
      };

      const decideWith = async (
        edits: Array<{ editedByUserId: string; editedAt: string; keys: string[] }>,
        decision: "approved" | "rejected" = "approved",
      ) => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const messages = new InMemoryMessages();
        await seedEditedDocument(messages, edits);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users, messages });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision,
          routeBack: true,
        });

        return approvals.rows.get(approval.id)!;
      };

      const laterThanRaise = new Date(Date.now() + 60_000).toISOString();
      const beforeRaise = new Date(Date.now() - 60_000).toISOString();

      // The report reads the projection, not the approval row, so the widened
      // status has to reach both or "approved after the approver changed it"
      // is invisible to the very report it was derived for (ADR-045 §4).
      it("projects the widened status onto the step outputs too", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const messages = new InMemoryMessages();
        await seedEditedDocument(messages, [
          { editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["commencement_date"] },
        ]);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users, messages });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const row = stepOutputs.rows.find(
          (candidate) =>
            candidate.nodeId === "node-appr" &&
            candidate.fields.some((f) => f.key === "outcome"),
        );
        expect(row?.fields.find((f) => f.key === "outcome")?.value).toBe("approved_with_edits");
      });

      it("records approved_with_edits when the approver edited their own subject step", async () => {
        const decided = await decideWith([
          { editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["commencement_date"] },
        ]);

        expect(decided.status).toBe("approved_with_edits");
        expect(decided.recordSnapshot!["manager_review.decision"]).toBe("approved_with_edits");
        expect(decided.recordSnapshot!["manager_review.edits_made"]).toBe(true);
        expect(decided.recordSnapshot!["manager_review.edited_field_keys"]).toEqual([
          "commencement_date",
        ]);
      });

      it("records plain approved when the approver changed nothing", async () => {
        const decided = await decideWith([]);

        expect(decided.status).toBe("approved");
        expect(decided.recordSnapshot!["manager_review.edits_made"]).toBe(false);
      });

      it("does not count the originator's edits", async () => {
        const decided = await decideWith([
          { editedByUserId: "operator-1", editedAt: laterThanRaise, keys: ["amount"] },
        ]);

        expect(decided.status).toBe("approved");
      });

      it("does not count another approver's edits", async () => {
        const decided = await decideWith([
          { editedByUserId: "finance-1", editedAt: laterThanRaise, keys: ["amount"] },
        ]);

        expect(decided.status).toBe("approved");
      });

      it("does not count the same person's edits made before the approval was raised", async () => {
        const decided = await decideWith([
          { editedByUserId: "manager-1", editedAt: beforeRaise, keys: ["amount"] },
        ]);

        expect(decided.status).toBe("approved");
      });

      it("says so in the thread the originator is watching", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const messages = new InMemoryMessages();
        await seedEditedDocument(messages, [
          { editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["amount"] },
        ]);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users, messages });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const decisionMessage = messages.rows.find(
          (row) => row.role === "user" && row.content.includes("Approval granted"),
        );
        expect(decisionMessage?.content).toContain("edits made by the approver");
      });

      it("never widens a rejection", async () => {
        const decided = await decideWith(
          [{ editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["amount"] }],
          "rejected",
        );

        expect(decided.status).toBe("rejected");
      });

      // A regression guard: control flow reads `input.decision`, which keeps its
      // three values, so the widened status must not change advancement at all.
      it("advances the session exactly as a plain approval does", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const messages = new InMemoryMessages();
        await seedEditedDocument(messages, [
          { editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["amount"] },
        ]);
        const edges = new InMemoryFlowEdges();
        edges.rows.push({
          id: "edge-1",
          flowId: "flow-1",
          fromNodeId: "node-appr",
          toNodeId: "node-next",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const sut = new DecideApproval(
          unitOfWorkFor(approvals, sessions),
          approvals,
          sessions,
          edges,
          stepOutputs,
          new RecordingAuditLogger(),
          undefined,
          messages,
          users,
          nodes,
          sha256Hex,
          new ResolveApprovalSubject(approvals, nodes, stepOutputs, messages),
        );

        const result = await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(approvals.rows.get(approval.id)!.status).toBe("approved_with_edits");
        expect(result.data?.advanced).toBe(true);
        expect(result.data?.newNodeId).toBe("node-next");
        expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-next");
      });
    });

    it("keeps the decision when the re-render fails", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({
        approvals,
        sessions,
        nodes,
        stepOutputs,
        users,
        applySignature: {
          execute: async () => {
            throw new Error("object storage unavailable");
          },
        },
      });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      expect(result.error).toBeUndefined();
      expect(approvals.rows.get(approval.id)!.status).toBe("approved");
      expect(approvals.rows.get(approval.id)!.recordSnapshot).toBeTruthy();
    });
  });
});
