import { describe, it, expect } from "vitest";
import {
  type NewApproval,
} from "@wayfinder/domain";
import { ReassignApproval } from "./reassign-approval";
import { InMemoryApprovals, InMemoryMessages, InMemorySessions, InMemoryUsers, RecordingAuditLogger, RecordingReassignedNotifier, RecordingRequestedNotifier, session, user } from "./__fixtures__/approval-doubles";

describe("ReassignApproval", () => {
  // The chained shape this exists for: the row for the second approval is
  // raised by the *first approver*, who nominates the next signer from their
  // decision modal (ADR-018, v0.22.2). So `requestedByUserId` is them, not the
  // chat's author — and the author is the one who needs to move it.
  const seedChained = async (
    approvals: InMemoryApprovals,
    overrides: Partial<NewApproval> = {},
  ) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "approver-a",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
      requestMessage: "Board meets Thursday.",
      ...overrides,
    });
    return created.data!;
  };

  const reassignSut = (parts: {
    approvals: InMemoryApprovals;
    sessions: InMemorySessions;
    users?: InMemoryUsers;
    messages?: InMemoryMessages;
    audit?: RecordingAuditLogger;
    reassigned?: RecordingReassignedNotifier;
    requested?: RecordingRequestedNotifier;
  }) =>
    new ReassignApproval(
      parts.approvals,
      parts.sessions,
      parts.audit ?? new RecordingAuditLogger(),
      parts.messages ?? new InMemoryMessages(),
      parts.users ?? new InMemoryUsers(),
      parts.reassigned,
      parts.requested,
    );

  const withUsers = () => {
    const users = new InMemoryUsers();
    users.add(user("operator-1", "dana@corp.test"));
    users.add(user("manager-1", "rosa@corp.test"));
    users.add(user("manager-2", "sam@corp.test"));
    users.add(user("approver-a", "alex@corp.test"));
    return users;
  };

  it("moves an open request to a new approver at the session owner's request", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.approval.approverUserId).toBe("manager-2");
    expect(result.data?.previousApproverUserId).toBe("manager-1");
    // Still open, and still on the same node — reassigning is not a withdrawal.
    expect(approvals.rows.get(approval.id)?.status).toBe("pending");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
  });

  it("accepts a free-typed address and records the override", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverEmail: "external@partner.test",
      isOverride: true,
    });

    expect(result.data?.approval.approverEmail).toBe("external@partner.test");
    expect(result.data?.approval.approverUserId).toBeNull();
    expect(result.data?.approval.isOverride).toBe(true);
  });

  it("lets an admin reassign a session they do not own", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "admin-9",
      approverUserId: "manager-2",
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
    expect(approvals.rows.get(approval.id)?.approverUserId).toBe("manager-2");
  });

  // Gated on the session owner, not the requester: on a chained row the
  // requester is the previous approver, and the person who needs this is the
  // one watching the chat.
  it("refuses a reassignment by someone who neither owns the session nor is an admin", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "manager-1",
      approverUserId: "manager-2",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(approvals.rows.get(approval.id)?.approverUserId).toBe("manager-1");
  });

  it("refuses to reassign an approval that has already been decided", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals, { status: "approved" });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a reassignment with no approver chosen", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("reports NOT_FOUND for an approval that does not exist", async () => {
    const approvals = new InMemoryApprovals();
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: "appr-missing",
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  // The audit answer to the question that put in-place reassignment out of
  // scope in v0.25.0: the trail names who moved it, from whom, to whom.
  it("audits the move with both approver identities", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const audit = new RecordingAuditLogger();
    const sut = reassignSut({ approvals, sessions, users: withUsers(), audit });

    await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    const entry = audit.entries.find((row) => row.action === "approval.reassigned");
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe("operator-1");
    expect(entry?.metadata).toMatchObject({
      previousApproverUserId: "manager-1",
      approverUserId: "manager-2",
    });
  });

  it("announces the move in the session thread", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const sut = reassignSut({ approvals, sessions, users: withUsers(), messages });

    await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    const posted = messages.rows.at(-1);
    expect(posted?.content).toContain("reassigned");
    expect(posted?.content).toContain("sam@corp.test");
    expect(posted?.content).toContain("rosa@corp.test");
  });

  it("tells the previous approver they are off it, and the new one they are on it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const reassigned = new RecordingReassignedNotifier();
    const requested = new RecordingRequestedNotifier();
    const sut = reassignSut({
      approvals,
      sessions,
      users: withUsers(),
      reassigned,
      requested,
    });

    await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reassigned.calls).toHaveLength(1);
    expect(reassigned.calls[0]?.previousApproverUserId).toBe("manager-1");
    expect(requested.calls).toHaveLength(1);
    expect(requested.calls[0]?.approval.approverUserId).toBe("manager-2");
  });

  it("carries the originator's message across unchanged when none is supplied", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.data?.approval.requestMessage).toBe("Board meets Thursday.");
  });

  // A note naming the old approver would read oddly to the new one, so the
  // panel offers it for revision and a supplied value replaces it.
  it("replaces the message when the operator revises it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
      requestMessage: "Rosa is on leave — over to you, Sam.",
    });

    expect(result.data?.approval.requestMessage).toBe("Rosa is on leave — over to you, Sam.");
  });

  it("clears the message when the operator empties it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
      requestMessage: "   ",
    });

    expect(result.data?.approval.requestMessage).toBeNull();
  });

  // The row stays pending but stops matching the old approver, so it leaves
  // their queue by the same filter that serves it.
  it("moves the request between the two approvers' queues", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    const oldQueue = await approvals.listPendingForApprover({
      approverUserId: "manager-1",
      approverEmail: null,
    });
    const newQueue = await approvals.listPendingForApprover({
      approverUserId: "manager-2",
      approverEmail: null,
    });
    expect(oldQueue.data).toHaveLength(0);
    expect(newQueue.data).toHaveLength(1);
  });

  // A decision landing first wins: `updateIfPending` returns null and the move
  // is refused rather than rewriting the approver on a decided row.
  it("loses cleanly to a decision that lands first", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const audit = new RecordingAuditLogger();
    const sut = reassignSut({ approvals, sessions, users: withUsers(), messages, audit });

    await approvals.update(approval.id, { status: "approved", decidedByUserId: "manager-1" });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(approvals.rows.get(approval.id)?.approverUserId).toBe("manager-1");
    expect(messages.rows).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
  });
});
