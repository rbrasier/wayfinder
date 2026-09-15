import { describe, it, expect } from "vitest";
import {
  type Approval,
  type ApprovalStatus,
  type FlowNode,
} from "@wayfinder/domain";
import { ListApprovalsWithContext } from "./list-approvals-with-context";
import { ResolveApprovalSubject } from "./resolve-approval-subject";
import { InMemoryApprovals, InMemoryFlowNodes, InMemoryMessages, InMemorySessions, InMemoryStepOutputs, InMemoryUsers, approvalNode, session, user } from "./__fixtures__/approval-doubles";

describe("ListApprovalsWithContext", () => {
  const previousNode = (overrides: Partial<FlowNode> = {}): FlowNode =>
    approvalNode({ id: "node-prev", type: "conversational", name: "Draft the memo", ...overrides });

  const checkpointed = () =>
    session({ graphCheckpoint: { currentNodeId: "node-appr", advancedFrom: "node-prev" } });

  const seedPending = async (approvals: InMemoryApprovals) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    return created.data!;
  };

  const build = (parts: {
    approvals: InMemoryApprovals;
    sessions?: InMemorySessions;
    users?: InMemoryUsers;
    messages?: InMemoryMessages;
    stepOutputs?: InMemoryStepOutputs;
    nodes?: InMemoryFlowNodes;
  }) => {
    const messages = parts.messages ?? new InMemoryMessages();
    const stepOutputs = parts.stepOutputs ?? new InMemoryStepOutputs();
    const nodes = parts.nodes ?? new InMemoryFlowNodes();
    // The real resolver, not a stub — the context and the gate must resolve the
    // subject the same way, and a stub here would hide it if they stopped.
    const subject = new ResolveApprovalSubject(parts.approvals, nodes, stepOutputs, messages);
    return new ListApprovalsWithContext(
      parts.approvals,
      parts.sessions ?? new InMemorySessions(),
      parts.users ?? new InMemoryUsers(),
      messages,
      stepOutputs,
      nodes,
      subject,
    );
  };

  it("enriches a pending approval with chat name and originator", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const users = new InMemoryUsers();
    users.add({ ...user("operator-1", "operator@corp.test"), name: "Olivia Operator" });

    const sut = build({ approvals, sessions, users });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.chatName).toBe("A session");
    expect(result.data?.[0]?.originatorName).toBe("Olivia Operator");
    expect(result.data?.[0]?.originatorEmail).toBe("operator@corp.test");
  });

  // The approver must be able to see which stage of the chain they are — "first
  // supervisor" and "second supervisor" are different jobs, and a queue that
  // names neither leaves them guessing.
  it("names the approval step and its role hint", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const nodes = new InMemoryFlowNodes();
    nodes.add(
      approvalNode({
        name: "Second level endorsement",
        config: { approverSource: "second_level_supervisor", roleHint: "SES Band 1 delegate" },
      }),
    );

    const sut = build({ approvals, sessions, nodes });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data?.[0]?.approvalStepName).toBe("Second level endorsement");
    expect(result.data?.[0]?.roleHint).toBe("SES Band 1 delegate");
  });

  it("falls back to a generic step name when the approval node has gone", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());

    const sut = build({ approvals, sessions });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data?.[0]?.approvalStepName).toBe("Approval");
    expect(result.data?.[0]?.roleHint).toBeNull();
  });

  it("surfaces the previous step's document as the key output", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const nodes = new InMemoryFlowNodes();
    nodes.add(previousNode());
    const messages = new InMemoryMessages();
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "Here is the draft.",
      stepNodeId: "node-prev",
      document: {
        filename: "memo.docx",
        storagePath: "s/memo.docx",
        summary: "A memo",
        generatedAt: new Date().toISOString(),
      },
      aiPayload: {
        response: "Here is the draft.",
        rationale: "",
        stepCompleteConfidence: 95,
        contextGathered: [],
        documentGenerationConfidence: {
          guidanceAlignmentConfidence: 90,
          guidanceAlignmentRationale: "Aligned",
          criteriaAlignmentConfidence: 88,
          criteriaAlignmentRationale: "On criteria",
        },
      },
    });

    const sut = build({ approvals, sessions, messages, nodes });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    const previous = result.data?.[0]?.previousStep;
    expect(previous?.stepName).toBe("Draft the memo");
    expect(previous?.document?.document.filename).toBe("memo.docx");
    expect(previous?.document?.documentGenerationConfidence?.guidanceAlignmentConfidence).toBe(90);
    expect(previous?.fields).toBeNull();
  });

  it("falls back to the previous step's output fields when there is no document", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-prev",
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
    });

    const sut = build({ approvals, sessions, stepOutputs });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    const previous = result.data?.[0]?.previousStep;
    expect(previous?.document).toBeNull();
    expect(previous?.fields?.[0]?.value).toBe("$1,200");
  });

  it("returns a null previous step when nothing has completed yet", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session({ graphCheckpoint: null }));

    const sut = build({ approvals, sessions });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data?.[0]?.previousStep).toBeNull();
  });

  it("carries the statement of what is being approved", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const nodes = new InMemoryFlowNodes();
    nodes.add(previousNode());
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-prev",
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
    });

    const sut = build({ approvals, sessions, stepOutputs, nodes });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data?.[0]?.subjectDescription).toContain("Draft the memo");
  });

  // The defect ADR-040 §2 exists to close: `advancedFrom` names approval A when
  // the session advances from it, so B used to be shown A's decision fields.
  it("shows a second approver the document, not the first approval's decision fields", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr-b",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    const sessions = new InMemorySessions();
    sessions.add(
      session({ graphCheckpoint: { currentNodeId: "node-appr-b", advancedFrom: "node-appr-a" } }),
    );
    const nodes = new InMemoryFlowNodes();
    nodes.add(previousNode());
    nodes.add(approvalNode({ id: "node-appr-a", name: "Manager review" }));
    nodes.add(approvalNode({ id: "node-appr-b", name: "Finance review" }));

    const messages = new InMemoryMessages();
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "Here is the draft.",
      stepNodeId: "node-prev",
      document: {
        filename: "memo.docx",
        storagePath: "s/memo-r2.docx",
        summary: "A memo",
        generatedAt: new Date().toISOString(),
      },
    });
    // Approval A's projected decision output — the thing B must not be shown.
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr-a",
      fields: [{ key: "outcome", label: "Outcome", type: "text", value: "approved" }],
    });

    const sut = build({ approvals, sessions, messages, stepOutputs, nodes });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    const previous = result.data?.[0]?.previousStep;
    expect(previous?.nodeId).toBe("node-prev");
    expect(previous?.document?.document.storagePath).toBe("s/memo-r2.docx");
    expect(previous?.fields).toBeNull();
  });

  describe("history", () => {
    const decide = async (
      approvals: InMemoryApprovals,
      approvalId: string,
      patch: { status: ApprovalStatus; decidedByUserId: string },
    ) => {
      await approvals.update(approvalId, { ...patch, decidedAt: new Date() });
    };

    it("returns a decision the approver made but is no longer assigned to", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      await decide(approvals, raised.id, { status: "approved", decidedByUserId: "manager-1" });
      // Reassigned afterwards — the decision is still manager-1's.
      await approvals.update(raised.id, { approverUserId: "manager-9" });
      const sessions = new InMemorySessions();
      sessions.add(checkpointed());

      const sut = build({ approvals, sessions });
      const result = await sut.execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "decided",
      });

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.approval.status).toBe("approved");
    });

    it("names who decided it, and leaves that null while pending", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointed());
      const users = new InMemoryUsers();
      users.add({ ...user("manager-1", "manager@corp.test"), name: "Mo Manager" });

      const pending = await build({ approvals, sessions, users }).execute({
        approverUserId: "manager-1",
        approverEmail: null,
      });
      expect(pending.data?.[0]?.decidedByName).toBeNull();

      await decide(approvals, raised.id, { status: "approved", decidedByUserId: "manager-1" });
      const decided = await build({ approvals, sessions, users }).execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "decided",
      });
      expect(decided.data?.[0]?.decidedByName).toBe("Mo Manager");
    });

    // A decision is only half the story: the approver needs to know whether
    // what they signed went on to complete, was sent back, or was discarded.
    it("reports where the session has since got to", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      await decide(approvals, raised.id, { status: "approved", decidedByUserId: "manager-1" });
      const sessions = new InMemorySessions();
      sessions.add({ ...checkpointed(), status: "complete", currentNodeId: "node-prev" });
      const nodes = new InMemoryFlowNodes();
      nodes.add(previousNode());

      const sut = build({ approvals, sessions, nodes });
      const result = await sut.execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "decided",
      });

      expect(result.data?.[0]?.sessionState).toEqual({
        status: "complete",
        currentStepName: "Draft the memo",
      });
    });

    it("lists several decisions on one approval step as separate entries", async () => {
      // A change request routes work back; re-entering the node raises a fresh
      // row. Both rounds are the approver's history.
      const approvals = new InMemoryApprovals();
      const first = await seedPending(approvals);
      await decide(approvals, first.id, {
        status: "changes_requested",
        decidedByUserId: "manager-1",
      });
      const second = await seedPending(approvals);
      await decide(approvals, second.id, { status: "approved", decidedByUserId: "manager-1" });
      const sessions = new InMemorySessions();
      sessions.add(checkpointed());

      const sut = build({ approvals, sessions });
      const result = await sut.execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "decided",
      });

      expect(result.data).toHaveLength(2);
      expect(result.data?.map((entry) => entry.approval.status).sort()).toEqual([
        "approved",
        "changes_requested",
      ]);
    });

    it("keeps a decided approval visible after its session was discarded", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      await decide(approvals, raised.id, { status: "approved", decidedByUserId: "manager-1" });
      approvals.sessionStatuses.set("session-1", "abandoned");
      const sessions = new InMemorySessions();
      sessions.add({ ...checkpointed(), status: "abandoned" });

      const sut = build({ approvals, sessions });
      const result = await sut.execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "all",
      });

      // The decision stands as a matter of record; the state says what happened.
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.sessionState.status).toBe("abandoned");
    });
  });

  describe("getById", () => {
    it("returns the approval to the approver it was addressed to", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointed());

      const result = await build({ approvals, sessions }).getById({
        approvalId: raised.id,
        viewerUserId: "manager-1",
        viewerEmail: null,
        isAdmin: false,
      });

      expect(result.data?.approval.id).toBe(raised.id);
    });

    it("refuses a viewer the approval was not addressed to", async () => {
      // Being named on *another* approval of the session opens the session
      // (ADR-018), but not someone else's decision record.
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);

      const result = await build({ approvals }).getById({
        approvalId: raised.id,
        viewerUserId: "manager-2",
        viewerEmail: "other@corp.test",
        isAdmin: false,
      });

      expect(result.error?.code).toBe("FORBIDDEN");
    });

    it("allows an admin, and the person who decided it", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      await approvals.update(raised.id, {
        status: "approved",
        decidedByUserId: "admin-1",
        decidedAt: new Date(),
      });

      const asAdmin = await build({ approvals }).getById({
        approvalId: raised.id,
        viewerUserId: "someone-else",
        viewerEmail: null,
        isAdmin: true,
      });
      expect(asAdmin.error).toBeUndefined();

      const asDecider = await build({ approvals }).getById({
        approvalId: raised.id,
        viewerUserId: "admin-1",
        viewerEmail: null,
        isAdmin: false,
      });
      expect(asDecider.error).toBeUndefined();
    });

    it("matches an email-only assignment case-insensitively", async () => {
      const approvals = new InMemoryApprovals();
      const created = await approvals.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-appr",
        requestedByUserId: "operator-1",
        approverSource: "first_level_supervisor",
        approverEmail: "Manager@Corp.test",
      });

      const result = await build({ approvals }).getById({
        approvalId: created.data!.id,
        viewerUserId: "manager-1",
        viewerEmail: "manager@corp.test",
        isAdmin: false,
      });

      expect(result.error).toBeUndefined();
    });

    it("is NOT_FOUND for an approval that does not exist", async () => {
      const result = await build({ approvals: new InMemoryApprovals() }).getById({
        approvalId: "missing",
        viewerUserId: "manager-1",
        viewerEmail: null,
        isAdmin: true,
      });

      expect(result.error?.code).toBe("NOT_FOUND");
    });
  });
});
