import { describe, expect, it } from "vitest";
import { deriveRunStatus, isUnattendedOrigin } from "./unattended-run";
import type { SessionRunError } from "./session";

const runError: SessionRunError = {
  incidentId: "incident-1",
  nodeId: "node-1",
  code: "feature_disabled",
  message: "Email steps are disabled by an administrator",
  at: "2026-10-22T00:00:00.000Z",
};

describe("deriveRunStatus", () => {
  it("reports a run with a recorded error as failed, even while the session is active", () => {
    const status = deriveRunStatus({
      sessionStatus: "active",
      runError,
      currentNodeType: "email",
      hasPendingReview: false,
    });

    expect(status).toBe("failed");
  });

  it("reports an active run parked on a conversational step as waiting on a person", () => {
    const status = deriveRunStatus({
      sessionStatus: "active",
      runError: null,
      currentNodeType: "conversational",
      hasPendingReview: false,
    });

    expect(status).toBe("waiting_on_person");
  });

  it("reports an active run on an approval step as waiting on a person", () => {
    const status = deriveRunStatus({
      sessionStatus: "active",
      runError: null,
      currentNodeType: "approval",
      hasPendingReview: false,
    });

    expect(status).toBe("waiting_on_person");
  });

  it("reports an AI task awaiting its reviewer as waiting on a person", () => {
    const status = deriveRunStatus({
      sessionStatus: "active",
      runError: null,
      currentNodeType: "ai_task",
      hasPendingReview: true,
    });

    expect(status).toBe("waiting_on_person");
  });

  it("reports an active run on an unattended step as running", () => {
    const status = deriveRunStatus({
      sessionStatus: "active",
      runError: null,
      currentNodeType: "ai_task",
      hasPendingReview: false,
    });

    expect(status).toBe("running");
  });

  it("passes a terminal session status straight through", () => {
    const status = deriveRunStatus({
      sessionStatus: "complete",
      runError: null,
      currentNodeType: null,
      hasPendingReview: false,
    });

    expect(status).toBe("completed");
  });
});

describe("isUnattendedOrigin", () => {
  it("treats watch and webhook sessions as unattended and manual ones as not", () => {
    expect(isUnattendedOrigin("watch")).toBe(true);
    expect(isUnattendedOrigin("webhook")).toBe(true);
    expect(isUnattendedOrigin("manual")).toBe(false);
    expect(isUnattendedOrigin(undefined)).toBe(false);
  });
});
