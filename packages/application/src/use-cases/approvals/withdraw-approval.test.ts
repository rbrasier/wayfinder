import { describe, it, expect } from "vitest";
import {
  type IUnitOfWork,
  type NewApproval,
} from "@wayfinder/domain";
import { WithdrawApproval } from "./withdraw-approval";
import { FakeUnitOfWork, InMemoryApprovals, InMemoryFlowNodes, InMemoryMessages, InMemorySessions, InMemoryStepOutputs, InMemoryUsers, RecordingAuditLogger, RecordingWithdrawnNotifier, approvalNode, session, unitOfWorkFor, user } from "./__fixtures__/approval-doubles";

describe("WithdrawApproval", () => {
  const seedSent = async (
    approvals: InMemoryApprovals,
    overrides: Partial<NewApproval> = {},
  ) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      suggestedApproverUserId: "manager-1",
      approverUserId: "manager-1",
      ...overrides,
    });
    return created.data!;
  };

  // `Prepare instrument (conversational) → Manager review (approval)`, with the
  // conversational step already run — the shape a withdrawal has to return to.
  const withdrawableFlow = async () => {
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

  const withdrawSut = (parts: {
    approvals: InMemoryApprovals;
    sessions: InMemorySessions;
    nodes: InMemoryFlowNodes;
    stepOutputs: InMemoryStepOutputs;
    messages?: InMemoryMessages;
    users?: InMemoryUsers;
    audit?: RecordingAuditLogger;
    unitOfWork?: IUnitOfWork;
  }) =>
    new WithdrawApproval(
      parts.unitOfWork ?? unitOfWorkFor(parts.approvals, parts.sessions),
      parts.approvals,
      parts.sessions,
      parts.stepOutputs,
      parts.audit ?? new RecordingAuditLogger(),
      parts.messages ?? new InMemoryMessages(),
      parts.users ?? new InMemoryUsers(),
      parts.nodes,
    );

  it("records the withdrawal and returns the session to the nearest conversational step", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.returnedToNodeId).toBe("node-prev");
    expect(result.data?.held).toBe(false);
    expect(approvals.rows.get(approval.id)?.status).toBe("withdrawn");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
  });

  it("audits the withdrawal", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const audit = new RecordingAuditLogger();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs, audit });

    await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
      reason: "Figures were stale",
    });

    const entry = audit.entries.find((row) => row.action === "approval.withdrawn");
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe("operator-1");
    expect(entry?.resourceId).toBe(approval.id);
  });

  it("posts the withdrawal into the session thread, naming the step returned to", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const messages = new InMemoryMessages();
    const users = new InMemoryUsers();
    users.add(user("operator-1", "dana@corp.test"));
    users.add(user("manager-1", "rosa@corp.test"));
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs, messages, users });

    await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
      reason: "Figures were stale",
    });

    const posted = messages.rows.at(-1);
    expect(posted?.content).toContain("withdrawn");
    expect(posted?.content).toContain("Prepare instrument");
    expect(posted?.content).toContain("Figures were stale");
    // The originator's own message, not a system aside — matching how a
    // decision is written into the thread.
    expect(posted?.role).toBe("user");
    expect(posted?.senderUserId).toBe("operator-1");
  });

  it("lets an admin withdraw a request they did not raise", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "admin-9",
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
    expect(approvals.rows.get(approval.id)?.status).toBe("withdrawn");
  });

  it("refuses a withdrawal by anyone other than the originator or an admin", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "manager-1",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(approvals.rows.get(approval.id)?.status).toBe("pending");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
  });

  it("refuses to withdraw an approval that has already been decided", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals, { status: "approved" });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
  });

  it("reports NOT_FOUND for an approval that does not exist", async () => {
    const approvals = new InMemoryApprovals();
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: "appr-missing",
      withdrawnByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  // ADR-044 §3: a routing gap holds the session, it never cancels it. An
  // approval with no conversational step before it is exactly that gap.
  it("holds the session on the approval node when no conversational step precedes it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
    const messages = new InMemoryMessages();
    const sut = withdrawSut({
      approvals,
      sessions,
      nodes,
      stepOutputs: new InMemoryStepOutputs(),
      messages,
    });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.held).toBe(true);
    expect(result.data?.returnedToNodeId).toBeNull();
    // The withdrawal still stands, and the session is held rather than cancelled.
    expect(approvals.rows.get(approval.id)?.status).toBe("withdrawn");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
    expect(messages.rows.at(-1)?.content).toContain("no earlier chat step");
  });

  // The status flip and the session move must commit together, or a crash
  // between them leaves a withdrawn row on a session that never moved.
  it("puts the status change and the session move in one transaction", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const unitOfWork = unitOfWorkFor(approvals, sessions);
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs, unitOfWork });

    await sut.execute({ approvalId: approval.id, withdrawnByUserId: "operator-1" });

    expect((unitOfWork as FakeUnitOfWork).transactionCount).toBe(1);
  });

  // A decision landing first wins: `updateIfPending` returns null, the whole
  // transaction fails, and no side effect runs on a row someone else decided.
  it("loses cleanly to a decision that lands first, leaving no trace", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const messages = new InMemoryMessages();
    const audit = new RecordingAuditLogger();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs, messages, audit });

    // The approver decides in the window between the guard read and the write.
    await approvals.update(approval.id, { status: "approved", decidedByUserId: "manager-1" });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(approvals.rows.get(approval.id)?.status).toBe("approved");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
    expect(messages.rows).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
  });

  it("notifies the approver that the request was pulled", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const notifier = new RecordingWithdrawnNotifier();
    const sut = new WithdrawApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      stepOutputs,
      new RecordingAuditLogger(),
      new InMemoryMessages(),
      new InMemoryUsers(),
      nodes,
      notifier,
    );

    await sut.execute({ approvalId: approval.id, withdrawnByUserId: "operator-1" });

    // Fire-and-forget, so let the microtask queue drain before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.approval.id).toBe(approval.id);
  });

  // The row leaves `pending`, so it leaves the approver's queue by the same
  // filter that drops a decided one. Nothing new is needed for that; this
  // guards it against a regression.
  it("drops the request out of the approver's pending queue", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    await sut.execute({ approvalId: approval.id, withdrawnByUserId: "operator-1" });

    const queue = await approvals.listPendingForApprover({
      approverUserId: "manager-1",
      approverEmail: null,
    });
    expect(queue.data).toHaveLength(0);
  });

  // Re-entering the node raises a fresh row rather than reopening the withdrawn
  // one, exactly as ADR-044 §5 specifies for re-approval after changes.
  it("leaves the node free to raise a fresh request", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    await sut.execute({ approvalId: approval.id, withdrawnByUserId: "operator-1" });

    const stillPending = await approvals.findPendingByNode("session-1", "node-appr");
    expect(stillPending.data).toBeNull();
  });
});
