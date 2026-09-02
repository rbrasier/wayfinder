import {
  APPROVAL_PROJECTION_FIELDS,
  buildApprovalDecisionMessage,
  buildApprovalRecord,
  buildAttestationBlock,
  changesRequestedTargetOf,
  deriveStepKeys,
  nearestEditableNodeId,
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalDecision,
  type ApprovalNodeConfig,
  type ApprovalStatus,
  type CompletedStep,
  type FlowNode,
  type FlowNodeType,
  type IApprovalRepository,
  type IAuditLogger,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUnitOfWork,
  type IUserRepository,
  type OffSystemApprovalEvidence,
  type Result,
  type Sha256Hex,
  type StepOutputField,
  type TransactionalRepositories,
} from "@rbrasier/domain";
import type { IApprovalDecidedNotifier } from "../notifications/notify-on-approval-decided";
import type { ApplyApprovalSignature } from "./apply-approval-signature";
import {
  ATTESTATION_TEXT_KEY,
  SIGNATURE_FIELD_KEY,
  STEP_KEY,
  SUBJECT_DESCRIPTION_KEY,
  SUBJECT_NODE_ID_KEY,
} from "./approval-record-keys";
import type { ResolveApprovalSubject } from "./resolve-approval-subject";
import { loneSignatureSlot } from "./signature-slot";

// A decision that happened outside Wayfinder, being recorded by someone other
// than the approver (ADR-055). Its presence is what switches the four
// behaviours below: who is authorised, who is recorded as deciding, whether the
// approver-edit scan runs, and what is frozen.
export interface OffSystemNomination {
  // Who is entering it. Authorised as the nominator, never as the decider.
  nominatedByUserId: string;
  // The calendar date the approval happened, as `YYYY-MM-DD`. Validated by
  // `RecordOffSystemApproval` against the session it belongs to.
  approvedOn: string;
  evidence: OffSystemApprovalEvidence;
}

export interface DecideApprovalInput {
  approvalId: string;
  decidedByUserId: string;
  decision: ApprovalDecision;
  comment?: string | null;
  // Only meaningful for `rejected`: true routes the session back to the
  // originator, false (or missing) cancels it. `changes_requested` always routes
  // back; `approved` ignores it.
  routeBack?: boolean;
  // The tRPC layer sets this for admins so they can act on behalf of an approver.
  isAdmin?: boolean;
  // Set only by `RecordOffSystemApproval`. Never reachable from the ordinary
  // decide mutation, whose input schema has no such field — and even if it
  // were, the authorisation branch below is the gate, not the caller.
  offSystem?: OffSystemNomination;
}

export interface DecideApprovalOutput {
  approval: Approval;
  advanced: boolean;
  newNodeId: string | null;
  sessionCompleted: boolean;
}

// A projected decision field. The label comes from the shared definition rather
// than the call site, so the report's column headings and the keys underneath
// them can never drift apart.
const field = (key: string, value: string): StepOutputField => ({
  key,
  label: APPROVAL_PROJECTION_FIELDS.find((definition) => definition.key === key)?.label ?? key,
  type: "text",
  value,
});

const readRecordString = (
  record: Record<string, unknown> | null,
  key: string,
): string | null => {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

// Derived, never selected. Only an approval earns the widened status; a
// rejection or change request records the decision the approver chose.
const derivedStatus = (decision: ApprovalDecision, editsMade: boolean): ApprovalStatus =>
  decision === "approved" && editsMade ? "approved_with_edits" : decision;

// The record key prefix for this approval node. Derived across the flow's whole
// approval set so two steps sharing a label get distinct keys, and derived from
// the label so the prefix reads as the step name in a report (ADR-040 §5).
const approvalStepKey = (nodes: FlowNode[], nodeId: string): string => {
  const approvalNodes = [...nodes]
    .filter((node) => node.type === "approval")
    .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
  const keys = deriveStepKeys(approvalNodes.map((node) => node.name));
  const index = approvalNodes.findIndex((node) => node.id === nodeId);
  return index >= 0 ? keys[index]! : "approval";
};

// The approver as the record will remember them. Resolved once per decision and
// shared by the frozen record and the thread message.
interface ApproverIdentity {
  name: string | null;
  email: string | null;
  role: string | null;
}

// What the approval is about, resolved once per decision.
interface ResolvedSubject {
  description: string | null;
  nodeId: string | null;
  signatureFieldKey: string | null;
}

// A committed decision plus how the chat and notification side effects should
// describe it. Produced inside the transaction, consumed after it commits.
interface DecisionEffect {
  output: DecideApprovalOutput;
  routedBack: boolean;
  // Set when a change request could not resolve a step to return to. The
  // decision still stands and the session is held, not cancelled — the message
  // tells the operator why nothing moved.
  routingError?: string;
}

// Records an approver's decision. Approve snapshots the step outputs and advances
// the session; reject / changes-requested surface the comment and hold. The
// outcome is projected onto the node's step-output metadata for reporting.
export class DecideApproval {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly approvals: IApprovalRepository,
    private readonly sessions: ISessionRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly notifier?: IApprovalDecidedNotifier,
    private readonly messages?: ISessionMessageRepository,
    // Needed to authorise decisions on email-assigned approvals — the decider's
    // account email must match the assigned address, and to copy the approver's
    // identity into the record rather than joining it at read time.
    private readonly users?: IUserRepository,
    // The record-building dependencies. Optional so the decision path still
    // works unwired: an approval that records no subject or signature is worse
    // than one that does, but losing the decision itself would be worse again.
    private readonly flowNodes?: IFlowNodeRepository,
    private readonly sha256Hex?: Sha256Hex,
    private readonly approvalSubject?: ResolveApprovalSubject,
    private readonly applySignature?: ApplyApprovalSignature,
  ) {}

  async execute(input: DecideApprovalInput): Promise<Result<DecideApprovalOutput>> {
    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    const approval = found.data;
    if (!approval) {
      return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));
    }
    if (approval.status !== "pending") {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }
    if (!(await this.isAuthorisedDecider(approval, input))) {
      return err(domainError("FORBIDDEN", "Only the confirmed approver can decide this."));
    }

    const decidedAt = new Date();
    // Resolved once: the record, the attestation and the edit derivation all
    // need the same subject, and a second resolution could disagree with the
    // first if the session moved between them.
    const subject = await this.resolveSubject(approval);
    // Likewise resolved once and threaded through, so the frozen record and the
    // message in the thread can never name the approver differently.
    const approver = await this.approverIdentity(
      this.recordedDeciderId(approval, input),
      input.offSystem ? approval.approverEmail : null,
    );
    const edits = await this.approverEdits(approval, input, subject.nodeId);
    const status = derivedStatus(input.decision, edits.length > 0);
    const recordSnapshot = await this.buildRecord({
      approval,
      input,
      decidedAt,
      status,
      editedFieldKeys: edits,
      subject,
      approver,
    });

    // The concurrency-gated approval update and the session advance/route commit
    // together: a crash between them must never leave a decided approval sitting
    // on a session that never moved. The best-effort projection, audit, chat
    // message and notification run only after the commit succeeds, so a
    // rolled-back decision leaves no trace of its side effects.
    const effect = await this.unitOfWork.withTransaction((repositories) =>
      this.decideWithin(repositories, approval, input, decidedAt, recordSnapshot, status),
    );
    if (effect.error) return effect;

    const { output, routedBack, routingError } = effect.data;
    const decided = output.approval;

    await this.projectDecision(decided, decidedAt);
    await this.auditLogger.log({
      actorId: input.decidedByUserId,
      action: "approval.decided",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: {
        decision: input.decision,
        comment: input.comment ?? null,
        // Present only on a nomination, so the decision trail shows how the
        // approval arrived without every ordinary entry carrying empty keys.
        ...(input.offSystem
          ? {
              offSystemApprovedOn: input.offSystem.approvedOn,
              offSystemNominatedByUserId: input.offSystem.nominatedByUserId,
              offSystemEvidenceFilename: input.offSystem.evidence.filename,
            }
          : {}),
      },
    });
    await this.recordDecisionMessage(
      decided,
      approver,
      decidedAt,
      routedBack,
      routingError,
      input.offSystem?.nominatedByUserId ?? null,
    );
    await this.writeSignature(decided);
    this.notify(decided, input.decision, routedBack);

    return ok(output);
  }

  // The decision is already committed and the record already frozen, so a
  // storage failure here loses a re-render, not an approval (ADR-043 §6). It is
  // a retryable follow-up: the attestation lives in the record and can be
  // written into the document again.
  private async writeSignature(approval: Approval): Promise<void> {
    if (!this.applySignature) return;
    try {
      await this.applySignature.execute({ approvalId: approval.id });
    } catch {
      // Ignore — the approval row remains the source of truth.
    }
  }

  // The record frozen at decision time (ADR-040 §3). Every decided approval gets
  // the five guaranteed keys prefixed by its step key; an approval carrying a
  // signature slot also gets the rendered attestation, stored rather than
  // recomputed so a later change around it can never alter what was signed.
  private async buildRecord(parts: {
    approval: Approval;
    input: DecideApprovalInput;
    decidedAt: Date;
    status: ApprovalStatus;
    editedFieldKeys: string[];
    subject: ResolvedSubject;
    approver: ApproverIdentity;
  }): Promise<Record<string, unknown> | null> {
    const { approval, input, decidedAt, status, editedFieldKeys, subject, approver } = parts;
    const existing = approval.recordSnapshot ?? {};
    const stepOutputs =
      input.decision === "approved" ? await this.snapshot(approval.sessionId) : null;

    const nodes = await this.flowNodesOfFlow(approval.flowId);
    const stepKey = approvalStepKey(nodes, approval.nodeId);

    const record: Record<string, unknown> = {
      ...existing,
      ...(stepOutputs ?? {}),
      [STEP_KEY]: stepKey,
      ...buildApprovalRecord({
        stepKey,
        // The recorded status, so a reader filtering for "approved but changed
        // by the approver" tests one key rather than reconstructing it.
        decision: status,
        approverName: approver.name,
        approverEmail: approver.email,
        decidedAt,
        comment: input.comment ?? null,
        subjectDescription: subject.description,
        subjectNodeId: subject.nodeId,
        editsMade: editedFieldKeys.length > 0,
        ...(editedFieldKeys.length > 0 ? { editedFieldKeys } : {}),
        ...(subject.signatureFieldKey ? { signatureFieldKey: subject.signatureFieldKey } : {}),
        ...(input.offSystem
          ? {
              offSystemApprovedOn: input.offSystem.approvedOn,
              offSystemEvidenceFilename: input.offSystem.evidence.filename,
              // Kept beside `decided_at`, which is the same instant here but
              // will not stay so if the two ever diverge. The document shows
              // when it was approved; the record shows when the system learned.
              recordedAt: decidedAt,
            }
          : {}),
      }),
    };

    if (!subject.signatureFieldKey || !this.sha256Hex) return record;

    const attestation = buildAttestationBlock(
      {
        approvalId: approval.id,
        sessionId: approval.sessionId,
        nodeId: approval.nodeId,
        approverName: approver.name,
        approverEmail: approver.email,
        approverRole: approver.role,
        // The block names what was recorded, so a document signed by an approver
        // who also edited it says so on its face.
        decision: status,
        decidedAt,
        comment: input.comment ?? null,
        subjectDescription: subject.description,
        offSystemApprovedOn: input.offSystem?.approvedOn ?? null,
      },
      this.sha256Hex,
    );

    return {
      ...record,
      [SIGNATURE_FIELD_KEY]: subject.signatureFieldKey,
      [ATTESTATION_TEXT_KEY]: attestation.text,
      [`${stepKey}.verification_code`]: attestation.verificationCode,
    };
  }

  // The field keys *this* approver changed on *their own* subject step during
  // *their* pending window. Edits by the originator before the request, or by a
  // different approver, do not qualify — the status answers "did the person who
  // signed this also change it", and nothing else (ADR-045 §4).
  private async approverEdits(
    approval: Approval,
    input: DecideApprovalInput,
    subjectNodeId: string | null,
  ): Promise<string[]> {
    // A nomination's edits belong to the nominator, not the approver. Deriving
    // the status here would attribute someone else's changes to the person
    // whose name goes on the signature — the exact misattribution ADR-045
    // exists to prevent (ADR-055 §5).
    if (input.offSystem) return [];
    if (input.decision !== "approved" || !this.messages || !subjectNodeId) return [];

    const messages = await this.messages.listBySession(approval.sessionId);
    if (messages.error) return [];

    const latest = messages.data
      .filter((message) => message.stepNodeId === subjectNodeId && message.document)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];
    if (!latest?.document?.editHistory) return [];

    const keys = new Set<string>();
    for (const edit of latest.document.editHistory) {
      if (edit.editedByUserId !== input.decidedByUserId) continue;
      // The pending window opened when the row was raised. An earlier edit by
      // the same person was made as an ordinary participant, not as the
      // approver, so it does not earn the status.
      if (new Date(edit.editedAt) < approval.createdAt) continue;
      for (const change of edit.changes) keys.add(change.key);
    }
    return [...keys];
  }

  private async flowNodesOfFlow(flowId: string): Promise<FlowNode[]> {
    if (!this.flowNodes) return [];
    const result = await this.flowNodes.listByFlow(flowId);
    return result.error ? [] : result.data;
  }

  // Who the row will name as having decided. Ordinarily the caller; on an
  // off-system nomination the *assigned approver*, because they are who
  // approved — null when the assignment is still email-only and no account has
  // claimed it (ADR-055 §2).
  private recordedDeciderId(approval: Approval, input: DecideApprovalInput): string | null {
    return input.offSystem ? approval.approverUserId : input.decidedByUserId;
  }

  // Copied in, never joined at read time: a later rename, an email change or a
  // deleted account must not alter what the record says was true (ADR-040 §5).
  //
  // An off-system nomination with no account behind the assignment still has an
  // address, and a block reading "Unknown approver" over a filed memo would be
  // worse than one naming the address the request was sent to.
  private async approverIdentity(
    userId: string | null,
    fallbackEmail: string | null,
  ): Promise<ApproverIdentity> {
    const unknown: ApproverIdentity = { name: null, email: fallbackEmail, role: null };
    if (!userId || !this.users) return unknown;
    const result = await this.users.findById(userId);
    if (result.error || !result.data) return unknown;
    return {
      name: result.data.name,
      email: result.data.email,
      role: result.data.role,
    };
  }

  private async resolveSubject(approval: Approval): Promise<ResolvedSubject> {
    const existing = approval.recordSnapshot ?? {};
    const resolved = this.approvalSubject
      ? await this.approvalSubject.execute({ approvalId: approval.id })
      : null;

    const description =
      resolved && !resolved.error
        ? resolved.data.description
        : stringOrNull(existing[SUBJECT_DESCRIPTION_KEY]);
    const nodeId =
      resolved && !resolved.error
        ? resolved.data.subjectNodeId
        : stringOrNull(existing[SUBJECT_NODE_ID_KEY]);

    const nodes = await this.flowNodesOfFlow(approval.flowId);
    const config = (nodes.find((node) => node.id === approval.nodeId)?.config ??
      {}) as unknown as ApprovalNodeConfig;

    const signatureFieldKey =
      config.signatureFieldKey ?? loneSignatureSlot(nodes, nodeId);
    return { description, nodeId, signatureFieldKey };
  }

  // The atomic core: the pending-guard update and the session write share one
  // transaction. A null from `updateIfPending` means a concurrent decider won
  // the race, so the whole transaction fails and no side effects run.
  private async decideWithin(
    repositories: TransactionalRepositories,
    approval: Approval,
    input: DecideApprovalInput,
    decidedAt: Date,
    recordSnapshot: Record<string, unknown> | null,
    status: ApprovalStatus,
  ): Promise<Result<DecisionEffect>> {
    const updated = await repositories.approvals.updateIfPending(approval.id, {
      // The one place the recorded status can differ from the chosen decision.
      // Everything downstream still branches on `input.decision`, which keeps
      // its three values, so nothing about advancement changes.
      status,
      decidedByUserId: this.recordedDeciderId(approval, input),
      decidedAt,
      comment: input.comment ?? null,
      recordSnapshot,
      // Written in the same guarded patch as the decision, so a nomination that
      // loses the race to a real decider leaves no evidence columns behind on a
      // row somebody else decided (ADR-055 §1).
      ...(input.offSystem
        ? {
            offSystemApprovedOn: input.offSystem.approvedOn,
            offSystemEvidence: input.offSystem.evidence,
            offSystemNominatedByUserId: input.offSystem.nominatedByUserId,
          }
        : {}),
    });
    if (updated.error) return updated;
    if (!updated.data) {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }
    const decided = updated.data;

    if (input.decision === "approved") {
      return this.advance(repositories, decided);
    }
    return this.routeBackOrCancel(repositories, decided, input);
  }

  // Approve/reject is gated to the assigned approver (or an admin). A user-id
  // assignment matches on id; an email-only assignment (ADR-018, before the
  // recipient has claimed an account) matches on the decider's account email.
  // With no assignment there is no one to match, so only an admin may decide.
  //
  // An off-system nomination is authorised on a different question entirely —
  // it is checked here rather than in the calling use case so that supplying
  // `offSystem` can never be a way past a gate (ADR-055 §3).
  private async isAuthorisedDecider(
    approval: Approval,
    input: DecideApprovalInput,
  ): Promise<boolean> {
    if (input.isAdmin) return true;
    if (input.offSystem) return this.isAuthorisedNominator(approval, input.offSystem);
    if (approval.approverUserId) return approval.approverUserId === input.decidedByUserId;
    if (approval.approverEmail) {
      return this.deciderEmailMatches(input.decidedByUserId, approval.approverEmail);
    }
    return false;
  }

  // The session owner or the person who raised the request. On a chained
  // approval the requester is the *previous approver*, who nominated this signer
  // and holds the correspondence; the owner is whoever is watching the chat
  // stall. The assigned approver is deliberately absent: someone present enough
  // to press a button should press Approve, which records a stronger fact.
  private async isAuthorisedNominator(
    approval: Approval,
    offSystem: OffSystemNomination,
  ): Promise<boolean> {
    if (offSystem.nominatedByUserId === approval.requestedByUserId) return true;
    const found = await this.sessions.findById(approval.sessionId);
    if (found.error || !found.data) return false;
    return found.data.userId === offSystem.nominatedByUserId;
  }

  private async deciderEmailMatches(userId: string, approverEmail: string): Promise<boolean> {
    if (!this.users) return false;
    const found = await this.users.findById(userId);
    if (found.error || !found.data) return false;
    return found.data.email.toLowerCase() === approverEmail.toLowerCase();
  }

  private notify(approval: Approval, decision: ApprovalDecision, routedBack: boolean): void {
    void this.notifier?.execute({ approval, decision, routedBack }).catch(() => undefined);
  }

  // Surfaces the decision and its reason in the chat thread so everyone with the
  // session open sees the outcome. Best-effort — a message-write failure must not
  // fail the decision, mirroring the projection above.
  //
  // Written as the approver's own message, not a system aside. Two things follow
  // from that, and both are the point: the thread shows it as theirs rather than
  // the assistant's, and their comment joins the transcript the next turn reasons
  // over — so "start on Monday the 3rd" reaches the step that has to act on it
  // instead of being narrated past. It also means a decision leaves no system
  // row mid-conversation, which is what several providers reject outright.
  private async recordDecisionMessage(
    approval: Approval,
    approver: ApproverIdentity,
    decidedAt: Date,
    routedBack: boolean,
    routingError?: string,
    // Set on a nomination. The message is posted as the person who actually
    // typed it, while its text still attributes the decision to the approver —
    // the thread should not show the approver writing something they did not.
    nominatedByUserId: string | null = null,
  ): Promise<void> {
    if (!this.messages) return;
    const content = buildApprovalDecisionMessage({
      status: approval.status,
      approverName: approver.name,
      approverEmail: approver.email,
      decidedAt: approval.decidedAt ?? decidedAt,
      comment: approval.comment,
      routedBack,
      routingError: routingError ?? null,
      offSystemApprovedOn: approval.offSystemApprovedOn,
    });
    try {
      await this.messages.create({
        sessionId: approval.sessionId,
        role: "user",
        content,
        senderUserId: nominatedByUserId ?? approval.decidedByUserId,
        stepNodeId: approval.nodeId,
      });
    } catch {
      // Ignore — the approval row remains the source of truth.
    }
  }

  // `changes_requested` always routes back; `rejected` routes back only when the
  // approver chose to. Cancelling is reachable from exactly one place — an
  // explicit reject-and-close — because a session that cannot resolve a return
  // target has a routing gap, and turning a routing gap into data loss is what
  // this method used to do (ADR-044 §3).
  private async routeBackOrCancel(
    repositories: TransactionalRepositories,
    approval: Approval,
    input: DecideApprovalInput,
  ): Promise<Result<DecisionEffect>> {
    const sessionResult = await this.sessions.findById(approval.sessionId);
    if (sessionResult.error) return sessionResult;
    const session = sessionResult.data;
    if (!session) {
      return err(domainError("NOT_FOUND", `Session ${approval.sessionId} not found.`));
    }

    const shouldRouteBack = input.decision === "changes_requested" || input.routeBack === true;
    if (!shouldRouteBack) {
      const cancelled = await repositories.sessions.update(session.id, { status: "cancelled" });
      if (cancelled.error) return cancelled;
      return ok({
        output: { approval, advanced: false, newNodeId: null, sessionCompleted: true },
        routedBack: false,
      });
    }

    const targetNodeId = await this.returnTarget(approval);
    if (!targetNodeId) {
      // Held, not cancelled. The session stays on the approval node with the
      // problem named in the thread, so an author can fix the flow and the work
      // survives.
      return ok({
        output: { approval, advanced: false, newNodeId: null, sessionCompleted: false },
        routedBack: true,
        routingError:
          "The approver asked for changes, but this approval step has no step to return to. Set \"On changes requested, return to\" on the approval step.",
      });
    }

    const moved = await repositories.sessions.update(session.id, {
      currentNodeId: targetNodeId,
      // Records the approval node that sent the work back, rather than null.
      // The checkpoint keeps describing the last real transition, so a second
      // change request has a coherent graph to reason about (ADR-044 §4).
      graphCheckpoint: { currentNodeId: targetNodeId, advancedFrom: approval.nodeId },
    });
    if (moved.error) return moved;
    return ok({
      output: { approval, advanced: true, newNodeId: targetNodeId, sessionCompleted: false },
      routedBack: true,
    });
  }

  // Where work resumes: the step the author named, or the nearest prior step an
  // operator can actually change. Never `advancedFrom` — with two approvals in
  // sequence that names the previous *approval*, a node with nothing to edit.
  private async returnTarget(approval: Approval): Promise<string | null> {
    const nodes = await this.flowNodesOfFlow(approval.flowId);
    const config = (nodes.find((node) => node.id === approval.nodeId)?.config ??
      {}) as unknown as ApprovalNodeConfig;
    const target = changesRequestedTargetOf(config);

    if (target.kind === "step") {
      // A named node that has since been deleted resolves to nothing, which
      // holds the session rather than routing it somewhere arbitrary.
      return nodes.some((node) => node.id === target.nodeId) ? target.nodeId : null;
    }

    const completed = await this.completedSteps(approval.sessionId);
    const nodeTypes = new Map<string, FlowNodeType>(nodes.map((node) => [node.id, node.type]));
    return nearestEditableNodeId(completed, nodeTypes, approval.nodeId);
  }

  // The same taken-path input the subject resolver uses, so "last completed
  // step" and `nearest_editable` cannot come to disagree about what ran.
  private async completedSteps(sessionId: string): Promise<CompletedStep[]> {
    const outputs = await this.sessionStepOutputs.listBySession(sessionId);
    const fromOutputs = outputs.error
      ? []
      : outputs.data.map((output) => ({ nodeId: output.nodeId, createdAt: output.createdAt }));

    if (!this.messages) return fromOutputs;
    const messages = await this.messages.listBySession(sessionId);
    if (messages.error) return fromOutputs;

    return [
      ...fromOutputs,
      ...messages.data
        .filter((message) => message.stepNodeId)
        .map((message) => ({ nodeId: message.stepNodeId!, createdAt: message.createdAt })),
    ];
  }

  private async snapshot(sessionId: string): Promise<Record<string, unknown> | null> {
    const outputs = await this.sessionStepOutputs.listBySession(sessionId);
    if (outputs.error) return null;
    return { stepOutputs: outputs.data };
  }

  // Best-effort denormalised projection — the approval row stays the source of
  // truth, so a projection failure must not fail the decision.
  //
  // Identity and subject are read back out of the record frozen moments ago
  // rather than re-resolved. A second resolution could disagree with the first,
  // which would leave the report contradicting the document that was signed.
  private async projectDecision(approval: Approval, decidedAt: Date): Promise<void> {
    const record = approval.recordSnapshot;
    const stepKey = readRecordString(record, STEP_KEY);
    const recorded = (suffix: string): string =>
      stepKey ? (readRecordString(record, `${stepKey}.${suffix}`) ?? "") : "";

    const approverEmail = recorded("approver_email");
    // A blank cell in a governance report is worse than a raw id, so this walks
    // down to whatever identifies the decider at all. The record is built by
    // optional dependencies, so an unwired path reaches the last fallback.
    const decidedBy =
      recorded("approver_name") || approverEmail || (approval.decidedByUserId ?? "");

    await this.sessionStepOutputs.create({
      sessionId: approval.sessionId,
      flowId: approval.flowId,
      nodeId: approval.nodeId,
      fields: [
        field("outcome", approval.status),
        field("revision", String(await this.decisionCount(approval))),
        field("decided_at", decidedAt.toISOString()),
        field("decided_by", decidedBy),
        field("approver_email", approverEmail),
        field("comment", approval.comment ?? ""),
      ],
    });
  }

  // Which pass through this step the decision is, counting from one. A change
  // request routes work back, and re-entering the step raises a fresh request
  // rather than reopening the old one, so a step can be decided several times.
  // Counted from the approval rows — the source of truth — rather than from the
  // projections, which are best-effort and may have missed a write.
  //
  // Runs after the decision commits, so this decision is already among them.
  // A read failure reports the pass it certainly is rather than none.
  private async decisionCount(approval: Approval): Promise<number> {
    const listed = await this.approvals.listBySession(approval.sessionId);
    if (listed.error) return 1;

    const decided = listed.data.filter(
      (candidate) => candidate.nodeId === approval.nodeId && candidate.status !== "pending",
    );
    return Math.max(decided.length, 1);
  }

  private async advance(
    repositories: TransactionalRepositories,
    approval: Approval,
  ): Promise<Result<DecisionEffect>> {
    const sessionResult = await this.sessions.findById(approval.sessionId);
    if (sessionResult.error) return sessionResult;
    const session = sessionResult.data;
    if (!session) {
      return err(domainError("NOT_FOUND", `Session ${approval.sessionId} not found.`));
    }

    const edgesResult = await this.flowEdges.listByFlow(approval.flowId);
    if (edgesResult.error) return edgesResult;
    const outgoing = edgesResult.data.filter((edge) => edge.fromNodeId === approval.nodeId);

    if (outgoing.length === 0) {
      const completed = await repositories.sessions.update(session.id, { status: "complete" });
      if (completed.error) return completed;
      return ok({
        output: { approval, advanced: true, newNodeId: null, sessionCompleted: true },
        routedBack: false,
      });
    }

    // A fork after an approval cannot be auto-chosen; the session parks at the
    // node for the operator to pick a branch, mirroring the other advance paths.
    if (outgoing.length > 1) {
      return ok({
        output: { approval, advanced: false, newNodeId: null, sessionCompleted: false },
        routedBack: false,
      });
    }

    const newNodeId = outgoing[0]!.toNodeId;
    const moved = await repositories.sessions.update(session.id, {
      currentNodeId: newNodeId,
      graphCheckpoint: { currentNodeId: newNodeId, advancedFrom: approval.nodeId },
    });
    if (moved.error) return moved;
    return ok({
      output: { approval, advanced: true, newNodeId, sessionCompleted: false },
      routedBack: false,
    });
  }
}
