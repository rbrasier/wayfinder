import { describe, expect, it, vi, beforeEach } from "vitest";

// Guards the internal scheduler-tick endpoint. The deleted e2e
// `phase-scheduler-resume.spec.ts` asserted exactly this shared-secret guard
// ("rejects an unauthenticated tick", "rejects a tick bearing the wrong
// secret"); a route handler owns that check, so it is tested here rather than
// through a browser.

const { container, execute, resumeStalled, pollWatches, setSecret, setFireResult } = vi.hoisted(() => {
  let tickSecret: string | undefined = "correct-horse";
  let fireResult: { data: unknown } | { error: { code: string; message: string; cause?: unknown } } = {
    data: { fired: 0, recurred: 0, completed: 0 },
  };
  const executeFn = vi.fn(async () => fireResult);
  return {
    execute: executeFn,
    resumeStalled: vi.fn(async () => ({ data: { resumed: 0 } })),
    pollWatches: vi.fn(async () => ({ data: { polled: 0, started: 0, paused: 0, failed: 0 } })),
    container: {
      env: {
        get SCHEDULER_TICK_SECRET(): string | undefined {
          return tickSecret;
        },
        SCHEDULER_BATCH_SIZE: 50,
      },
      repos: { schedules: {}, scheduleRuns: {}, unattendedRuns: {} },
      services: { errorLogger: { log: vi.fn(async () => {}) } },
      useCases: { isFeatureEnabled: { execute: vi.fn(async () => ({ data: true })) } },
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
  ResumeStalledRuns: class {
    execute = resumeStalled;
  },
}));
vi.mock("@/lib/automation/unattended-runs", () => ({ kickUnattendedRun: vi.fn() }));
vi.mock("@/lib/automation/event-watches", () => ({ buildPollDueWatches: () => ({ execute: pollWatches }) }));
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

  it("also resumes stalled unattended runs on an authorised tick", async () => {
    resumeStalled.mockClear();

    await POST(tickRequest("correct-horse"));

    expect(resumeStalled).toHaveBeenCalledWith({ staleAfterMs: 60_000, limit: 20 });
  });

  it("polls due event watches while the event_watch flag is on", async () => {
    pollWatches.mockClear();

    await POST(tickRequest("correct-horse"));

    expect(container.useCases.isFeatureEnabled.execute).toHaveBeenCalledWith("event_watch");
    expect(pollWatches).toHaveBeenCalledWith({ limit: 20 });
  });

  it("leaves event watches alone while the event_watch flag is off", async () => {
    pollWatches.mockClear();
    container.useCases.isFeatureEnabled.execute.mockResolvedValueOnce({ data: false });

    await POST(tickRequest("correct-horse"));

    expect(pollWatches).not.toHaveBeenCalled();
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
