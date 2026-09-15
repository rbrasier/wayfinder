import { describe, expect, it } from "vitest";
import {
  approvalSubjectOf,
  buildApprovalRecord,
  changesRequestedTargetOf,
  deriveStepKeys,
} from "./approval-record";
import type { ApprovalNodeConfig } from "./flow-node";

const baseConfig: ApprovalNodeConfig = { approverSource: "first_level_supervisor" };

describe("approvalSubjectOf", () => {
  it("defaults an approval node with no configured subject to the last completed step", () => {
    expect(approvalSubjectOf(baseConfig)).toEqual({ kind: "step", nodeId: null });
  });

  it("returns the configured step when the author named one", () => {
    const config: ApprovalNodeConfig = {
      ...baseConfig,
      approvalSubject: { kind: "step", nodeId: "node-7" },
    };

    expect(approvalSubjectOf(config)).toEqual({ kind: "step", nodeId: "node-7" });
  });

  it("returns the custom instruction when the author typed one", () => {
    const config: ApprovalNodeConfig = {
      ...baseConfig,
      approvalSubject: { kind: "custom", instruction: "Summarise the delegation sought." },
    };

    expect(approvalSubjectOf(config)).toEqual({
      kind: "custom",
      instruction: "Summarise the delegation sought.",
    });
  });
});

describe("changesRequestedTargetOf", () => {
  it("defaults to the nearest editable step when nothing is configured", () => {
    expect(changesRequestedTargetOf(baseConfig)).toEqual({ kind: "nearest_editable" });
  });

  it("returns the configured step when the author named one", () => {
    const config: ApprovalNodeConfig = {
      ...baseConfig,
      changesRequestedTarget: { kind: "step", nodeId: "node-2" },
    };

    expect(changesRequestedTargetOf(config)).toEqual({ kind: "step", nodeId: "node-2" });
  });
});

describe("deriveStepKeys", () => {
  it("snake_cases each label the same way template field keys are derived", () => {
    expect(deriveStepKeys(["Manager Review", "Finance Review"])).toEqual([
      "manager_review",
      "finance_review",
    ]);
  });

  it("suffixes a repeated label so two steps never collide in the record", () => {
    expect(deriveStepKeys(["Review", "Review", "Review"])).toEqual([
      "review",
      "review_2",
      "review_3",
    ]);
  });

  it("does not let a suffixed key collide with a literal label of the same name", () => {
    expect(deriveStepKeys(["Review", "Review", "Review 2"])).toEqual([
      "review",
      "review_2",
      "review_2_2",
    ]);
  });
});

describe("buildApprovalRecord", () => {
  const decidedAt = new Date("2026-08-01T14:32:11.204Z");

  it("writes the five guaranteed keys prefixed by the step key", () => {
    const record = buildApprovalRecord({
      stepKey: "manager_review",
      decision: "approved",
      approverName: "Jane Doe",
      approverEmail: "jane.doe@example.com",
      decidedAt,
      comment: "Within delegated authority.",
    });

    expect(record).toEqual({
      "manager_review.decision": "approved",
      "manager_review.approver_name": "Jane Doe",
      "manager_review.approver_email": "jane.doe@example.com",
      "manager_review.decided_at": "2026-08-01T14:32:11.204Z",
      "manager_review.comment": "Within delegated authority.",
    });
  });

  it("adds the subject, signature and edit detail when they are known", () => {
    const record = buildApprovalRecord({
      stepKey: "manager_review",
      decision: "approved",
      approverName: "Jane Doe",
      approverEmail: "jane.doe@example.com",
      decidedAt,
      comment: null,
      subjectDescription: "Draft instrument produced by 'Prepare instrument'",
      subjectNodeId: "node-1",
      signatureFieldKey: "delegate_signature",
      verificationCode: "3F9A2C1E7B04",
      editsMade: true,
      editedFieldKeys: ["commencement_date"],
    });

    expect(record["manager_review.subject_description"]).toBe(
      "Draft instrument produced by 'Prepare instrument'",
    );
    expect(record["manager_review.subject_node_id"]).toBe("node-1");
    expect(record["manager_review.signature_field_key"]).toBe("delegate_signature");
    expect(record["manager_review.verification_code"]).toBe("3F9A2C1E7B04");
    expect(record["manager_review.edits_made"]).toBe(true);
    expect(record["manager_review.edited_field_keys"]).toEqual(["commencement_date"]);
  });

  it("writes an empty comment rather than omitting the guaranteed key", () => {
    const record = buildApprovalRecord({
      stepKey: "finance_review",
      decision: "rejected",
      approverName: null,
      approverEmail: null,
      decidedAt,
      comment: null,
    });

    expect(record).toHaveProperty("finance_review.comment", "");
    expect(record).toHaveProperty("finance_review.approver_name", "");
    expect(record).toHaveProperty("finance_review.approver_email", "");
  });

  it("keeps two approval steps in one flow from colliding", () => {
    const manager = buildApprovalRecord({
      stepKey: "manager_review",
      decision: "approved",
      approverName: "Jane Doe",
      approverEmail: "jane@example.com",
      decidedAt,
      comment: null,
    });
    const finance = buildApprovalRecord({
      stepKey: "finance_review",
      decision: "approved",
      approverName: "Sam Patel",
      approverEmail: "sam@example.com",
      decidedAt,
      comment: null,
    });

    const merged = { ...manager, ...finance };

    expect(Object.keys(merged)).toHaveLength(10);
    expect(merged["manager_review.approver_name"]).toBe("Jane Doe");
    expect(merged["finance_review.approver_name"]).toBe("Sam Patel");
  });
});

describe("buildApprovalRecord — recorded off system", () => {
  const base = {
    stepKey: "manager_review",
    decision: "approved" as const,
    approverName: "Jane Doe",
    approverEmail: "jane.doe@example.com",
    decidedAt: new Date("2026-08-20T14:00:00.000Z"),
    comment: null,
  };

  it("freezes the approval date, the evidence filename and when it was entered", () => {
    const record = buildApprovalRecord({
      ...base,
      offSystemApprovedOn: "2026-08-14",
      offSystemEvidenceFilename: "signed-memo.pdf",
      recordedAt: new Date("2026-08-20T14:00:00.000Z"),
    });

    expect(record["manager_review.off_system_approved_on"]).toBe("2026-08-14");
    expect(record["manager_review.off_system_evidence"]).toBe("signed-memo.pdf");
    expect(record["manager_review.recorded_at"]).toBe("2026-08-20T14:00:00.000Z");
  });

  it("keeps decided_at as the moment the decision committed, alongside the approval date", () => {
    const record = buildApprovalRecord({
      ...base,
      offSystemApprovedOn: "2026-08-14",
      offSystemEvidenceFilename: "signed-memo.pdf",
      recordedAt: new Date("2026-08-20T14:00:00.000Z"),
    });

    expect(record["manager_review.decided_at"]).toBe("2026-08-20T14:00:00.000Z");
    expect(record["manager_review.off_system_approved_on"]).toBe("2026-08-14");
  });

  it("writes none of the off-system keys for an ordinary decision", () => {
    const record = buildApprovalRecord(base);

    expect(record).not.toHaveProperty("manager_review.off_system_approved_on");
    expect(record).not.toHaveProperty("manager_review.off_system_evidence");
    expect(record).not.toHaveProperty("manager_review.recorded_at");
  });
});
