import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import type { NewApproval } from "@rbrasier/domain";
import { DecideApproval } from "./decide-approval";
import {
  InMemoryApprovals,
  InMemoryFlowEdges,
  InMemoryFlowNodes,
  InMemoryMessages,
  InMemorySessions,
  InMemoryStepOutputs,
  InMemoryUsers,
  RecordingAuditLogger,
  approvalNode,
  session,
  unitOfWorkFor,
  user,
} from "./__fixtures__/approval-doubles";

// The adapter injects node:crypto so the domain stays dependency-free.
const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

const evidence = {
  filename: "signed-memo.pdf",
  mimeType: "application/pdf",
  sizeBytes: 48213,
  storagePath: "approval-evidence/appr-1/2026-08-20-signed-memo.pdf",
};

const nomination = (nominatedByUserId: string) => ({
  nominatedByUserId,
  approvedOn: "2026-08-14",
  evidence,
});

describe("DecideApproval — recorded off system", () => {
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

  // The pieces every case here needs wired the same way, so each test differs
  // only in the thing it is about.
  const build = async (overrides: Partial<NewApproval> = {}) => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, overrides);
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
    const messages = new InMemoryMessages();
    const users = new InMemoryUsers();
    users.add(user("manager-1", "manager@example.gov"));
    users.add(user("operator-1", "operator@example.gov"));
    users.add(user("bystander-1", "bystander@example.gov"));
    const flowNodes = new InMemoryFlowNodes();
    flowNodes.add(approvalNode());

    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      edges,
      stepOutputs,
      audit,
      undefined,
      messages,
      users,
      flowNodes,
      sha256Hex,
    );
    return { approval, approvals, sessions, audit, messages, stepOutputs, sut };
  };

  it("records the approval against the approver, not the person who entered it", async () => {
    const { approval, approvals, sut } = await build();

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    expect(result.error).toBeUndefined();
    const row = approvals.rows.get(approval.id)!;
    expect(row.decidedByUserId).toBe("manager-1");
    expect(row.offSystemNominatedByUserId).toBe("operator-1");
  });

  it("stores the approval date and the evidence on the row", async () => {
    const { approval, approvals, sut } = await build();

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    const row = approvals.rows.get(approval.id)!;
    expect(row.offSystemApprovedOn).toBe("2026-08-14");
    expect(row.offSystemEvidenceFilename).toBe("signed-memo.pdf");
    expect(row.offSystemEvidenceMimeType).toBe("application/pdf");
    expect(row.offSystemEvidenceSizeBytes).toBe(48213);
    expect(row.offSystemEvidenceStoragePath).toBe(evidence.storagePath);
  });

  it("advances the session exactly as an in-system approval does", async () => {
    const { approval, sessions, sut } = await build();

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-next");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-next");
  });

  it("freezes the approval date, the evidence name and when it was entered into the record", async () => {
    const { approval, approvals, sut } = await build();

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    const record = approvals.rows.get(approval.id)!.recordSnapshot!;
    expect(record["manager_sign_off.off_system_approved_on"]).toBe("2026-08-14");
    expect(record["manager_sign_off.off_system_evidence"]).toBe("signed-memo.pdf");
    expect(record["manager_sign_off.recorded_at"]).toEqual(expect.any(String));
  });

  it("names the approver in the record, resolved from the approval rather than the caller", async () => {
    const { approval, approvals, sut } = await build();

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    const record = approvals.rows.get(approval.id)!.recordSnapshot!;
    expect(record["manager_sign_off.approver_email"]).toBe("manager@example.gov");
  });

  it("falls back to the assigned address when the approver has no account yet", async () => {
    const { approval, approvals, sut } = await build({
      approverUserId: null,
      approverEmail: "delegate@example.gov",
    });

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    expect(result.error).toBeUndefined();
    const row = approvals.rows.get(approval.id)!;
    expect(row.decidedByUserId).toBeNull();
    expect(row.recordSnapshot!["manager_sign_off.approver_email"]).toBe("delegate@example.gov");
  });

  it("records a plain approval, never approved_with_edits, whatever the nominator changed", async () => {
    const { approval, approvals, messages, sut } = await build();
    // An edit by the nominator during the pending window. On the in-system path
    // this is what earns `approved_with_edits`; here it belongs to someone who
    // is not the approver, so it must not attach to their signature.
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "Draft",
      stepNodeId: "node-prev",
      document: {
        filename: "draft.docx",
        storagePath: "generated/session-1/draft.docx",
        summary: null,
        generatedAt: new Date().toISOString(),
        editHistory: [
          {
            editedAt: new Date(Date.now() + 1000).toISOString(),
            editedByUserId: "operator-1",
            storagePath: "generated/session-1/draft.docx",
            changes: [{ key: "amount", previousValue: "1", newValue: "2" }],
          },
        ],
      },
    });

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    expect(approvals.rows.get(approval.id)!.status).toBe("approved");
  });

  it("lets an admin record it even though they are neither owner nor requester", async () => {
    const { approval, sut } = await build();

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "bystander-1",
      decision: "approved",
      isAdmin: true,
      offSystem: nomination("bystander-1"),
    });

    expect(result.error).toBeUndefined();
  });

  it("refuses a nominator who neither owns the session nor raised the request", async () => {
    const { approval, approvals, sut } = await build();

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "bystander-1",
      decision: "approved",
      offSystem: nomination("bystander-1"),
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(approvals.rows.get(approval.id)!.status).toBe("pending");
  });

  it("refuses the approver's own nomination — someone present enough to click should approve", async () => {
    const { approval, sut } = await build();

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
      offSystem: nomination("manager-1"),
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a row that has already been decided", async () => {
    const { approval, approvals, sut } = await build();
    await approvals.update(approval.id, { status: "rejected" });

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("flags the audit entry so the decision trail shows how the approval arrived", async () => {
    const { approval, audit, sut } = await build();

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    const decided = audit.entries.find((entry) => entry.action === "approval.decided");
    expect(decided?.metadata).toMatchObject({ offSystemApprovedOn: "2026-08-14" });
  });

  it("says in the thread that the approval was recorded off system", async () => {
    const { approval, messages, sut } = await build();

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "operator-1",
      decision: "approved",
      offSystem: nomination("operator-1"),
    });

    const posted = messages.rows.find((row) => row.content.includes("recorded off system"));
    expect(posted).toBeDefined();
    expect(posted?.content).toContain("14-08-2026");
  });

  it("leaves an ordinary decision recording nothing about off-system approval", async () => {
    const { approval, approvals, sut } = await build();

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    const row = approvals.rows.get(approval.id)!;
    expect(row.offSystemApprovedOn).toBeNull();
    expect(row.offSystemNominatedByUserId).toBeNull();
    expect(row.decidedByUserId).toBe("manager-1");
  });
});
