import {
  aiTaskConfidenceThresholdOf,
  aiTaskInputModeOf,
  buildFieldConstraintsText,
  domainError,
  err,
  meetsConfidenceThreshold,
  ok,
  validateAiTaskNodeConfig,
  type AiTaskNodeConfig,
  type AiTaskReviewer,
  type ApproverSource,
  type Flow,
  type FlowNode,
  type IApprovalRepository,
  type ILanguageModel,
  type IReportingLineResolver,
  type ISessionMessageRepository,
  type ISessionStepOutputRepository,
  type Result,
  type Session,
  type SessionMessage,
  type SessionStepOutput,
  type SessionTriggerPayload,
} from "@wayfinder/domain";
import { buildAiTaskResultSchema, type AiTaskResult, type DocumentData } from "@wayfinder/shared";
import { accumulateInsights } from "../../services/accumulate-insights";
import { resolveFieldValues } from "../../services/resolve-field-values";
import { SUBJECT_DESCRIPTION_KEY, SUBJECT_NODE_ID_KEY } from "../approvals/approval-record-keys";
import type { ConfirmAndSend } from "../approvals/confirm-and-send";
import { buildStepOutputFields } from "../document/step-output-fields";
import { buildContextDocsSection, coerceGroupItems } from "../document/structured-fields";

export interface RunAiTaskNodeInput {
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
  // Skill instructions and MCP tool results for this step, prepared by the
  // caller exactly as a conversational turn prepares them.
  additionalContext?: string;
}

export type RunAiTaskNodeOutput =
  | { outcome: "accepted"; confidence: number; messageId: string }
  | { outcome: "needs_review"; confidence: number | null; messageId: string | null; approvalId: string };

const buildTranscript = (messages: SessionMessage[]): string =>
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n")
    .slice(0, 8000);

const asPromptText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

// What an unattended run was started with: its declared inputs, then the whole
// Event Watch item or webhook body, so a step that accepts all inputs needs no
// mapping to see a field nobody declared.
const buildRunInputsSection = (payload: SessionTriggerPayload | null | undefined): string => {
  if (!payload) return "";
  const lines = Object.entries(payload.inputs).map(([key, value]) => `- ${key}: ${asPromptText(value)}`);
  const started = payload.raw === undefined || payload.raw === null ? "" : `\nStarted with:\n${asPromptText(payload.raw)}`;
  if (lines.length === 0 && !started) return "";
  return `\nRun inputs:\n${lines.join("\n")}${started}`;
};

const buildPriorOutputsSection = (outputs: SessionStepOutput[]): string => {
  const lines = outputs.flatMap((output) =>
    output.fields
      .filter((field) => field.value.trim().length > 0)
      .map((field) => `- ${field.label}: ${field.value}`),
  );
  return lines.length === 0 ? "" : `\nData captured by earlier steps:\n${lines.join("\n")}`;
};

// Group fields are coerced (capped, invalid items dropped) and scalars kept as
// strings, so a malformed reply can never break the record it is written to.
const coerceValues = (config: AiTaskNodeConfig, values: DocumentData): DocumentData => {
  const coerced: DocumentData = {};
  for (const field of config.structuredFields) {
    const value = values[field.key];
    if (field.type === "group") {
      coerced[field.key] = coerceGroupItems(field, value);
      continue;
    }
    coerced[field.key] = typeof value === "string" ? value : "";
  }
  return coerced;
};

const approverSourceFor = (reviewer: AiTaskReviewer): ApproverSource => {
  if (reviewer.mode === "run_owner") return "run_owner";
  if (reviewer.mode === "user") return "named_user";
  return reviewer.approverSource;
};

// Runs an AI instruction with nobody at the keyboard (ADR-065 §3). The result is
// recorded exactly as a structured step's record is — an assistant message plus
// a step output linked to it — so the record card and approver edits work on it
// unchanged. Below the threshold it goes to a reviewer through the ordinary
// approvals queue; the caller advances the run only on `accepted`.
export class RunAiTaskNode {
  constructor(
    private readonly languageModel: ILanguageModel,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly approvals: IApprovalRepository,
    private readonly confirmAndSend: ConfirmAndSend,
    private readonly reportingLines: IReportingLineResolver,
  ) {}

  async execute(input: RunAiTaskNodeInput): Promise<Result<RunAiTaskNodeOutput>> {
    const config = input.node.config as unknown as AiTaskNodeConfig;
    const problems = validateAiTaskNodeConfig(config);
    if (problems.length > 0) {
      return err(domainError("VALIDATION_FAILED", problems.map((problem) => problem.message).join(" ")));
    }

    // Re-entering the step while its review is open must not spend another
    // model call or raise a second request.
    const pending = await this.approvals.findPendingByNode(input.session.id, input.node.id);
    if (pending.error) return pending;
    if (pending.data) {
      return ok({
        outcome: "needs_review",
        confidence: null,
        messageId: pending.data.messageId,
        approvalId: pending.data.id,
      });
    }

    const priorOutputs = await this.sessionStepOutputs.listBySession(input.session.id);
    const priorStepOutputs = priorOutputs.error ? [] : priorOutputs.data;

    const generated = await this.generate(input, config, priorStepOutputs);
    if (generated.error) return generated;
    const { confidence, rationale } = generated.data;
    const values = coerceValues(config, generated.data.values);

    const content = `${input.node.name} was completed by AI (confidence ${confidence}%).`;
    const fields = buildStepOutputFields(config.structuredFields, values);
    const message = await this.sessionMessages.create({
      sessionId: input.session.id,
      role: "assistant",
      content,
      stepNodeId: input.node.id,
      confidence,
      aiPayload: {
        response: content,
        rationale,
        stepCompleteConfidence: confidence,
        contextGathered: fields
          .filter((field) => field.type !== "group")
          .map((field) => ({ key: field.label, value: field.value })),
      },
    });
    if (message.error) return message;

    const recorded = await this.sessionStepOutputs.create({
      sessionId: input.session.id,
      flowId: input.flow.id,
      nodeId: input.node.id,
      messageId: message.data.id,
      fields,
    });
    if (recorded.error) return recorded;

    if (meetsConfidenceThreshold(confidence, aiTaskConfidenceThresholdOf(config))) {
      return ok({ outcome: "accepted", confidence, messageId: message.data.id });
    }

    const approvalId = await this.requestReview(input, config, message.data.id, rationale);
    if (approvalId.error) return approvalId;
    return ok({
      outcome: "needs_review",
      confidence,
      messageId: message.data.id,
      approvalId: approvalId.data,
    });
  }

  private async generate(
    input: RunAiTaskNodeInput,
    config: AiTaskNodeConfig,
    priorStepOutputs: SessionStepOutput[],
  ): Promise<Result<AiTaskResult>> {
    const transcript = buildTranscript(input.messages);
    const acceptsAll = aiTaskInputModeOf(config) === "all";
    const pickedFields = acceptsAll ? [] : (config.inputFields ?? []);
    const inputValues = await resolveFieldValues(this.languageModel, {
      fields: pickedFields,
      valueSources: config.inputFieldValues ?? {},
      priorStepOutputs,
      insights: accumulateInsights(input.messages),
      transcript,
      contextDocs: input.flow.contextDocs,
      instruction: config.instruction,
      purpose: "aiTask",
      userId: input.session.userId,
      flowId: input.flow.id,
      sessionId: input.session.id,
    });
    if (inputValues.error) return inputValues;

    const inputLines = pickedFields.map(
      (field) => `- ${field.label}: ${inputValues.data[field.key] ?? ""}`,
    );
    const keys = config.structuredFields.map((field) => field.key);
    const prompt = [
      `Carry out the instruction and return "values" with exactly these keys: ${JSON.stringify(keys)}.`,
      `Also return "confidence" (0-100) that your output fully and accurately meets the instruction, and a short "rationale" naming anything missing or uncertain.`,
      `\n<field_constraints>\n${buildFieldConstraintsText(config.structuredFields)}\n</field_constraints>`,
      inputLines.length > 0 ? `\nInputs:\n${inputLines.join("\n")}` : "",
      acceptsAll ? buildRunInputsSection(input.session.triggerPayload) : "",
      acceptsAll ? buildPriorOutputsSection(priorStepOutputs) : "",
      buildContextDocsSection(input.flow.contextDocs),
      input.additionalContext ? `\n${input.additionalContext}` : "",
      acceptsAll && transcript ? `\nSession transcript:\n${transcript}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await this.languageModel.generateObject<AiTaskResult>({
      purpose: "aiTask",
      userId: input.session.userId,
      flowId: input.flow.id,
      sessionId: input.session.id,
      system: config.instruction,
      prompt,
      schema: buildAiTaskResultSchema(
        config.structuredFields.map((field) => ({
          key: field.key,
          itemKeys: field.type === "group" ? (field.itemFields ?? []).map((item) => item.key) : undefined,
        })),
      ),
    });
    if (result.error) return result;
    return ok(result.data.object);
  }

  private async requestReview(
    input: RunAiTaskNodeInput,
    config: AiTaskNodeConfig,
    messageId: string,
    rationale: string,
  ): Promise<Result<string>> {
    const reviewerId = await this.resolveReviewer(config.reviewer, input.session.userId);

    const created = await this.approvals.create({
      sessionId: input.session.id,
      flowId: input.flow.id,
      nodeId: input.node.id,
      messageId,
      requestedByUserId: input.session.userId,
      approverSource: approverSourceFor(config.reviewer),
      suggestedApproverUserId: reviewerId,
      status: "pending",
      recordSnapshot: {
        [SUBJECT_DESCRIPTION_KEY]: `the result of the AI task "${input.node.name}"`,
        [SUBJECT_NODE_ID_KEY]: input.node.id,
      },
    });
    if (created.error) return created;

    // The reviewer is fixed by the step's config, so the request is confirmed
    // on the spot rather than waiting on an operator to pick someone.
    const confirmed = await this.confirmAndSend.execute({
      approvalId: created.data.id,
      approverUserId: reviewerId,
      isOverride: false,
      requestMessage: rationale,
    });
    if (confirmed.error) return confirmed;
    return ok(created.data.id);
  }

  // Never resolves to nobody: a supervisor or position that cannot be found
  // falls back to the run owner, who is accountable for the run anyway.
  private async resolveReviewer(reviewer: AiTaskReviewer, runOwnerId: string): Promise<string> {
    if (reviewer.mode === "run_owner") return runOwnerId;
    if (reviewer.mode === "user") return reviewer.userId;

    if (reviewer.approverSource === "dynamic") {
      const holders = await this.reportingLines.findPositionHolder({ role: reviewer.roleHint });
      if (holders.error) return runOwnerId;
      const withAccount = holders.data.filter((person) => person.userId);
      return withAccount.length === 1 ? withAccount[0]!.userId! : runOwnerId;
    }

    const level: 1 | 2 = reviewer.approverSource === "second_level_supervisor" ? 2 : 1;
    const suggestion = await this.reportingLines.suggest({ level, userId: runOwnerId });
    if (suggestion.error || "unresolved" in suggestion.data) return runOwnerId;
    return suggestion.data.suggestedApproverUserId;
  }
}
