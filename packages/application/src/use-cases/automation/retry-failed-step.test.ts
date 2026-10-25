import { describe, expect, it } from "vitest";
import { ok, type Session, type SessionUpdate } from "@wayfinder/domain";
import { RetryFailedStep } from "./retry-failed-step";

const failedSession = (overrides: Partial<Session> = {}): Session =>
  ({
    id: "session-1",
    userId: "owner-1",
    status: "active",
    origin: "watch",
    runError: { incidentId: "i-1", nodeId: "mail", code: "INFRA_FAILURE", message: "SMTP refused", at: "" },
    ...overrides,
  }) as Session;

const build = (session: Session | null) => {
  const updates: SessionUpdate[] = [];
  const advanced: string[] = [];
  const audit: string[] = [];
  const useCase = new RetryFailedStep({
    sessions: {
      findById: async () => ok(session),
      update: async (_id, patch) => {
        updates.push(patch);
        return ok({ ...session!, ...patch } as Session);
      },
    },
    advance: { execute: async ({ sessionId }) => { advanced.push(sessionId); return ok({ status: "completed" as const }); } },
    auditLogger: { log: async (entry) => { audit.push(entry.action); return ok(true as const); } },
  });
  return { useCase, updates, advanced, audit };
};

describe("RetryFailedStep", () => {
  it("clears the run's error and drives it again from the failed step", async () => {
    const { useCase, updates, advanced, audit } = build(failedSession());

    const result = await useCase.execute({ sessionId: "session-1", userId: "owner-1", isAdmin: false });

    expect(result.data).toEqual({ status: "completed" });
    expect(updates).toEqual([{ runError: null }]);
    expect(advanced).toEqual(["session-1"]);
    expect(audit).toEqual(["unattended_run.retried"]);
  });

  it("lets an admin retry someone else's run", async () => {
    const { useCase } = build(failedSession());

    const result = await useCase.execute({ sessionId: "session-1", userId: "admin-1", isAdmin: true });

    expect(result.error).toBeUndefined();
  });

  it("refuses anyone but the run owner or an admin", async () => {
    const { useCase, advanced } = build(failedSession());

    const result = await useCase.execute({ sessionId: "session-1", userId: "someone", isAdmin: false });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(advanced).toEqual([]);
  });

  it("refuses a run that has not failed", async () => {
    const { useCase } = build(failedSession({ runError: null }));

    const result = await useCase.execute({ sessionId: "session-1", userId: "owner-1", isAdmin: false });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
