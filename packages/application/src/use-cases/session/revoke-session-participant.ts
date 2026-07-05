import {
  ok,
  type IAuditLogger,
  type ISessionParticipantRepository,
  type Result,
  type SessionParticipant,
} from "@rbrasier/domain";

export interface RevokeSessionParticipantInput {
  sessionId: string;
  participantUserId: string;
  revokedByUserId: string;
}

// Revocation downgrades a collaborator to viewer rather than deleting the row
// (scaling wall #11): their next send is rejected while read access is kept, and
// — crucially — auto-enrol never re-upgrades an existing row, so the revoke is
// durable even if they re-open the collaborate link. Authorisation (owner/admin)
// is enforced by the caller.
export class RevokeSessionParticipant {
  constructor(
    private readonly participants: ISessionParticipantRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: RevokeSessionParticipantInput): Promise<Result<SessionParticipant>> {
    const updated = await this.participants.setRole(
      input.sessionId,
      input.participantUserId,
      "viewer",
    );
    if (updated.error) return updated;

    await this.auditLogger.log({
      actorId: input.revokedByUserId,
      action: "session.participant.revoked",
      resourceType: "session",
      resourceId: input.sessionId,
      metadata: { participantUserId: input.participantUserId, role: "viewer" },
    });

    return ok(updated.data);
  }
}
