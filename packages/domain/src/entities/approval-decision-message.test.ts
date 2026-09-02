import { describe, expect, it } from "vitest";
import { buildApprovalDecisionMessage } from "./approval-decision-message";

const decidedAt = new Date("2026-08-02T10:14:00.000Z");

const base = {
  status: "approved" as const,
  approverName: "Rosa Okafor",
  approverEmail: "rosa.okafor@example.com",
  decidedAt,
  comment: null,
  routedBack: false,
  routingError: null,
  offSystemApprovedOn: null,
};

describe("buildApprovalDecisionMessage", () => {
  it("names the decider, their email and the decision moment", () => {
    const content = buildApprovalDecisionMessage(base);

    expect(content).toContain("Approval granted");
    expect(content).toContain("Rosa Okafor");
    expect(content).toContain("rosa.okafor@example.com");
    expect(content).toContain(decidedAt.toISOString());
  });

  it("appends the approver's comment as its own paragraph", () => {
    const content = buildApprovalDecisionMessage({
      ...base,
      status: "changes_requested",
      comment: "I think he should start on Monday 3rd",
    });

    expect(content).toContain("Changes requested by the approver");
    expect(content).toContain("Comment: I think he should start on Monday 3rd");
  });

  it("distinguishes a rejection that routes back from one that closes the request", () => {
    const routed = buildApprovalDecisionMessage({ ...base, status: "rejected", routedBack: true });
    const closed = buildApprovalDecisionMessage({ ...base, status: "rejected", routedBack: false });

    expect(routed).toContain("routed back to the originator");
    expect(closed).toContain("the request was closed");
  });

  it("says so when the approver also edited what they signed", () => {
    const content = buildApprovalDecisionMessage({ ...base, status: "approved_with_edits" });

    expect(content).toContain("with edits made by the approver");
  });

  it("appends a routing error so the operator learns why nothing moved", () => {
    const content = buildApprovalDecisionMessage({
      ...base,
      status: "changes_requested",
      routingError: "This approval step has no step to return to.",
    });

    expect(content).toContain("This approval step has no step to return to.");
  });

  // The record copies identity in rather than joining it (ADR-040 §5), so a
  // deleted or half-populated account yields nulls here. The message must stay
  // readable rather than printing an empty parenthesis or the word "null".
  it("falls back to the email when the decider has no name", () => {
    const content = buildApprovalDecisionMessage({ ...base, approverName: null });

    expect(content).toContain("rosa.okafor@example.com");
    expect(content).not.toContain("null");
  });

  it("omits the identity clause entirely when neither name nor email is known", () => {
    const content = buildApprovalDecisionMessage({
      ...base,
      approverName: null,
      approverEmail: null,
    });

    expect(content).toContain("Approval granted");
    expect(content).not.toContain("null");
    expect(content).not.toContain("()");
  });
});

describe("buildApprovalDecisionMessage — recorded off system", () => {
  const base = {
    status: "approved" as const,
    approverName: "Jane Doe",
    approverEmail: "jane.doe@example.com",
    decidedAt: new Date("2026-08-20T14:00:00.000Z"),
    comment: null,
    routedBack: false,
    routingError: null,
  };

  it("says the approval was recorded off system, and on what date", () => {
    const message = buildApprovalDecisionMessage({
      ...base,
      offSystemApprovedOn: "2026-08-14",
    });

    expect(message).toContain("recorded off system");
    expect(message).toContain("14-08-2026");
  });

  it("still attributes the decision to the approver, not whoever entered it", () => {
    const message = buildApprovalDecisionMessage({
      ...base,
      offSystemApprovedOn: "2026-08-14",
    });

    expect(message).toContain("Jane Doe (jane.doe@example.com)");
  });

  it("reads exactly as before for a decision made in the system", () => {
    const message = buildApprovalDecisionMessage({ ...base, offSystemApprovedOn: null });

    expect(message).toContain("Approval granted.");
    expect(message).not.toContain("off system");
  });
});
