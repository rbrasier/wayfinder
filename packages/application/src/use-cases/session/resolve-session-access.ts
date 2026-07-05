import {
  domainError,
  err,
  isFlowDiscoverableBy,
  ok,
  roleCanSend,
  type Flow,
  type IAuditLogger,
  type ISessionParticipantRepository,
  type Result,
  type Session,
  type SessionParticipantRole,
} from "@rbrasier/domain";

export type SessionAccessRole = SessionParticipantRole | "admin";

export interface SessionAccess {
  role: SessionAccessRole;
  canSend: boolean;
  readOnly: boolean;
}

export interface ResolveSessionAccessInput {
  session: Session;
  flow: Flow;
  userId: string;
  isAdmin: boolean;
  // A session approver (ADR-018) gets a read-only grant that is not a stored
  // participant row, so approvals raised before the recipient had an account
  // still open. Caller computes this from the approvals repo.
  isApprover: boolean;
  // Read/send paths pass true so a first-time visitor holding the collaborate
  // link is enrolled; callers that must not mutate (e.g. background readers) pass
  // false and get FORBIDDEN instead of a silent join.
  allowAutoEnrol: boolean;
}

// Resolves who may do what on a collaborative session against the participants
// table (scaling wall #11). Membership is authoritative — not knowledge of the
// URL — so revocation works and every link-join is audited.
export class ResolveSessionAccess {
  constructor(
    private readonly participants: ISessionParticipantRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: ResolveSessionAccessInput): Promise<Result<SessionAccess>> {
    const { session, flow, userId, isAdmin, isApprover, allowAutoEnrol } = input;

    if (isAdmin) return ok({ role: "admin", canSend: true, readOnly: false });
    if (session.userId === userId) return ok({ role: "owner", canSend: true, readOnly: false });

    // An existing membership is authoritative and always wins over auto-enrol, so
    // a revoked collaborator (downgraded to viewer) is never re-upgraded.
    const existingResult = await this.participants.findBySessionAndUser(session.id, userId);
    if (existingResult.error) return existingResult;
    if (existingResult.data) {
      const canSend = roleCanSend(existingResult.data.role);
      return ok({ role: existingResult.data.role, canSend, readOnly: !canSend });
    }

    if (isApprover) return ok({ role: "viewer", canSend: false, readOnly: true });

    const flowVisible =
      allowAutoEnrol &&
      isFlowDiscoverableBy(flow.visibility, {
        ownerUserId: flow.ownerUserId,
        viewerUserId: userId,
      });
    if (!flowVisible) {
      return err(domainError("FORBIDDEN", "You do not have access to this session."));
    }

    const enrolledResult = await this.participants.enrol({
      sessionId: session.id,
      userId,
      role: "collaborator",
      invitedBy: session.userId,
    });
    if (enrolledResult.error) return enrolledResult;

    await this.auditLogger.log({
      actorId: userId,
      action: "session.participant.joined",
      resourceType: "session",
      resourceId: session.id,
      metadata: { role: enrolledResult.data.role, via: "collaborate_link" },
    });

    return ok({
      role: enrolledResult.data.role,
      canSend: roleCanSend(enrolledResult.data.role),
      readOnly: false,
    });
  }
}
