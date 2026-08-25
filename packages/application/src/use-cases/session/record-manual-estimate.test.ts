import { describe, it, expect } from "vitest";
import { ok, type Result, type Session, type SessionUpdate } from "@rbrasier/domain";
import { MAX_ESTIMATE_MINUTES, RecordManualEstimate } from "./record-manual-estimate";

const baseSession: Session = {
  id: "s1",
  flowId: "f1",
  userId: "u1",
  status: "complete",
  title: null,
  currentNodeId: null,
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date("2026-08-01T09:00:00Z"),
  updatedAt: new Date("2026-08-01T10:00:00Z"),
};

class FakeSessions {
  public patches: { id: string; patch: SessionUpdate }[] = [];
  constructor(private readonly session: Session | null) {}
  async findById(id: string): Promise<Result<Session | null>> {
    return ok(this.session && this.session.id === id ? this.session : null);
  }
  async update(id: string, patch: SessionUpdate): Promise<Result<Session>> {
    this.patches.push({ id, patch });
    return ok({ ...(this.session as Session), ...patch });
  }
}

const useCaseFor = (session: Session | null) => {
  const sessions = new FakeSessions(session);
  // The use case only needs findById/update from the port.
  const useCase = new RecordManualEstimate(sessions as never);
  return { sessions, useCase };
};

describe("RecordManualEstimate", () => {
  it("stores the estimate on a completed session", async () => {
    const { sessions, useCase } = useCaseFor(baseSession);

    const result = await useCase.execute({ sessionId: "s1", userId: "u1", minutes: 240 });

    expect(result.error).toBeUndefined();
    expect(sessions.patches).toHaveLength(1);
    expect(sessions.patches[0]?.patch.manualEstimateMinutes).toBe(240);
  });

  it("accepts an abandoned session — the work up to the drop point still counts", async () => {
    const { useCase } = useCaseFor({ ...baseSession, status: "abandoned" });

    const result = await useCase.execute({ sessionId: "s1", userId: "u1", minutes: 60 });

    expect(result.error).toBeUndefined();
  });

  it("accepts a cancelled session", async () => {
    const { useCase } = useCaseFor({ ...baseSession, status: "cancelled" });

    const result = await useCase.execute({ sessionId: "s1", userId: "u1", minutes: 60 });

    expect(result.error).toBeUndefined();
  });

  it("refuses an active session, which has not finished being worked", async () => {
    const { sessions, useCase } = useCaseFor({ ...baseSession, status: "active" });

    const result = await useCase.execute({ sessionId: "s1", userId: "u1", minutes: 60 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(sessions.patches).toHaveLength(0);
  });

  it("refuses an estimate from someone who does not own the session", async () => {
    const { sessions, useCase } = useCaseFor(baseSession);

    const result = await useCase.execute({ sessionId: "s1", userId: "someone-else", minutes: 60 });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(sessions.patches).toHaveLength(0);
  });

  it("reports a missing session as not found", async () => {
    const { useCase } = useCaseFor(null);

    const result = await useCase.execute({ sessionId: "nope", userId: "u1", minutes: 60 });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it.each([0, -5, 1.5, Number.NaN, MAX_ESTIMATE_MINUTES + 1])(
    "rejects %s rather than storing a nonsensical estimate",
    async (minutes) => {
      const { sessions, useCase } = useCaseFor(baseSession);

      const result = await useCase.execute({ sessionId: "s1", userId: "u1", minutes });

      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(sessions.patches).toHaveLength(0);
    },
  );

  it("accepts the maximum permitted estimate", async () => {
    const { useCase } = useCaseFor(baseSession);

    const result = await useCase.execute({
      sessionId: "s1",
      userId: "u1",
      minutes: MAX_ESTIMATE_MINUTES,
    });

    expect(result.error).toBeUndefined();
  });

  it("overwrites a previous estimate so a mistyped figure can be corrected", async () => {
    const { sessions, useCase } = useCaseFor({ ...baseSession, manualEstimateMinutes: 30 });

    const result = await useCase.execute({ sessionId: "s1", userId: "u1", minutes: 480 });

    expect(result.error).toBeUndefined();
    expect(sessions.patches[0]?.patch.manualEstimateMinutes).toBe(480);
  });
});
