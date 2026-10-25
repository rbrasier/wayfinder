import {
  domainError,
  err,
  ok,
  type EventWatch,
  type IAuditLogger,
  type IEventWatchRepository,
  type Result,
} from "@wayfinder/domain";
import { EVENT_WATCH_RESOURCE_TYPE } from "./save-event-watch";

export interface EventWatchLifecycleDependencies {
  watches: Pick<IEventWatchRepository, "findById" | "delete" | "pause" | "resume">;
  auditLogger: IAuditLogger;
  newId: () => string;
  now: () => Date;
}

interface LifecycleInput {
  id: string;
  actorId: string;
}

const findWatch = async (
  dependencies: EventWatchLifecycleDependencies,
  id: string,
): Promise<Result<EventWatch>> => {
  const watch = await dependencies.watches.findById(id);
  if (watch.error) return watch;
  if (!watch.data) return err(domainError("NOT_FOUND", "Event watch not found."));
  return ok(watch.data);
};

const audit = (dependencies: EventWatchLifecycleDependencies, action: string, watch: EventWatch, actorId: string) =>
  dependencies.auditLogger.log({
    actorId,
    action,
    resourceType: EVENT_WATCH_RESOURCE_TYPE,
    resourceId: watch.id,
    metadata: { name: watch.name },
  });

// Item state and run history go with it; the sessions it started stay with
// their owners.
export class DeleteEventWatch {
  constructor(private readonly dependencies: EventWatchLifecycleDependencies) {}

  async execute(input: LifecycleInput): Promise<Result<void>> {
    const watch = await findWatch(this.dependencies, input.id);
    if (watch.error) return watch;
    const deleted = await this.dependencies.watches.delete(input.id);
    if (deleted.error) return deleted;
    await audit(this.dependencies, "event_watch.deleted", watch.data, input.actorId);
    return ok(undefined);
  }
}

// An admin's own pause raises no alert: they already know.
export class PauseEventWatch {
  constructor(private readonly dependencies: EventWatchLifecycleDependencies) {}

  async execute(input: LifecycleInput): Promise<Result<EventWatch>> {
    const watch = await findWatch(this.dependencies, input.id);
    if (watch.error) return watch;
    const paused = await this.dependencies.watches.pause(
      input.id,
      "manual",
      this.dependencies.now(),
      this.dependencies.newId(),
    );
    if (paused.error) return paused;
    await audit(this.dependencies, "event_watch.paused", watch.data, input.actorId);
    return paused;
  }
}

// Clears the failure count and polls on the next tick. It does not re-baseline:
// the state recorded before the pause is still true (ADR-063 §7).
export class ResumeEventWatch {
  constructor(private readonly dependencies: EventWatchLifecycleDependencies) {}

  async execute(input: LifecycleInput): Promise<Result<EventWatch>> {
    const watch = await findWatch(this.dependencies, input.id);
    if (watch.error) return watch;
    const resumed = await this.dependencies.watches.resume(input.id, this.dependencies.now());
    if (resumed.error) return resumed;
    await audit(this.dependencies, "event_watch.resumed", watch.data, input.actorId);
    return resumed;
  }
}
