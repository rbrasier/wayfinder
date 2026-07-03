import { describe, expect, it, vi } from "vitest";
import {
  ok,
  type IAuditLogger,
  type ISessionParticipantRepository,
  type SessionParticipant,
  type SessionParticipantRole,
} from "@rbrasier/domain";
import { RevokeSessionParticipant } from "./revoke-session-participant";

class FakeParticipants implements ISessionParticipantRepository {
  rows: SessionParticipant[] = [];
  async listBySession() {
    return ok(this.rows);
  }
  async findBySessionAndUser() {
    return ok(null);
  }
  async enrol() {
    throw new Error("not used");
  }
  async setRole(sessionId: string, userId: string, role: SessionParticipantRole) {
    const row = this.rows.find((r) => r.sessionId === sessionId && r.userId === userId);
    if (!row) throw new Error("missing");
    row.role = role;
    return ok(row);
  }
  async remove() {
    return ok(undefined);
  }
}

const makeAudit = (): IAuditLogger => ({ log: vi.fn().mockResolvedValue(ok(true as const)) });

describe("RevokeSessionParticipant", () => {
  it("downgrades a collaborator to viewer and audits the revoke", async () => {
    const participants = new FakeParticipants();
    participants.rows.push({
      id: "p-1",
      sessionId: "session-1",
      userId: "collab-1",
      role: "collaborator",
      joinedAt: new Date(),
      invitedBy: "owner-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const audit = makeAudit();
    const useCase = new RevokeSessionParticipant(participants, audit);

    const result = await useCase.execute({
      sessionId: "session-1",
      participantUserId: "collab-1",
      revokedByUserId: "owner-1",
    });

    expect(result.error).toBeUndefined();
    expect(participants.rows[0]!.role).toBe("viewer");
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session.participant.revoked",
        resourceId: "session-1",
        actorId: "owner-1",
      }),
    );
  });
});
