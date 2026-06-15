import {
  ok,
  type Approval,
  type DocumentGenerationConfidence,
  type IApprovalRepository,
  type IFlowNodeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUserRepository,
  type Result,
  type Session,
  type SessionDocument,
  type StepOutputField,
  type User,
} from "@rbrasier/domain";

export interface PreviousStepDocument {
  messageId: string;
  document: SessionDocument;
  documentGenerationConfidence: DocumentGenerationConfidence | null;
}

// The key output the approver is signing off on. Exactly one of `document` /
// `fields` is populated — a document step shows the same card as the chat, any
// other step shows its captured output fields.
export interface PreviousStepContext {
  nodeId: string;
  stepName: string;
  document: PreviousStepDocument | null;
  fields: StepOutputField[] | null;
}

export interface PendingApprovalContext {
  approval: Approval;
  sessionId: string;
  chatName: string;
  originatorName: string | null;
  originatorEmail: string | null;
  previousStep: PreviousStepContext | null;
}

export interface ListPendingApprovalsWithContextInput {
  approverUserId: string;
  approverEmail: string | null;
}

// Enriches the approver's pending queue with the context needed to decide:
// the chat name, who raised it, and the previous step's key output (the
// document, or its output fields). The approval row stays the source of truth;
// every enrichment is best-effort so a missing session or lookup never drops the
// pending request from the list.
export class ListPendingApprovalsWithContext {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly sessions: ISessionRepository,
    private readonly users: IUserRepository,
    private readonly messages: ISessionMessageRepository,
    private readonly stepOutputs: ISessionStepOutputRepository,
    private readonly flowNodes: IFlowNodeRepository,
  ) {}

  async execute(
    input: ListPendingApprovalsWithContextInput,
  ): Promise<Result<PendingApprovalContext[]>> {
    const pending = await this.approvals.listPendingForApprover(input);
    if (pending.error) return pending;

    const contexts = await Promise.all(pending.data.map((approval) => this.buildContext(approval)));
    return ok(contexts);
  }

  private async buildContext(approval: Approval): Promise<PendingApprovalContext> {
    const session = await this.findSession(approval.sessionId);
    const originator = await this.findUser(approval.requestedByUserId);
    const previousStep = session ? await this.resolvePreviousStep(approval, session) : null;

    return {
      approval,
      sessionId: approval.sessionId,
      chatName: session?.title?.trim() || "Untitled chat",
      originatorName: originator?.name ?? null,
      originatorEmail: originator?.email ?? null,
      previousStep,
    };
  }

  private async findSession(sessionId: string): Promise<Session | null> {
    const result = await this.sessions.findById(sessionId);
    return result.error ? null : result.data;
  }

  private async findUser(userId: string): Promise<User | null> {
    const result = await this.users.findById(userId);
    return result.error ? null : result.data;
  }

  private async resolvePreviousStep(
    approval: Approval,
    session: Session,
  ): Promise<PreviousStepContext | null> {
    const previousNodeId = this.previousNodeId(session);
    if (!previousNodeId) return null;

    const stepName = await this.resolveNodeName(previousNodeId);

    const document = await this.resolvePreviousDocument(approval.sessionId, previousNodeId);
    if (document) {
      return { nodeId: previousNodeId, stepName, document, fields: null };
    }

    const fields = await this.resolvePreviousFields(approval.sessionId, previousNodeId);
    return { nodeId: previousNodeId, stepName, document: null, fields };
  }

  // The node the session advanced from when it parked on the approval — the same
  // checkpoint field DecideApproval uses to route a rejection back.
  private previousNodeId(session: Session): string | null {
    const value = session.graphCheckpoint?.["advancedFrom"];
    return typeof value === "string" ? value : null;
  }

  private async resolveNodeName(nodeId: string): Promise<string> {
    const result = await this.flowNodes.findById(nodeId);
    if (result.error || !result.data) return "Previous step";
    return result.data.name?.trim() || "Previous step";
  }

  private async resolvePreviousDocument(
    sessionId: string,
    nodeId: string,
  ): Promise<PreviousStepDocument | null> {
    const result = await this.messages.listBySession(sessionId);
    if (result.error) return null;

    const latest = result.data
      .filter((message) => message.stepNodeId === nodeId && message.document)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];
    if (!latest || !latest.document) return null;

    return {
      messageId: latest.id,
      document: latest.document,
      documentGenerationConfidence: latest.aiPayload?.documentGenerationConfidence ?? null,
    };
  }

  private async resolvePreviousFields(
    sessionId: string,
    nodeId: string,
  ): Promise<StepOutputField[] | null> {
    const result = await this.stepOutputs.listBySession(sessionId);
    if (result.error) return null;

    const latest = result.data
      .filter((output) => output.nodeId === nodeId)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];
    return latest ? latest.fields : null;
  }
}
