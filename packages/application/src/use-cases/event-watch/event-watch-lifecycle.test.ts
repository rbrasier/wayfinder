import { describe, expect, it } from "vitest";
import { ok, type EventWatch, type NewAuditLog, type WatchPausedReason } from "@rbrasier/domain";
import { DeleteEventWatch, PauseEventWatch, ResumeEventWatch } from "./event-watch-lifecycle";

const watch = { id: "watch-1", name: "Estimates hearings", status: "active" } as EventWatch;

const build = (existing: EventWatch | null = watch) => {
  const audits: NewAuditLog[] = [];
  const calls: string[] = [];
  const paused: Array<{ reason: WatchPausedReason; incidentId: string }> = [];
  const dependencies = {
    watches: {
      findById: async () => ok(existing),
      delete: async () => {
        calls.push("delete");
        return ok(undefined);
      },
      pause: async (_id: string, reason: WatchPausedReason, _at: Date, incidentId: string) => {
        paused.push({ reason, incidentId });
        return ok({ ...watch, status: "paused" as const });
      },
      resume: async () => {
        calls.push("resume");
        return ok(watch);
      },
    },
    auditLogger: {
      log: async (entry: NewAuditLog) => {
        audits.push(entry);
        return ok(true as const);
      },
    },
    newId: () => "incident-1",
    now: () => new Date(0),
  };
  return {
    remove: new DeleteEventWatch(dependencies),
    pause: new PauseEventWatch(dependencies),
    resume: new ResumeEventWatch(dependencies),
    audits,
    calls,
    paused,
  };
};

describe("event watch lifecycle", () => {
  it("deletes a watch and audits it", async () => {
    const { remove, calls, audits } = build();

    await remove.execute({ id: "watch-1", actorId: "admin-1" });

    expect(calls).toEqual(["delete"]);
    expect(audits[0]).toMatchObject({ action: "event_watch.deleted", resourceId: "watch-1", metadata: { name: "Estimates hearings" } });
  });

  it("pauses a watch by hand without alerting anyone", async () => {
    const { pause, paused, audits } = build();

    const result = await pause.execute({ id: "watch-1", actorId: "admin-1" });

    expect(result.data?.status).toBe("paused");
    expect(paused).toEqual([{ reason: "manual", incidentId: "incident-1" }]);
    expect(audits[0]!.action).toBe("event_watch.paused");
  });

  it("resumes a watch and audits it", async () => {
    const { resume, calls, audits } = build({ ...watch, status: "paused" });

    await resume.execute({ id: "watch-1", actorId: "admin-1" });

    expect(calls).toEqual(["resume"]);
    expect(audits[0]!.action).toBe("event_watch.resumed");
  });

  it("is NOT_FOUND for a watch that does not exist", async () => {
    const { remove, pause, resume } = build(null);

    expect((await remove.execute({ id: "x", actorId: "a" })).error?.code).toBe("NOT_FOUND");
    expect((await pause.execute({ id: "x", actorId: "a" })).error?.code).toBe("NOT_FOUND");
    expect((await resume.execute({ id: "x", actorId: "a" })).error?.code).toBe("NOT_FOUND");
  });
});
