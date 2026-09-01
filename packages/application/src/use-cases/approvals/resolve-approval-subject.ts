import {
  approvalSubjectOf,
  domainError,
  err,
  lastCompletedNodeId,
  ok,
  type Approval,
  type ApprovalNodeConfig,
  type FlowNode,
  type CompletedStep,
  type FlowNodeType,
  type IApprovalRepository,
  type IFlowNodeRepository,
  type ILanguageModel,
  type ISessionMessageRepository,
  type ISessionStepOutputRepository,
  type Result,
  type SessionStepOutput,
  type StepOutputField,
} from "@rbrasier/domain";
import { SUBJECT_DESCRIPTION_KEY, SUBJECT_NODE_ID_KEY } from "./approval-record-keys";

export interface ResolveApprovalSubjectInput {
  approvalId: string;
}

export interface ResolvedApprovalSubject {
  // The human-readable statement, phrased to follow "You are requesting approval
  // of: …" at the gate and in the approver's request.
  description: string;
  // The step the subject points at, or null for a custom instruction.
  subjectNodeId: string | null;
  // The referenced step's captured output, so the gate can show the values the
  // statement refers to. Null for the custom case.
  snapshot: StepOutputField[] | null;
}

// Resolves what an approval is asking to be approved (ADR-040 §2). Runs once per
// approval: the resolved statement is cached on the pending row, so a custom
// subject costs exactly one model call however many times the gate is rendered,
// and a decided approval always reports the subject it locked.
export class ResolveApprovalSubject {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly languageModel?: ILanguageModel,
  ) {}

  async execute(input: ResolveApprovalSubjectInput): Promise<Result<ResolvedApprovalSubject>> {
    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    const approval = found.data;
    if (!approval) {
      return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));
    }

    const cached = this.cachedSubject(approval);
    if (cached) return ok(cached);

    const resolved = await this.resolve(approval);
    if (resolved.error) return resolved;

    await this.cache(approval, resolved.data);
    return resolved;
  }

  private cachedSubject(approval: Approval): ResolvedApprovalSubject | null {
    const snapshot = approval.recordSnapshot;
    const description = snapshot?.[SUBJECT_DESCRIPTION_KEY];
    if (typeof description !== "string" || description.length === 0) return null;

    const nodeId = snapshot?.[SUBJECT_NODE_ID_KEY];
    return {
      description,
      subjectNodeId: typeof nodeId === "string" ? nodeId : null,
      snapshot: null,
    };
  }

  private async resolve(approval: Approval): Promise<Result<ResolvedApprovalSubject>> {
    const nodesResult = await this.flowNodes.listByFlow(approval.flowId);
    if (nodesResult.error) return nodesResult;
    const nodes = nodesResult.data;

    const approvalNode = nodes.find((node) => node.id === approval.nodeId);
    const config = (approvalNode?.config ?? {}) as unknown as ApprovalNodeConfig;
    const subject = approvalSubjectOf(config);

    const outputsResult = await this.sessionStepOutputs.listBySession(approval.sessionId);
    if (outputsResult.error) return outputsResult;
    const outputs = outputsResult.data;

    if (subject.kind === "custom") {
      return ok(await this.resolveCustom(approval, subject.instruction, outputs));
    }

    const completed = await this.completedSteps(approval.sessionId, outputs);
    return ok(this.resolveStep(approval, subject.nodeId ?? null, nodes, outputs, completed));
  }

  // A step is "completed" if it produced captured output or posted a message
  // against its node. Both are needed: an unstructured conversational step
  // captures no output fields, and a step output is what carries the snapshot.
  private async completedSteps(
    sessionId: string,
    outputs: SessionStepOutput[],
  ): Promise<CompletedStep[]> {
    const fromOutputs = outputs.map((output) => ({
      nodeId: output.nodeId,
      createdAt: output.createdAt,
    }));

    const messagesResult = await this.sessionMessages.listBySession(sessionId);
    if (messagesResult.error) return fromOutputs;

    const fromMessages = messagesResult.data
      .filter((message) => message.stepNodeId)
      .map((message) => ({ nodeId: message.stepNodeId!, createdAt: message.createdAt }));

    return [...fromOutputs, ...fromMessages];
  }

  private resolveStep(
    approval: Approval,
    configuredNodeId: string | null,
    nodes: FlowNode[],
    outputs: SessionStepOutput[],
    completed: CompletedStep[],
  ): ResolvedApprovalSubject {
    const nodeTypes = new Map<string, FlowNodeType>(nodes.map((node) => [node.id, node.type]));
    const nodeId = configuredNodeId ?? lastCompletedNodeId(completed, nodeTypes, approval.nodeId);
    if (!nodeId) {
      return {
        description: "the work completed in this session so far",
        subjectNodeId: null,
        snapshot: null,
      };
    }

    const stepName = nodes.find((node) => node.id === nodeId)?.name?.trim() || "an earlier step";
    return {
      description: `the output of the step "${stepName}"`,
      subjectNodeId: nodeId,
      snapshot: this.latestFields(outputs, nodeId),
    };
  }

  // One model call, summarising the author's instruction against what the
  // session has gathered. A model failure degrades to the instruction itself
  // rather than blocking the gate — an approval without a polished sentence is
  // still an approval, and the fallback is never silently cached as if it were
  // the summary.
  private async resolveCustom(
    approval: Approval,
    instruction: string,
    outputs: SessionStepOutput[],
  ): Promise<ResolvedApprovalSubject> {
    const fallback = {
      description: instruction,
      subjectNodeId: null,
      snapshot: null,
    };
    if (!this.languageModel) return fallback;

    const gathered = this.gatheredText(outputs);
    const result = await this.languageModel.generateText({
      purpose: "branching",
      userId: approval.requestedByUserId,
      sessionId: approval.sessionId,
      flowId: approval.flowId,
      system:
        "You state what an approver is being asked to approve, in one sentence, as a noun phrase that completes the line \"You are requesting approval of: …\". Use only the information given. Do not add a preamble, a decision or a recommendation.",
      prompt: [
        `The flow author described the subject as: ${instruction}`,
        "Information gathered in this session so far:",
        gathered || "(nothing has been captured yet)",
      ].join("\n\n"),
    });
    if (result.error) return fallback;

    const summary = result.data.text.trim();
    return summary ? { description: summary, subjectNodeId: null, snapshot: null } : fallback;
  }

  private gatheredText(outputs: SessionStepOutput[]): string {
    return outputs
      .flatMap((output) => output.fields)
      .filter((field) => field.value.trim().length > 0)
      .map((field) => `- ${field.label}: ${field.value}`)
      .join("\n")
      .slice(0, 4000);
  }

  private latestFields(outputs: SessionStepOutput[], nodeId: string): StepOutputField[] | null {
    const latest = outputs
      .filter((output) => output.nodeId === nodeId)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];
    return latest ? latest.fields : null;
  }

  // Cached on the pending row so the gate, the request and the email all read
  // the same sentence. Best-effort: a write failure costs a recomputation, never
  // the gate.
  private async cache(approval: Approval, subject: ResolvedApprovalSubject): Promise<void> {
    await this.approvals.update(approval.id, {
      recordSnapshot: {
        ...(approval.recordSnapshot ?? {}),
        [SUBJECT_DESCRIPTION_KEY]: subject.description,
        [SUBJECT_NODE_ID_KEY]: subject.subjectNodeId,
      },
    });
  }
}
