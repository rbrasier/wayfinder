import { describe, it, expect } from "vitest";
import {
  type IAuditLogger,
  type IPasswordResetter,
  type NewAuditLog,
  type PasswordResetOutcome,
  type PasswordResetRequest,
  type Result,
  type User,
  domainError,
  err,
  ok,
} from "@rbrasier/domain";
import { ResetUserPassword, RESET_PASSWORD_AUDIT_ACTION } from "./reset-user-password";

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  name: "Ada Lovelace",
  role: null,
  team: null,
  isAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

class StubUsers {
  constructor(private readonly user: User | null) {}
  async findById(): Promise<Result<User | null>> {
    return ok(this.user);
  }
}

class FailingUsers {
  async findById(): Promise<Result<User | null>> {
    return err(domainError("INFRA_FAILURE", "database unreachable"));
  }
}

class RecordingResetter implements IPasswordResetter {
  calls: PasswordResetRequest[] = [];
  constructor(private readonly result: Result<PasswordResetOutcome>) {}
  async resetPassword(input: PasswordResetRequest): Promise<Result<PasswordResetOutcome>> {
    this.calls.push(input);
    return this.result;
  }
}

class RecordingAuditLogger implements IAuditLogger {
  entries: NewAuditLog[] = [];
  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.entries.push(payload);
    return ok(true);
  }
}

const actorId = "22222222-2222-4222-8222-222222222222";

describe("ResetUserPassword", () => {
  it("rejects a password shorter than the minimum before touching the resetter", async () => {
    const resetter = new RecordingResetter(ok({ userId: "unused", sessionsRevoked: 0 }));
    const audit = new RecordingAuditLogger();
    const useCase = new ResetUserPassword(
      new StubUsers(buildUser()) as never,
      resetter,
      audit,
    );

    const result = await useCase.execute({
      actorId,
      userId: buildUser().id,
      password: "short",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(resetter.calls).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
  });

  it("returns NOT_FOUND when the target user does not exist", async () => {
    const resetter = new RecordingResetter(ok({ userId: "unused", sessionsRevoked: 0 }));
    const audit = new RecordingAuditLogger();
    const useCase = new ResetUserPassword(new StubUsers(null) as never, resetter, audit);

    const result = await useCase.execute({
      actorId,
      userId: "33333333-3333-4333-8333-333333333333",
      password: "a-long-enough-password",
    });

    expect(result.error?.code).toBe("NOT_FOUND");
    expect(resetter.calls).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
  });

  it("propagates a lookup failure without attempting the reset", async () => {
    const resetter = new RecordingResetter(ok({ userId: "unused", sessionsRevoked: 0 }));
    const audit = new RecordingAuditLogger();
    const useCase = new ResetUserPassword(new FailingUsers() as never, resetter, audit);

    const result = await useCase.execute({
      actorId,
      userId: buildUser().id,
      password: "a-long-enough-password",
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(resetter.calls).toHaveLength(0);
  });

  it("does not write an audit entry when the reset itself fails", async () => {
    const user = buildUser();
    const resetter = new RecordingResetter(
      err(domainError("INFRA_FAILURE", "hashing failed")),
    );
    const audit = new RecordingAuditLogger();
    const useCase = new ResetUserPassword(new StubUsers(user) as never, resetter, audit);

    const result = await useCase.execute({
      actorId,
      userId: user.id,
      password: "a-long-enough-password",
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(audit.entries).toHaveLength(0);
  });

  it("resets the password and audits the acting administrator against the target", async () => {
    const user = buildUser();
    const resetter = new RecordingResetter(ok({ userId: user.id, sessionsRevoked: 3 }));
    const audit = new RecordingAuditLogger();
    const useCase = new ResetUserPassword(new StubUsers(user) as never, resetter, audit);

    const result = await useCase.execute({
      actorId,
      userId: user.id,
      password: "a-long-enough-password",
    });

    expect(result.data).toEqual({ userId: user.id, sessionsRevoked: 3 });
    expect(resetter.calls).toEqual([
      { userId: user.id, password: "a-long-enough-password" },
    ]);
    expect(audit.entries).toEqual([
      {
        actorId,
        action: RESET_PASSWORD_AUDIT_ACTION,
        resourceType: "user",
        resourceId: user.id,
        metadata: { email: user.email, sessionsRevoked: 3 },
      },
    ]);
  });

  it("never records the new password in the audit metadata", async () => {
    const user = buildUser();
    const resetter = new RecordingResetter(ok({ userId: user.id, sessionsRevoked: 0 }));
    const audit = new RecordingAuditLogger();
    const useCase = new ResetUserPassword(new StubUsers(user) as never, resetter, audit);

    await useCase.execute({ actorId, userId: user.id, password: "super-secret-value" });

    expect(JSON.stringify(audit.entries)).not.toContain("super-secret-value");
  });
});
