import { FireDueSchedules, ResumeStalledRuns } from "@rbrasier/application";
import { SystemClock } from "@rbrasier/adapters";
import { getContainer } from "@/lib/container";
import { ScheduledSessionFireHandler } from "@/lib/scheduler/scheduled-session-fire-handler";
import { kickUnattendedRun } from "@/lib/automation/unattended-runs";

// An unattended run untouched this long on a step the driver runs alone has lost
// its hook (a callback, a crash); the sweep drives it on (ADR-065 §2).
const STALLED_RUN_AFTER_MS = 60_000;
const STALLED_RUNS_PER_TICK = 20;

// Internal endpoint driven by the API server's scheduler heartbeat. It claims
// due schedules, fires them (advancing the session + generating the next
// message), recurs/completes, and records each fire to the run log. Protected by
// a shared secret so only the heartbeat can trigger it.
export async function POST(req: Request): Promise<Response> {
  const container = getContainer();

  const secret = container.env.SCHEDULER_TICK_SECRET;
  if (!secret) {
    return new Response("Scheduler tick secret not configured", { status: 503 });
  }
  if (req.headers.get("x-scheduler-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const fireDueSchedules = new FireDueSchedules(
    container.repos.schedules,
    container.repos.scheduleRuns,
    new ScheduledSessionFireHandler(container),
    new SystemClock(),
    container.env.SCHEDULER_BATCH_SIZE,
  );

  const result = await fireDueSchedules.execute();
  if (result.error) {
    await container.services.errorLogger.log({
      level: "error",
      message: `Scheduler tick failed: ${result.error.message}`,
      stack: result.error.cause instanceof Error ? result.error.cause.stack ?? null : null,
      page: "api/internal/scheduler/tick",
      metadata: { errorCode: result.error.code },
    });
    return Response.json({ error: result.error.message }, { status: 500 });
  }

  const resumed = await new ResumeStalledRuns({
    runs: container.repos.unattendedRuns,
    resume: (input) => kickUnattendedRun(container, input),
    now: () => new Date(),
  }).execute({ staleAfterMs: STALLED_RUN_AFTER_MS, limit: STALLED_RUNS_PER_TICK });
  if (resumed.error) {
    await container.services.errorLogger.log({
      level: "error",
      message: `Resuming stalled unattended runs failed: ${resumed.error.message}`,
      stack: null,
      page: "api/internal/scheduler/tick",
      metadata: { errorCode: resumed.error.code },
    });
  }

  return Response.json({ data: result.data });
}
