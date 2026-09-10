import { describe, expect, it, vi, beforeEach } from "vitest";

// Guards the internal scheduler-tick endpoint. The deleted e2e
// `phase-scheduler-resume.spec.ts` asserted exactly this shared-secret guard
// ("rejects an unauthenticated tick", "rejects a tick bearing the wrong
// secret"); a route handler owns that check, so it is tested here rather than
// through a browser.

const { container, execute, setSecret, setFireResult } = vi.hoisted(() => {
  let tickSecret: string | undefined = "correct-horse";
  let fireResult: { data: unknown } | { error: { code: string; message: string; cause?: unknown } } = {
    data: { fired: 0, recurred: 0, completed: 0 },
  };
  const executeFn = vi.fn(async () => fireResult);
  return {
    execute: executeFn,
    container: {
      env: {
        get SCHEDULER_TICK_SECRET(): string | undefined {
          return tickSecret;
        },
        SCHEDULER_BATCH_SIZE: 50,
      },
      repos: { schedules: {}, scheduleRuns: {} },
      services: { errorLogger: { log: vi.fn(async () => {}) } },
    },
    setSecret: (value: string | undefined): void => {
      tickSecret = value;
    },
    setFireResult: (value: typeof fireResult): void => {
      fireResult = value;
    },
  };
});

vi.mock("@/lib/container", () => ({ getContainer: () => container }));
vi.mock("@wayfinder/application", () => ({
  FireDueSchedules: class {
    execute = execute;
  },
}));
vi.mock("@wayfinder/adapters", () => ({ SystemClock: class {} }));
vi.mock("@/lib/scheduler/scheduled-session-fire-handler", () => ({
  ScheduledSessionFireHandler: class {},
}));

import { POST } from "./route";

const tickRequest = (secretHeader?: string): Request =>
  new Request("http://localhost:3000/api/internal/scheduler/tick", {
    method: "POST",
    headers: secretHeader === undefined ? {} : { "x-scheduler-secret": secretHeader },
  });

describe("/api/internal/scheduler/tick", () => {
  beforeEach(() => {
    execute.mockClear();
    container.services.errorLogger.log.mockClear();
    setSecret("correct-horse");
    setFireResult({ data: { fired: 0, recurred: 0, completed: 0 } });
  });

  it("returns 503 when no tick secret is configured, without firing anything", async () => {
    setSecret(undefined);

    const response = await POST(tickRequest("anything"));

    expect(response.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated tick with 401", async () => {
    const response = await POST(tickRequest(undefined));

    expect(response.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a tick bearing the wrong secret with 401", async () => {
    const response = await POST(tickRequest("wrong-secret"));

    expect(response.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("fires due schedules and returns their result when the secret matches", async () => {
    setFireResult({ data: { fired: 2, recurred: 1, completed: 0 } });

    const response = await POST(tickRequest("correct-horse"));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { fired: 2, recurred: 1, completed: 0 },
    });
  });

  it("reports a firing failure as a 500 and logs it, not as a silent success", async () => {
    setFireResult({ error: { code: "INFRA_FAILURE", message: "db unavailable" } });

    const response = await POST(tickRequest("correct-horse"));

    expect(response.status).toBe(500);
    expect(container.services.errorLogger.log).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({ error: "db unavailable" });
  });
});
