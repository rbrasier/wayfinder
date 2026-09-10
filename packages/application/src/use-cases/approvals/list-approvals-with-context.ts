import {
  err,
  domainError,
  ok,
  type Approval,
  type ApprovalListScope,
  type ApprovalNodeConfig,
  type ApprovalStatus,
  type DocumentGenerationConfidence,
  type FlowNode,
  type IApprovalRepository,
  type IFlowNodeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUserRepository,
  type Result,
  type Session,
  type SessionDocument,
  type SessionStatus,
  type StepOutputField,
  type User,
} from "@wayfinder/domain";
import type { ResolveApprovalSubject } from "./resolve-approval-subject";

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

// Where the work stands *now*, as opposed to what was decided then. A decision
// is only half the story: an approver reviewing their own history needs to know
// whether the thing they signed went on to complete, was sent back, or was
// discarded.
export interface ApprovalSessionState {
  status: SessionStatus;
  currentStepName: string | null;
}

export interface PendingApprovalContext {
  approval: Approval;
  sessionId: string;
  chatName: string;
  originatorName: string | null;
  originatorEmail: string | null;
  previousStep: PreviousStepContext | null;
  // The statement of what is being approved, resolved from `approvalSubject`
  // (ADR-040 §2). Null only when the resolution itself failed.
  subjectDescription: string | null;
  // Which stage of the chain this is — the approval node's own name, and the
  // author's role steer where one was given. The queue shows both so an approver
  // knows whether they are the first or the second signature on this document.
  approvalStepName: string;
  roleHint: string | null;
  // Populated for a decided approval; null while it is still pending. Resolved
  // from the row, not the frozen record, so the queue and the history agree.
  decidedByName: string | null;
  sessionState: ApprovalSessionState;
}

export interface ListApprovalsWithContextInput {
  approverUserId: string;
  approverEmail: string | null;
  // Defaults to the pending queue, which is what `/approvals` showed before
  // history existed.
  scope?: ApprovalListScope;
}

export interface GetApprovalWithContextInput {
  approvalId: string;
  viewerUserId: string;
  viewerEmail: string | null;
  isAdmin: boolean;
}

// Enriches an approver's approvals with the context needed to decide, or to
// review a decision already made: the chat name, who raised it, the subject
// step's key output (the document, or its output fields), and where the session
// has since got to. The approval row stays the source of truth; every
// enrichment is best-effort so a missing session or lookup never drops the
// request from the list.
export class ListApprovalsWithContext {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly sessions: ISessionRepository,
    private readonly users: IUserRepository,
    private readonly messages: ISessionMessageRepository,
    private readonly stepOutputs: ISessionStepOutputRepository,
    private readonly flowNodes: IFlowNodeRepository,
    // The single resolver for what an approval is about. Sharing it with the
    // gate is what keeps the statement and the artefact from drifting apart —
    // splitting them is how `advancedFrom` came to be read for routing at all.
    private readonly approvalSubject: ResolveApprovalSubject,
  ) {}

  async execute(
    input: ListApprovalsWithContextInput,
  ): Promise<Result<PendingApprovalContext[]>> {
    const listed = await this.approvals.listForApprover({
      approverUserId: input.approverUserId,
      approverEmail: input.approverEmail,
      scope: input.scope ?? "pending",
    });
    if (listed.error) return listed;

    const contexts = await Promise.all(listed.data.map((approval) => this.buildContext(approval)));
    return ok(contexts);
  }

  // One approval, for its own page. Authorised here rather than at the edge
  // because the rule is about the approval, not the session: being named on
  // *an* approval of a session already opens the session (ADR-018), but a
  // decision record is only readable by the people it is about.
  async getById(input: GetApprovalWithContextInput): Promise<Result<PendingApprovalContext>> {
    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    const approval = found.data;
    if (!approval) return err(domainError("NOT_FOUND", "Approval not found."));

    if (!input.isAdmin && !this.viewerOwns(approval, input)) {
      return err(domainError("FORBIDDEN", "This approval was not addressed to you."));
    }

    return ok(await this.buildContext(approval));
  }

  private viewerOwns(approval: Approval, input: GetApprovalWithContextInput): boolean {
    if (approval.approverUserId === input.viewerUserId) return true;
    if (approval.decidedByUserId === input.viewerUserId) return true;
    const email = input.viewerEmail?.toLowerCase();
    return Boolean(email && approval.approverEmail?.toLowerCase() === email);
  }

  private async buildContext(approval: Approval): Promise<PendingApprovalContext> {
    const session = await this.findSession(approval.sessionId);
    const originator = await this.findUser(approval.requestedByUserId);
    const subject = await this.approvalSubject.execute({ approvalId: approval.id });
    const subjectNodeId = subject.error ? null : subject.data.subjectNodeId;
    const previousStep = subjectNodeId ? await this.resolveSubjectStep(approval, subjectNodeId) : null;
    const approvalNode = await this.findNode(approval.nodeId);
    const config = (approvalNode?.config ?? {}) as unknown as ApprovalNodeConfig;

    return {
      approval,
      sessionId: approval.sessionId,
      chatName: session?.title?.trim() || "Untitled chat",
      originatorName: originator?.name ?? null,
      originatorEmail: originator?.email ?? null,
      previousStep,
      subjectDescription: subject.error ? null : subject.data.description,
      approvalStepName: approvalNode?.name?.trim() || "Approval",
      roleHint: config.roleHint?.trim() || null,
      decidedByName: await this.decidedByName(approval.status, approval.decidedByUserId),
      sessionState: await this.resolveSessionState(session),
    };
  }

  private async decidedByName(
    status: ApprovalStatus,
    decidedByUserId: string | null,
  ): Promise<string | null> {
    if (status === "pending" || !decidedByUserId) return null;
    const decider = await this.findUser(decidedByUserId);
    if (!decider) return null;
    return decider.name?.trim() || decider.email;
  }

  private async resolveSessionState(session: Session | null): Promise<ApprovalSessionState> {
    // A session that cannot be read is reported as abandoned rather than
    // guessed as active: telling an approver their decision is still in flight
    // when it may not be is the worse error.
    if (!session) return { status: "abandoned", currentStepName: null };
    if (!session.currentNodeId) return { status: session.status, currentStepName: null };
    const node = await this.findNode(session.currentNodeId);
    return { status: session.status, currentStepName: node?.name?.trim() || null };
  }

  private async findNode(nodeId: string): Promise<FlowNode | null> {
    const result = await this.flowNodes.findById(nodeId);
    return result.error ? null : result.data;
  }

  private async findSession(sessionId: string): Promise<Session | null> {
    const result = await this.sessions.findById(sessionId);
    return result.error ? null : result.data;
  }

  private async findUser(userId: string): Promise<User | null> {
    const result = await this.users.findById(userId);
    return result.error ? null : result.data;
  }

  // Resolved from the approval's subject, never from `advancedFrom`: with two
  // approvals in sequence that back-pointer names the previous *approval*, so
  // the second approver would be shown a decision instead of the document
  // (ADR-040 §2). The document is looked up now, not at raise time, so an
  // earlier approval's signature is already on the revision returned.
  private async resolveSubjectStep(
    approval: Approval,
    subjectNodeId: string,
  ): Promise<PreviousStepContext | null> {
    const stepName = await this.resolveNodeName(subjectNodeId);

    const document = await this.resolvePreviousDocument(approval.sessionId, subjectNodeId);
    if (document) {
      return { nodeId: subjectNodeId, stepName, document, fields: null };
    }

    const fields = await this.resolvePreviousFields(approval.sessionId, subjectNodeId);
    return { nodeId: subjectNodeId, stepName, document: null, fields };
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
