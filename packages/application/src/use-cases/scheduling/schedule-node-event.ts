import {
  domainError,
  err,
  ok,
  type FlowNode,
  type IClock,
  type IScheduleRepository,
  type Result,
  type ScheduledNodeConfig,
  type Session,
  type SessionSchedule,
} from "@rbrasier/domain";
import { computeNextFireAt } from "./compute-next-fire";

export interface ScheduleNodeEventInput {
  session: Session;
  node: FlowNode;
  // Resolved session/step metadata used when the node anchors to a step's
  // completion timestamp. Caller supplies the flattened key/value map.
  metadata?: Record<string, unknown>;
}

const resolveAnchor = (
  config: ScheduledNodeConfig,
  metadata: Record<string, unknown>,
  now: Date,
): Result<Date> => {
  if ((config.anchor ?? "node_reached") === "node_reached") {
    return ok(now);
  }

  const key = config.metadataKey;
  if (!key) {
    return err(domainError("VALIDATION_FAILED", "step_metadata anchor has no metadataKey."));
  }

  const raw = metadata[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    return err(domainError("VALIDATION_FAILED", `Metadata key "${key}" is missing.`));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return err(domainError("VALIDATION_FAILED", `Metadata key "${key}" is not an ISO timestamp.`));
  }
  return ok(parsed);
};

export class ScheduleNodeEvent {
  constructor(
    private readonly schedules: IScheduleRepository,
    private readonly clock: IClock,
  ) {}

  async execute(input: ScheduleNodeEventInput): Promise<Result<SessionSchedule>> {
    const config = input.node.config as unknown as ScheduledNodeConfig;
    const metadata = input.metadata ?? {};
    const now = this.clock.now();

    const anchor = resolveAnchor(config, metadata, now);
    if (anchor.error) {
      return this.schedules.create({
        sessionId: input.session.id,
        flowId: input.node.flowId,
        nodeId: input.node.id,
        kind: config.kind,
        spec: config.spec,
        recurring: config.recurring ?? false,
        maxOccurrences: config.maxOccurrences ?? null,
        nextFireAt: now,
        status: "failed",
        payload: { reason: anchor.error.message },
      });
    }

    const nextFireAt = computeNextFireAt({
      kind: config.kind,
      spec: config.spec,
      anchor: anchor.data,
    });
    if (nextFireAt.error) {
      return this.schedules.create({
        sessionId: input.session.id,
        flowId: input.node.flowId,
        nodeId: input.node.id,
        kind: config.kind,
        spec: config.spec,
        recurring: config.recurring ?? false,
        maxOccurrences: config.maxOccurrences ?? null,
        nextFireAt: now,
        status: "failed",
        payload: { reason: nextFireAt.error.message, anchorAt: anchor.data.toISOString() },
      });
    }

    return this.schedules.create({
      sessionId: input.session.id,
      flowId: input.node.flowId,
      nodeId: input.node.id,
      kind: config.kind,
      spec: config.spec,
      recurring: config.recurring ?? false,
      maxOccurrences: config.maxOccurrences ?? null,
      nextFireAt: nextFireAt.data,
      status: "active",
      payload: { anchorAt: anchor.data.toISOString() },
    });
  }
}
