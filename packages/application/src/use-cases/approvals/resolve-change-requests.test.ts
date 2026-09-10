import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type { Approval, FlowNode, IApprovalRepository, IFlowNodeRepository } from "@wayfinder/domain";
import { resolveChangeRequests } from "./resolve-change-requests";

const makeApproval = (overrides: Partial<Approval>): Approval => ({
  id: "approval-1",
  sessionId: "sess-1",
  flowId: "flow-1",
  nodeId: "node-approval-1",
  messageId: null,
  requestedByUserId: "user-1",
  approverSource: "first_level_supervisor",
  suggestedApproverUserId: null,
  approverUserId: "user-2",
  approverEmail: null,
  isOverride: false,
  status: "changes_requested",
  decidedByUserId: "user-2",
  decidedAt: new Date("2026-03-01T09:00:00.000Z"),
  comment: "The start date must be 03-03-2026.",
  recordSnapshot: null,
  createdAt: new Date("2026-03-01T08:00:00.000Z"),
  updatedAt: new Date("2026-03-01T09:00:00.000Z"),
  ...overrides,
});

const makeNode = (id: string, name: string): FlowNode => ({
  id,
  flowId: "flow-1",
  type: "approval",
  name,
  colour: null,
  positionX: 0,
  positionY: 0,
  config: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

const makeApprovals = (rows: Approval[]): IApprovalRepository =>
  ({ listBySession: vi.fn().mockResolvedValue(ok(rows)) }) as unknown as IApprovalRepository;

const makeFlowNodes = (nodes: FlowNode[]): IFlowNodeRepository =>
  ({ listByFlow: vi.fn().mockResolvedValue(ok(nodes)) }) as unknown as IFlowNodeRepository;

describe("resolveChangeRequests", () => {
  it("names the approval step that raised each outstanding request", async () => {
    const requests = await resolveChangeRequests(
      makeApprovals([makeApproval({})]),
      makeFlowNodes([makeNode("node-approval-1", "Finance sign-off")]),
      { sessionId: "sess-1", flowId: "flow-1" },
    );

    expect(requests).toEqual([
      {
        nodeId: "node-approval-1",
        stepName: "Finance sign-off",
        comment: "The start date must be 03-03-2026.",
      },
    ]);
  });

  it("returns nothing when every approval has since been approved", async () => {
    const requests = await resolveChangeRequests(
      makeApprovals([
        makeApproval({}),
        makeApproval({
          id: "approval-2",
          status: "approved",
          comment: null,
          decidedAt: new Date("2026-03-02T09:00:00.000Z"),
        }),
      ]),
      makeFlowNodes([makeNode("node-approval-1", "Finance sign-off")]),
      { sessionId: "sess-1", flowId: "flow-1" },
    );

    expect(requests).toEqual([]);
  });

  // Generation is the caller. A document that fails to render because the
  // approval table could not be read is a worse outcome than one rendered
  // without the change requests, which is exactly today's behaviour.
  it("degrades to no requests when the approvals cannot be read", async () => {
    const approvals = {
      listBySession: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "db down"))),
    } as unknown as IApprovalRepository;

    const requests = await resolveChangeRequests(approvals, makeFlowNodes([]), {
      sessionId: "sess-1",
      flowId: "flow-1",
    });

    expect(requests).toEqual([]);
  });

  it("still returns the request when the step names cannot be read", async () => {
    const flowNodes = {
      listByFlow: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "db down"))),
    } as unknown as IFlowNodeRepository;

    const requests = await resolveChangeRequests(makeApprovals([makeApproval({})]), flowNodes, {
      sessionId: "sess-1",
      flowId: "flow-1",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.stepName).toBe("An approval step");
  });
});
