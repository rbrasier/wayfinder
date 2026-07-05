import { describe, expect, it, vi } from "vitest";
import {
  ok,
  type Flow,
  type FlowVisibility,
  type IAuditLogger,
  type ISessionParticipantRepository,
  type NewSessionParticipant,
  type Session,
  type SessionParticipant,
} from "@rbrasier/domain";
import { ResolveSessionAccess } from "./resolve-session-access";

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "owner-1",
  status: "active",
  title: null,
  currentNodeId: "node-1",
  flowVersionId: null,
  awaitingConfirmationNodeId: null,
  graphCheckpoint: null,
  pendingExecutions: {},
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeFlow = (visibility: FlowVisibility): Flow =>
  ({
    id: "flow-1",
    name: "Test Flow",
    ownerUserId: "owner-1",
    visibility,
    status: "published",
  }) as Flow;

class FakeParticipants implements ISessionParticipantRepository {
  rows: SessionParticipant[] = [];

  async listBySession(sessionId: string) {
    return ok(this.rows.filter((row) => row.sessionId === sessionId));
  }
  async findBySessionAndUser(sessionId: string, userId: string) {
    return ok(this.rows.find((row) => row.sessionId === sessionId && row.userId === userId) ?? null);
  }
  async enrol(input: NewSessionParticipant) {
    const existing = this.rows.find(
      (row) => row.sessionId === input.sessionId && row.userId === input.userId,
    );
    if (existing) return ok(existing);
    const row: SessionParticipant = {
      id: `p-${this.rows.length + 1}`,
      sessionId: input.sessionId,
      userId: input.userId,
      role: input.role,
      joinedAt: new Date(),
      invitedBy: input.invitedBy ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return ok(row);
  }
  async setRole() {
    throw new Error("not used");
  }
  async remove() {
    return ok(undefined);
  }
}

const makeAudit = (): IAuditLogger => ({ log: vi.fn().mockResolvedValue(ok(true as const)) });

describe("ResolveSessionAccess", () => {
  it("grants the owner full access without a participant row", async () => {
    const participants = new FakeParticipants();
    const useCase = new ResolveSessionAccess(participants, makeAudit());

    const result = await useCase.execute({
      session: makeSession(),
      flow: makeFlow({ kind: "private" }),
      userId: "owner-1",
      isAdmin: false,
      isApprover: false,
      allowAutoEnrol: true,
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ role: "owner", canSend: true, readOnly: false });
    expect(participants.rows).toHaveLength(0);
  });

  it("grants an admin full access", async () => {
    const useCase = new ResolveSessionAccess(new FakeParticipants(), makeAudit());
    const result = await useCase.execute({
      session: makeSession(),
      flow: makeFlow({ kind: "private" }),
      userId: "someone-else",
      isAdmin: true,
      isApprover: false,
      allowAutoEnrol: true,
    });
    expect(result.data).toEqual({ role: "admin", canSend: true, readOnly: false });
  });

  it("auto-enrols a visitor as collaborator when the flow is visible to them", async () => {
    const participants = new FakeParticipants();
    const audit = makeAudit();
    const useCase = new ResolveSessionAccess(participants, audit);

    const result = await useCase.execute({
      session: makeSession(),
      flow: makeFlow({ kind: "global" }),
      userId: "visitor-1",
      isAdmin: false,
      isApprover: false,
      allowAutoEnrol: true,
    });

    expect(result.data).toEqual({ role: "collaborator", canSend: true, readOnly: false });
    expect(participants.rows).toHaveLength(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "session.participant.joined", resourceId: "session-1" }),
    );
  });

  it("refuses a visitor when the flow is not visible to them", async () => {
    const participants = new FakeParticipants();
    const useCase = new ResolveSessionAccess(participants, makeAudit());

    const result = await useCase.execute({
      session: makeSession(),
      flow: makeFlow({ kind: "private" }),
      userId: "visitor-1",
      isAdmin: false,
      isApprover: false,
      allowAutoEnrol: true,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(participants.rows).toHaveLength(0);
  });

  it("treats a revoked (viewer) collaborator as read-only and never re-upgrades them", async () => {
    const participants = new FakeParticipants();
    participants.rows.push({
      id: "p-1",
      sessionId: "session-1",
      userId: "revoked-1",
      role: "viewer",
      joinedAt: new Date(),
      invitedBy: "owner-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const useCase = new ResolveSessionAccess(participants, makeAudit());

    const result = await useCase.execute({
      // A globally visible flow would otherwise auto-enrol as collaborator; the
      // existing viewer row must win so revocation sticks.
      session: makeSession(),
      flow: makeFlow({ kind: "global" }),
      userId: "revoked-1",
      isAdmin: false,
      isApprover: false,
      allowAutoEnrol: true,
    });

    expect(result.data).toEqual({ role: "viewer", canSend: false, readOnly: true });
    expect(participants.rows).toHaveLength(1);
  });

  it("grants an approver read-only access without enrolling them", async () => {
    const participants = new FakeParticipants();
    const useCase = new ResolveSessionAccess(participants, makeAudit());

    const result = await useCase.execute({
      session: makeSession(),
      flow: makeFlow({ kind: "private" }),
      userId: "approver-1",
      isAdmin: false,
      isApprover: true,
      allowAutoEnrol: true,
    });

    expect(result.data).toEqual({ role: "viewer", canSend: false, readOnly: true });
    expect(participants.rows).toHaveLength(0);
  });

  it("does not enrol when auto-enrol is disabled", async () => {
    const participants = new FakeParticipants();
    const useCase = new ResolveSessionAccess(participants, makeAudit());

    const result = await useCase.execute({
      session: makeSession(),
      flow: makeFlow({ kind: "global" }),
      userId: "visitor-1",
      isAdmin: false,
      isApprover: false,
      allowAutoEnrol: false,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(participants.rows).toHaveLength(0);
  });
});
