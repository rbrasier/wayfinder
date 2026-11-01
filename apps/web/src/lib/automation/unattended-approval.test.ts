import { describe, expect, it } from "vitest";
import { ok, type Approval, type FlowNode, type Session } from "@wayfinder/domain";
import { flagForStep, raiseUnattendedApproval } from "./unattended-approval";

const session = { id: "session-1", flowId: "flow-1", userId: "owner-1" } as Session;
const node = { id: "sign", type: "approval" } as FlowNode;

const build = (suggestedApproverUserId: string | null, approverUserId: string | null = null) => {
  const confirmed: Array<{ approvalId: string; approverUserId?: string | null }> = [];
  const raise = () =>
    raiseUnattendedApproval(
      {
        suggest: async () =>
          ok({
            approval: { id: "approval-1", suggestedApproverUserId, approverUserId } as Approval,
            suggestedApprover: null,
            assignedApprover: null,
          }),
        confirm: async (input) => {
          confirmed.push(input);
          return ok({ id: input.approvalId } as Approval);
        },
      },
      session,
      node,
    );
  return { raise, confirmed };
};

describe("raiseUnattendedApproval", () => {
  it("confirms the suggested approver on the spot, since no operator is there to", async () => {
    const { raise, confirmed } = build("manager-1");

    const result = await raise();

    expect(result.data).toEqual({ approverAssigned: true });
    expect(confirmed).toEqual([{ approvalId: "approval-1", approverUserId: "manager-1", isOverride: false }]);
  });

  it("leaves the request for a person when no approver could be suggested", async () => {
    const { raise, confirmed } = build(null);

    expect((await raise()).data).toEqual({ approverAssigned: false });
    expect(confirmed).toEqual([]);
  });

  it("does not confirm again when the request already has its approver", async () => {
    const { raise, confirmed } = build("manager-1", "manager-1");

    expect((await raise()).data).toEqual({ approverAssigned: true });
    expect(confirmed).toEqual([]);
  });
});

describe("flagForStep", () => {
  it("names the feature flag each automated step type runs under", () => {
    expect(flagForStep("ai_task")).toBe("ai_task_node");
    expect(flagForStep("email")).toBe("email_node");
    expect(flagForStep("auto")).toBe("auto_node");
    expect(flagForStep("mcp")).toBe("mcp");
    expect(flagForStep("scheduled")).toBe("scheduled_node");
    expect(flagForStep("conversational")).toBeNull();
  });
});
