import {
  ok,
  roleCanSend,
  type Approval,
  type IApprovalRepository,
  type IFlowNodeRepository,
  type ISessionParticipantRepository,
  type ISessionRepository,
  type IUserRepository,
  type Result,
  type Session,
} from "@wayfinder/domain";

// Why this person is being named, so the UI can say it rather than listing
// addresses without explanation.
export type NotifyReason = "next_approver" | "participant" | "originator";

export interface NotifyTarget {
  userId: string | null;
  name: string | null;
  // Null only for an account whose address could not be read. A target with no
  // address still tells the decider *who* to chase.
  email: string | null;
  reason: NotifyReason;
}

export interface ResolveDecisionNotifyTargetsInput {
  approval: Approval;
  // Where the decision left the session, from DecideApproval's own output.
  newNodeId: string | null;
  sessionCompleted: boolean;
  decidedByUserId: string;
}

// Who should hear that a decision was made, when email cannot deliver it and
// the approver has to tell someone by hand.
//
// Deliberately *not* `requestedByUserId`. That column is whoever raised the
// request, and a chained approval is raised by the approver before it — so on
// the final approval of a two-approval flow it names the first approver, who
// has already signed and has nothing to pick back up. The question the modal is
// really asking is "who acts next", and that is answered by where the session
// went, not by who sent the request.
//
// Advisory throughout: this drives a suggestion, sends nothing, and gates
// nothing. Every lookup degrades to "no target" rather than an error, because a
// decision has already committed by the time it runs.
export class ResolveDecisionNotifyTargets {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly participants: ISessionParticipantRepository,
    private readonly users: IUserRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly approvals: IApprovalRepository,
  ) {}

  async execute(input: ResolveDecisionNotifyTargetsInput): Promise<Result<NotifyTarget[]>> {
    const nextApprover = await this.nextApprover(input);
    if (nextApprover) return ok([nextApprover]);

    const session = await this.findSession(input.approval.sessionId);
    if (!session) return ok([]);

    // The originator is always a candidate, so "fall back to the originator" is
    // an invariant of the candidate set rather than a branch that can be missed.
    // Telling the decider to email themselves is not a fallback worth having,
    // so they are removed even when that leaves nobody.
    const targets = await this.sessionTargets(session, input);
    return ok(targets.filter((target) => target.userId !== input.decidedByUserId));
  }

  // The decision advanced onto another approval step that already has someone
  // on it. They are the only person who can move the request forward, so they
  // are the only person worth naming.
  private async nextApprover(
    input: ResolveDecisionNotifyTargetsInput,
  ): Promise<NotifyTarget | null> {
    if (!input.newNodeId) return null;

    const nodeResult = await this.flowNodes.findById(input.newNodeId);
    if (nodeResult.error || nodeResult.data?.type !== "approval") return null;

    const rows = await this.approvals.listBySession(input.approval.sessionId);
    if (rows.error) return null;
    const pending = rows.data.find(
      (row) => row.nodeId === input.newNodeId && row.status === "pending",
    );
    if (!pending) return null;

    if (pending.approverUserId) {
      return this.toTarget(pending.approverUserId, "next_approver");
    }
    // Assigned by address before the recipient had an account (ADR-018).
    if (!pending.approverEmail) return null;
    return { userId: null, name: null, email: pending.approverEmail, reason: "next_approver" };
  }

  // Everyone with a stake in the session. While it is running that means the
  // people who can actually pick the work back up; once it is complete nobody
  // is picking anything up, so viewers hear about it too.
  private async sessionTargets(
    session: Session,
    input: ResolveDecisionNotifyTargetsInput,
  ): Promise<NotifyTarget[]> {
    const rows = await this.participants.listBySession(session.id);
    const participants = rows.error ? [] : rows.data;

    // The owner is implied by the session row rather than stored as a
    // participant, so they are added explicitly, first, and named for what they
    // are: a participant row for the same person is dropped by the de-dupe.
    const userIds = [
      session.userId,
      ...participants
        .filter((row) => input.sessionCompleted || roleCanSend(row.role))
        .map((row) => row.userId),
    ];

    const resolved = await Promise.all(
      [...new Set(userIds)].map((userId) =>
        this.toTarget(userId, userId === session.userId ? "originator" : "participant"),
      ),
    );
    return resolved.filter((target): target is NotifyTarget => target !== null);
  }

  private async toTarget(userId: string, reason: NotifyReason): Promise<NotifyTarget | null> {
    const result = await this.users.findById(userId);
    if (result.error || !result.data) return null;
    return {
      userId,
      name: result.data.name?.trim() || null,
      email: result.data.email,
      reason,
    };
  }

  private async findSession(sessionId: string): Promise<Session | null> {
    const result = await this.sessions.findById(sessionId);
    return result.error ? null : result.data;
  }
}
