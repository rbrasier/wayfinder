import { FireDueSchedules } from "@rbrasier/application";
import { SystemClock } from "@rbrasier/adapters";
import { getContainer } from "@/lib/container";
import { ScheduledSessionFireHandler } from "@/lib/scheduler/scheduled-session-fire-handler";

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

  return Response.json({ data: result.data });
}
