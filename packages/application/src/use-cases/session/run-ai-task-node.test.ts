import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type AiTaskNodeConfig,
  type CalledModel,
  type Flow,
  type FlowNode,
  type GenerateObjectInput,
  type ILanguageModel,
  type Result,
  type TokenUsage,
} from "@rbrasier/domain";
import {
  InMemoryApprovals,
  InMemoryMessages,
  InMemoryStepOutputs,
  RecordingAuditLogger,
  RecordingRequestedNotifier,
  StubResolver,
  session,
} from "../approvals/__fixtures__/approval-doubles";
import { ConfirmAndSend } from "../approvals/confirm-and-send";
import { RunAiTaskNode } from "./run-ai-task-node";

const usage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

class ScriptedModel implements ILanguageModel {
  readonly provider = "anthropic" as const;
  calls: GenerateObjectInput[] = [];
  constructor(private readonly reply: Result<unknown>) {}
  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage } & CalledModel>> {
    this.calls.push(input);
    if (this.reply.error) return this.reply;
    return ok({ object: this.reply.data as T, usage, provider: this.provider, model: "stub" });
  }
  async generateText(): Promise<never> {
    throw new Error("unused");
  }
  async streamText(): Promise<never> {
    throw new Error("unused");
  }
  async streamObject(): Promise<never> {
    throw new Error("unused");
  }
}

const flow: Flow = {
  id: "flow-1",
  name: "Estimates summary",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "owner-1",
  status: "published",
  visibility: { kind: "private" },
  permissions: [],
  contextDocs: [],
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const aiTaskConfig = (overrides: Partial<AiTaskNodeConfig> = {}): AiTaskNodeConfig => ({
  instruction: "Summarise the hearing transcript in one page.",
  inputFields: [{ key: "transcript", label: "Transcript", type: "text", optional: false, raw: "" }],
  inputFieldValues: { transcript: { kind: "literal", value: "Senator: Thank you, Chair." } },
  outputType: "structured",
  structuredFields: [
    { key: "summary", label: "Summary", type: "narrative", optional: false, raw: "" },
  ],
  confidenceThreshold: 80,
  reviewer: { mode: "run_owner" },
  ...overrides,
});

const aiTaskNode = (config: AiTaskNodeConfig): FlowNode => ({
  id: "node-ai",
  flowId: "flow-1",
  type: "ai_task",
  name: "Summarise hearing",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: config as unknown as Record<string, unknown>,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const build = (
  reply: Result<unknown>,
  resolver = new StubResolver({ unresolved: true }),
) => {
  const model = new ScriptedModel(reply);
  const messages = new InMemoryMessages();
  const stepOutputs = new InMemoryStepOutputs();
  const approvals = new InMemoryApprovals();
  const requestedNotifier = new RecordingRequestedNotifier();
  const confirmAndSend = new ConfirmAndSend(approvals, new RecordingAuditLogger(), requestedNotifier);
  const useCase = new RunAiTaskNode(model, messages, stepOutputs, approvals, confirmAndSend, resolver);
  return { useCase, model, messages, stepOutputs, approvals, requestedNotifier };
};

const runSession = session({ id: "session-1", userId: "run-owner-1", currentNodeId: "node-ai" });

describe("RunAiTaskNode", () => {
  it("records the output as the step's record and accepts it when confidence meets the threshold", async () => {
    const { useCase, messages, stepOutputs, approvals } = build(
      ok({ values: { summary: "The committee met." }, confidence: 92, rationale: "Clear transcript." }),
    );

    const result = await useCase.execute({
      session: runSession,
      flow,
      node: aiTaskNode(aiTaskConfig()),
      messages: [],
    });

    expect(result.data).toMatchObject({ outcome: "accepted", confidence: 92 });
    expect(stepOutputs.rows).toHaveLength(1);
    expect(stepOutputs.rows[0]!.fields).toEqual([
      expect.objectContaining({ key: "summary", value: "The committee met." }),
    ]);
    expect(stepOutputs.rows[0]!.messageId).toBe(messages.rows[0]!.id);
    expect(messages.rows[0]).toMatchObject({ role: "assistant", stepNodeId: "node-ai", confidence: 92 });
    expect(approvals.rows.size).toBe(0);
  });

  it("hands the model the instruction and the resolved input values", async () => {
    const { useCase, model } = build(
      ok({ values: { summary: "x" }, confidence: 90, rationale: "" }),
    );

    await useCase.execute({ session: runSession, flow, node: aiTaskNode(aiTaskConfig()), messages: [] });

    expect(model.calls[0]!.system).toBe("Summarise the hearing transcript in one page.");
    expect(model.calls[0]!.prompt).toContain("Transcript: Senator: Thank you, Chair.");
    expect(model.calls[0]!.purpose).toBe("aiTask");
  });

  it("sends a low-confidence result to the run owner for review and confirms the request", async () => {
    const { useCase, approvals, requestedNotifier, stepOutputs } = build(
      ok({ values: { summary: "Partial." }, confidence: 55, rationale: "The transcript cut off." }),
    );

    const result = await useCase.execute({
      session: runSession,
      flow,
      node: aiTaskNode(aiTaskConfig()),
      messages: [],
    });

    expect(result.data).toMatchObject({ outcome: "needs_review", confidence: 55 });
    const approval = [...approvals.rows.values()][0]!;
    expect(approval).toMatchObject({
      nodeId: "node-ai",
      approverSource: "run_owner",
      approverUserId: "run-owner-1",
      requestMessage: "The transcript cut off.",
      status: "pending",
    });
    // Pinned to the AI task itself, so the approver reviews this output rather
    // than whichever step happens to have completed last.
    expect(approval.recordSnapshot).toEqual({
      subjectDescription: 'the result of the AI task "Summarise hearing"',
      subjectNodeId: "node-ai",
    });
    expect(requestedNotifier.calls).toHaveLength(1);
    expect(stepOutputs.rows).toHaveLength(1);
  });

  it("sends a low-confidence result to a named reviewer", async () => {
    const { useCase, approvals } = build(
      ok({ values: { summary: "Partial." }, confidence: 10, rationale: "" }),
    );

    await useCase.execute({
      session: runSession,
      flow,
      node: aiTaskNode(aiTaskConfig({ reviewer: { mode: "user", userId: "reviewer-9" } })),
      messages: [],
    });

    expect([...approvals.rows.values()][0]).toMatchObject({
      approverSource: "named_user",
      approverUserId: "reviewer-9",
    });
  });

  it("resolves a supervisor reviewer from the run owner's reporting line", async () => {
    const { useCase, approvals } = build(
      ok({ values: { summary: "Partial." }, confidence: 10, rationale: "" }),
      new StubResolver({ suggestedApproverUserId: "supervisor-3" }),
    );

    await useCase.execute({
      session: runSession,
      flow,
      node: aiTaskNode(
        aiTaskConfig({
          reviewer: { mode: "approver_source", approverSource: "first_level_supervisor" },
        }),
      ),
      messages: [],
    });

    expect([...approvals.rows.values()][0]).toMatchObject({
      approverSource: "first_level_supervisor",
      approverUserId: "supervisor-3",
    });
  });

  it("falls back to the run owner when no supervisor can be resolved, so a result is never unreviewed", async () => {
    const { useCase, approvals } = build(
      ok({ values: { summary: "Partial." }, confidence: 10, rationale: "" }),
    );

    await useCase.execute({
      session: runSession,
      flow,
      node: aiTaskNode(
        aiTaskConfig({
          reviewer: { mode: "approver_source", approverSource: "second_level_supervisor" },
        }),
      ),
      messages: [],
    });

    expect([...approvals.rows.values()][0]!.approverUserId).toBe("run-owner-1");
  });

  it("does not call the model again when a review for this step is already pending", async () => {
    const { useCase, model, approvals } = build(
      ok({ values: { summary: "x" }, confidence: 90, rationale: "" }),
    );
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-ai",
      requestedByUserId: "run-owner-1",
      approverSource: "run_owner",
      approverUserId: "run-owner-1",
    });

    const result = await useCase.execute({
      session: runSession,
      flow,
      node: aiTaskNode(aiTaskConfig()),
      messages: [],
    });

    expect(result.data).toMatchObject({ outcome: "needs_review" });
    expect(model.calls).toHaveLength(0);
  });

  it("refuses an incomplete config before calling the model", async () => {
    const { useCase, model } = build(ok({ values: {}, confidence: 90, rationale: "" }));

    const result = await useCase.execute({
      session: runSession,
      flow,
      node: aiTaskNode(aiTaskConfig({ instruction: "" })),
      messages: [],
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Add an instruction for the AI task.");
    expect(model.calls).toHaveLength(0);
  });

  it("surfaces a model failure without recording any output", async () => {
    const { useCase, stepOutputs } = build(err(domainError("INFRA_FAILURE", "provider down")));

    const result = await useCase.execute({
      session: runSession,
      flow,
      node: aiTaskNode(aiTaskConfig()),
      messages: [],
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(stepOutputs.rows).toHaveLength(0);
  });
});
