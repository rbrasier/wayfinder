import { describe, expect, it, vi } from "vitest";
import { ok, type Approval, type FlowNode, type SessionStepOutput } from "@rbrasier/domain";
import { ResolveApprovalSubject } from "./resolve-approval-subject";

const at = (iso: string) => new Date(iso);

const approval = (overrides: Partial<Approval> = {}): Approval =>
  ({
    id: "approval-1",
    sessionId: "sess-1",
    flowId: "flow-1",
    nodeId: "approval_a",
    messageId: null,
    requestedByUserId: "user-1",
    approverSource: "first_level_supervisor",
    suggestedApproverUserId: null,
    approverUserId: null,
    approverEmail: null,
    isOverride: false,
    status: "pending",
    decidedByUserId: null,
    decidedAt: null,
    comment: null,
    recordSnapshot: null,
    createdAt: at("2026-08-01T12:00:00Z"),
    updatedAt: at("2026-08-01T12:00:00Z"),
    ...overrides,
  }) as Approval;

const node = (id: string, name: string, config: Record<string, unknown> = {}): FlowNode =>
  ({
    id,
    flowId: "flow-1",
    type: id.startsWith("approval") ? "approval" : "conversational",
    name,
    colour: null,
    positionX: 0,
    positionY: 0,
    config,
    createdAt: at("2026-08-01T09:00:00Z"),
    updatedAt: at("2026-08-01T09:00:00Z"),
  }) as FlowNode;

const stepOutput = (nodeId: string, iso: string, fields: SessionStepOutput["fields"] = []) =>
  ({
    id: `out-${nodeId}`,
    sessionId: "sess-1",
    flowId: "flow-1",
    nodeId,
    messageId: null,
    fields,
    createdAt: at(iso),
    updatedAt: at(iso),
  }) as SessionStepOutput;

const draftFields = [
  { key: "supplier_name", label: "Supplier Name", type: "text" as const, value: "Acme Ltd" },
  { key: "amount", label: "Amount", type: "currency" as const, value: "$1,200.00" },
];

interface Fakes {
  approvalRow: Approval;
  nodes: FlowNode[];
  outputs: SessionStepOutput[];
  summary: string;
}

const build = (overrides: Partial<Fakes> = {}) => {
  const fakes: Fakes = {
    approvalRow: approval(),
    nodes: [
      node("intake", "Gather requirements"),
      node("draft", "Prepare instrument"),
      node("approval_a", "Manager review"),
    ],
    outputs: [
      stepOutput("intake", "2026-08-01T10:00:00Z"),
      stepOutput("draft", "2026-08-01T11:00:00Z", draftFields),
    ],
    summary: "the delegation of purchasing authority to Acme Ltd",
    ...overrides,
  };

  const updated: Approval[] = [];
  const approvals = {
    findById: vi.fn(async () => ok(fakes.approvalRow)),
    update: vi.fn(async (_id: string, patch: { recordSnapshot?: Record<string, unknown> }) => {
      const next = { ...fakes.approvalRow, ...patch } as Approval;
      fakes.approvalRow = next;
      updated.push(next);
      return ok(next);
    }),
  };
  const flowNodes = {
    findById: vi.fn(async (id: string) => ok(fakes.nodes.find((each) => each.id === id) ?? null)),
    listByFlow: vi.fn(async () => ok(fakes.nodes)),
  };
  const sessionStepOutputs = { listBySession: vi.fn(async () => ok(fakes.outputs)) };
  const sessionMessages = { listBySession: vi.fn(async () => ok([])) };
  const languageModel = {
    generateText: vi.fn(async () => ok({ text: fakes.summary, usage: {} })),
  };

  const useCase = new ResolveApprovalSubject(
    approvals as never,
    flowNodes as never,
    sessionStepOutputs as never,
    sessionMessages as never,
    languageModel as never,
  );

  return {
    useCase,
    approvals,
    flowNodes,
    sessionStepOutputs,
    sessionMessages,
    languageModel,
    updated,
    fakes,
  };
};

describe("ResolveApprovalSubject — step case", () => {
  it("defaults to the last completed step and names it in the statement", async () => {
    const { useCase } = build();

    const result = await useCase.execute({ approvalId: "approval-1" });

    expect(result.error).toBeUndefined();
    expect(result.data?.subjectNodeId).toBe("draft");
    expect(result.data?.description).toContain("Prepare instrument");
  });

  it("captures the referenced step's output snapshot", async () => {
    const { useCase } = build();

    const result = await useCase.execute({ approvalId: "approval-1" });

    expect(result.data?.snapshot).toEqual(draftFields);
  });

  it("uses the step the author named rather than the last completed one", async () => {
    const { useCase } = build({
      nodes: [
        node("intake", "Gather requirements"),
        node("draft", "Prepare instrument"),
        node("approval_a", "Manager review", {
          approverSource: "first_level_supervisor",
          approvalSubject: { kind: "step", nodeId: "intake" },
        }),
      ],
    });

    const result = await useCase.execute({ approvalId: "approval-1" });

    expect(result.data?.subjectNodeId).toBe("intake");
    expect(result.data?.description).toContain("Gather requirements");
  });

  it("picks the branch actually taken when the flow forked", async () => {
    const { useCase } = build({
      nodes: [
        node("intake", "Gather requirements"),
        node("branch_a", "Domestic path"),
        node("branch_b", "Overseas path"),
        node("approval_a", "Manager review"),
      ],
      outputs: [
        stepOutput("intake", "2026-08-01T10:00:00Z"),
        stepOutput("branch_b", "2026-08-01T11:00:00Z"),
      ],
    });

    const result = await useCase.execute({ approvalId: "approval-1" });

    expect(result.data?.subjectNodeId).toBe("branch_b");
    expect(result.data?.description).toContain("Overseas path");
  });

  it("skips a preceding approval so a second approver is pointed at the document", async () => {
    const { useCase } = build({
      approvalRow: approval({ id: "approval-2", nodeId: "approval_b" }),
      nodes: [
        node("draft", "Prepare instrument"),
        node("approval_a", "Manager review"),
        node("approval_b", "Finance review"),
      ],
      outputs: [
        stepOutput("draft", "2026-08-01T11:00:00Z", draftFields),
        stepOutput("approval_a", "2026-08-01T12:00:00Z", [
          { key: "outcome", label: "Outcome", type: "text", value: "approved" },
        ]),
      ],
    });

    const result = await useCase.execute({ approvalId: "approval-2" });

    expect(result.data?.subjectNodeId).toBe("draft");
    expect(result.data?.snapshot).toEqual(draftFields);
  });

  it("counts a step that only posted messages, with no captured output fields", async () => {
    const { useCase, sessionMessages } = build({ outputs: [] });
    sessionMessages.listBySession.mockResolvedValue(
      ok([
        { id: "m1", stepNodeId: "draft", createdAt: at("2026-08-01T11:00:00Z") },
        { id: "m2", stepNodeId: "intake", createdAt: at("2026-08-01T10:00:00Z") },
      ]) as never,
    );

    const result = await useCase.execute({ approvalId: "approval-1" });

    expect(result.data?.subjectNodeId).toBe("draft");
    expect(result.data?.snapshot).toBeNull();
  });

  it("still resolves a statement when no step has completed yet", async () => {
    const { useCase } = build({ outputs: [] });

    const result = await useCase.execute({ approvalId: "approval-1" });

    expect(result.error).toBeUndefined();
    expect(result.data?.subjectNodeId).toBeNull();
    expect(result.data?.description).toBeTruthy();
  });

  it("never makes a model call for the step case", async () => {
    const { useCase, languageModel } = build();

    await useCase.execute({ approvalId: "approval-1" });

    expect(languageModel.generateText).not.toHaveBeenCalled();
  });
});

describe("ResolveApprovalSubject — custom case", () => {
  const customNodes = [
    node("intake", "Gather requirements"),
    node("draft", "Prepare instrument"),
    node("approval_a", "Manager review", {
      approverSource: "first_level_supervisor",
      approvalSubject: { kind: "custom", instruction: "Describe the authority being delegated." },
    }),
  ];

  it("summarises the subject from the gathered information and the instruction", async () => {
    const { useCase, languageModel } = build({ nodes: customNodes });

    const result = await useCase.execute({ approvalId: "approval-1" });

    expect(result.data?.description).toBe("the delegation of purchasing authority to Acme Ltd");
    expect(result.data?.subjectNodeId).toBeNull();
    const prompt = languageModel.generateText.mock.calls[0]![0] as { prompt: string };
    expect(prompt.prompt).toContain("Describe the authority being delegated.");
    expect(prompt.prompt).toContain("Acme Ltd");
  });

  // Without the requesting user the summary lands on an unattributed usage row
  // and QuotaEnforcer.check returns before it looks at a budget (ADR-026).
  it("bills the summary to the user who requested the approval", async () => {
    const { useCase, languageModel } = build({ nodes: customNodes });

    await useCase.execute({ approvalId: "approval-1" });

    expect(languageModel.generateText.mock.calls[0]![0]).toMatchObject({
      userId: "user-1",
      flowId: "flow-1",
      sessionId: "sess-1",
    });
  });

  it("caches the summary on the pending approval so a second read does not recompute it", async () => {
    const { useCase, languageModel } = build({ nodes: customNodes });

    const first = await useCase.execute({ approvalId: "approval-1" });
    const second = await useCase.execute({ approvalId: "approval-1" });

    expect(languageModel.generateText).toHaveBeenCalledTimes(1);
    expect(second.data?.description).toBe(first.data?.description);
  });

  it("falls back to the instruction when the model call fails", async () => {
    const { useCase, languageModel } = build({ nodes: customNodes });
    languageModel.generateText.mockResolvedValue({
      error: { code: "INFRA_FAILURE", message: "model down" },
    } as never);

    const result = await useCase.execute({ approvalId: "approval-1" });

    expect(result.error).toBeUndefined();
    expect(result.data?.description).toContain("Describe the authority being delegated.");
  });
});

describe("ResolveApprovalSubject — caching", () => {
  it("writes the resolved subject onto the pending approval", async () => {
    const { useCase, updated } = build();

    await useCase.execute({ approvalId: "approval-1" });

    expect(updated).toHaveLength(1);
    expect(updated[0]!.recordSnapshot).toMatchObject({
      subjectDescription: expect.stringContaining("Prepare instrument"),
      subjectNodeId: "draft",
    });
  });

  it("returns a decided approval's locked subject without re-resolving it", async () => {
    const { useCase, flowNodes } = build({
      approvalRow: approval({
        status: "approved",
        recordSnapshot: { subjectDescription: "what Jane signed", subjectNodeId: "draft" },
      }),
    });

    const result = await useCase.execute({ approvalId: "approval-1" });

    expect(result.data?.description).toBe("what Jane signed");
    expect(flowNodes.listByFlow).not.toHaveBeenCalled();
  });

  it("reports NOT_FOUND for an approval that does not exist", async () => {
    const { useCase, approvals } = build();
    approvals.findById.mockResolvedValue(ok(null) as never);

    const result = await useCase.execute({ approvalId: "missing" });

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
