import {
  domainError,
  err,
  ok,
  type FlowContextDoc,
  type FlowNode,
  type IClock,
  type ILanguageModel,
  type IScheduleRepository,
  parseFlexibleDate,
  type Result,
  type ScheduledNodeConfig,
  type Session,
  type SessionSchedule,
  type SessionStepOutput,
} from "@rbrasier/domain";
import { lookupStepField, resolveFieldValues } from "../../services/resolve-field-values";
import { computeNextFireAt } from "./compute-next-fire";

export interface ScheduleNodeEventInput {
  session: Session;
  node: FlowNode;
  // Resolved session/step metadata used when the node anchors to a step's
  // completion timestamp. Caller supplies the flattened key/value map.
  metadata?: Record<string, unknown>;
  // Context used to resolve an `at`-kind `specSource`. Optional so callers that
  // never use a value source need not assemble it.
  priorStepOutputs?: SessionStepOutput[];
  insights?: { key: string; value: string }[];
  transcript?: string;
  contextDocs?: FlowContextDoc[];
}

const resolveAnchor = (
  config: ScheduledNodeConfig,
  input: ScheduleNodeEventInput,
  now: Date,
): Result<Date> => {
  const anchor = config.anchor ?? "node_reached";

  if (anchor === "node_reached") {
    return ok(now);
  }

  if (anchor === "flow_started") {
    return ok(input.session.createdAt);
  }

  if (anchor === "step_field") {
    const source = config.anchorSource;
    if (!source) {
      return err(domainError("VALIDATION_FAILED", "step_field anchor has no anchorSource."));
    }
    const raw =
      source.kind === "literal"
        ? source.value
        : source.kind === "step_field"
          ? lookupStepField(input.priorStepOutputs ?? [], source.nodeId, source.fieldKey)
          : "";
    if (raw.trim() === "") {
      return err(domainError("VALIDATION_FAILED", "step_field anchor resolved to no value."));
    }
    const parsed = parseFlexibleDate(raw);
    if (!parsed) {
      return err(domainError("VALIDATION_FAILED", `step_field anchor "${raw}" is not a date.`));
    }
    return ok(parsed);
  }

  const key = config.metadataKey;
  if (!key) {
    return err(domainError("VALIDATION_FAILED", "step_metadata anchor has no metadataKey."));
  }

  const raw = (input.metadata ?? {})[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    return err(domainError("VALIDATION_FAILED", `Metadata key "${key}" is missing.`));
  }

  const parsed = parseFlexibleDate(raw);
  if (!parsed) {
    return err(domainError("VALIDATION_FAILED", `Metadata key "${key}" is not a date.`));
  }
  return ok(parsed);
};

export class ScheduleNodeEvent {
  constructor(
    private readonly schedules: IScheduleRepository,
    private readonly clock: IClock,
    // Required only when an `at`-kind node uses an `ai` specSource.
    private readonly languageModel?: ILanguageModel,
  ) {}

  async execute(input: ScheduleNodeEventInput): Promise<Result<SessionSchedule>> {
    const config = input.node.config as unknown as ScheduledNodeConfig;
    const now = this.clock.now();

    const spec = await this.resolveSpec(config, input);
    if (spec.error) {
      return this.failed(input, config, now, spec.error.message);
    }

    const anchor = resolveAnchor(config, input, now);
    if (anchor.error) {
      return this.failed(input, config, now, anchor.error.message, spec.data);
    }

    const nextFireAt = computeNextFireAt({
      kind: config.kind,
      spec: spec.data,
      anchor: anchor.data,
      direction: config.relativeDirection,
    });
    if (nextFireAt.error) {
      return this.failed(
        input,
        config,
        now,
        nextFireAt.error.message,
        spec.data,
        anchor.data,
      );
    }

    return this.schedules.create({
      sessionId: input.session.id,
      flowId: input.node.flowId,
      nodeId: input.node.id,
      kind: config.kind,
      spec: spec.data,
      recurring: config.kind === "recurrence" ? true : config.recurring ?? false,
      maxOccurrences: config.maxOccurrences ?? null,
      nextFireAt: nextFireAt.data,
      status: "active",
      payload: { anchorAt: anchor.data.toISOString() },
    });
  }

  // The effective spec for `at` nodes can be drawn from a value source; every
  // other kind uses the literal `config.spec`.
  private async resolveSpec(
    config: ScheduledNodeConfig,
    input: ScheduleNodeEventInput,
  ): Promise<Result<string>> {
    const source = config.specSource;
    if (config.kind !== "at" || !source || source.kind === "ai") {
      if (source?.kind === "ai") return this.resolveAiSpec(config, input);
      return ok(config.spec);
    }
    if (source.kind === "literal") return ok(source.value);
    if (source.kind === "none") return ok("");
    return ok(lookupStepField(input.priorStepOutputs ?? [], source.nodeId, source.fieldKey));
  }

  private async resolveAiSpec(
    config: ScheduledNodeConfig,
    input: ScheduleNodeEventInput,
  ): Promise<Result<string>> {
    if (!this.languageModel) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "Scheduled node uses AI to choose its fire time but no language model is configured.",
        ),
      );
    }
    const nowIso = this.clock.now().toISOString();
    const describe = config.describeText?.trim();
    const instruction = describe
      ? `Decide the exact date and time this scheduled step should fire. The current date and time is ${nowIso}. The author described how to calculate it: "${describe}". Use the session context below. Respond with a single ISO 8601 timestamp, e.g. 2026-12-25T09:00:00.000Z.`
      : `Decide the exact date and time this scheduled step should fire based on the session context. The current date and time is ${nowIso}. Respond with a single ISO 8601 timestamp, e.g. 2026-12-25T09:00:00.000Z.`;
    const resolved = await resolveFieldValues(this.languageModel, {
      fields: [
        { key: "fire_at", label: "Scheduled date/time", type: "text", optional: false, raw: "Scheduled date/time" },
      ],
      valueSources: { fire_at: { kind: "ai" } },
      priorStepOutputs: input.priorStepOutputs ?? [],
      insights: input.insights ?? [],
      transcript: input.transcript ?? "",
      contextDocs: input.contextDocs ?? [],
      instruction,
      purpose: "scheduledNodeSpec",
    });
    if (resolved.error) return resolved;
    return ok(resolved.data.fire_at ?? config.spec);
  }

  private failed(
    input: ScheduleNodeEventInput,
    config: ScheduledNodeConfig,
    now: Date,
    reason: string,
    spec?: string,
    anchorAt?: Date,
  ): Promise<Result<SessionSchedule>> {
    return this.schedules.create({
      sessionId: input.session.id,
      flowId: input.node.flowId,
      nodeId: input.node.id,
      kind: config.kind,
      spec: spec ?? config.spec,
      recurring: config.recurring ?? false,
      maxOccurrences: config.maxOccurrences ?? null,
      nextFireAt: now,
      status: "failed",
      payload: anchorAt ? { reason, anchorAt: anchorAt.toISOString() } : { reason },
    });
  }
}
