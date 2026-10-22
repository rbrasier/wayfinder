import {
  domainError,
  err,
  ok,
  validateEventWatch,
  type EventWatch,
  type IAuditLogger,
  type IEventWatchRepository,
  type IFlowRepository,
  type IUserRepository,
  type NewEventWatch,
  type Result,
  type SecretChange,
  type WatchInputMapping,
} from "@rbrasier/domain";

export const EVENT_WATCH_RESOURCE_TYPE = "event_watch";

// Everything the editor saves, as one whole form.
export type EventWatchInput = Omit<NewEventWatch, "createdBy">;

export interface SaveEventWatchDependencies {
  watches: Pick<IEventWatchRepository, "findById" | "create" | "update">;
  flows: Pick<IFlowRepository, "findById">;
  users: Pick<IUserRepository, "findById">;
  auditLogger: IAuditLogger;
}

// Edits to these change what a poll sees, so the stored item state no longer
// describes it and the next poll must baseline again (ADR-063 §4).
const SOURCE_FIELDS = ["url", "method", "requestBody", "itemsPath", "itemIdPath", "condition"] as const;

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const invalid = (problems: string[]) => err(domainError("VALIDATION_FAILED", problems.join(" ")));

// Checks the parts of a watch that depend on other records — the flow it
// starts, who the runs belong to, and the flow's declared inputs — and returns
// the mapping with blank and undeclared entries dropped.
const checkReferences = async (
  dependencies: SaveEventWatchDependencies,
  watch: EventWatchInput,
): Promise<Result<WatchInputMapping>> => {
  const flow = await dependencies.flows.findById(watch.flowId);
  if (flow.error) return flow;
  if (!flow.data || flow.data.deletedAt) return invalid(["Choose a flow that still exists."]);
  if (flow.data.status !== "published") return invalid(["Publish the flow before a watch can start it."]);

  const user = await dependencies.users.findById(watch.runAsUserId);
  if (user.error) return user;
  if (!user.data) return invalid(["Choose a person who still has an account."]);

  const declared = flow.data.triggerInputs ?? [];
  const mapping = Object.fromEntries(
    declared.flatMap((triggerInput) => {
      const path = watch.inputMapping[triggerInput.key]?.trim();
      return path ? [[triggerInput.key, path]] : [];
    }),
  );
  const unmapped = declared.filter((triggerInput) => triggerInput.required && !(triggerInput.key in mapping));
  if (unmapped.length > 0) {
    return invalid(unmapped.map((triggerInput) => `Choose the field that supplies ${triggerInput.label || triggerInput.key}.`));
  }
  return ok(mapping);
};

const suppliesSecret = (secret: SecretChange): boolean => typeof secret === "string" && secret.trim() !== "";

const validate = async (
  dependencies: SaveEventWatchDependencies,
  watch: EventWatchInput,
  hasSecret: boolean,
): Promise<Result<EventWatchInput>> => {
  const problems = validateEventWatch({ ...watch, hasSecret });
  if (problems.length > 0) return invalid(problems);
  const mapping = await checkReferences(dependencies, watch);
  if (mapping.error) return mapping;
  return ok({ ...watch, name: watch.name.trim(), inputMapping: mapping.data });
};

// A connection without authentication keeps no secret at all.
const secretFor = (watch: EventWatchInput, secret: SecretChange): SecretChange => {
  if (watch.authType === "none") return null;
  return suppliesSecret(secret) ? secret : secret === null ? null : undefined;
};

export class CreateEventWatch {
  constructor(private readonly dependencies: SaveEventWatchDependencies) {}

  async execute(input: { watch: EventWatchInput; secret: string | null; actorId: string }): Promise<Result<EventWatch>> {
    const checked = await validate(this.dependencies, input.watch, suppliesSecret(input.secret));
    if (checked.error) return checked;

    const created = await this.dependencies.watches.create(
      { ...checked.data, createdBy: input.actorId },
      secretFor(checked.data, input.secret) ?? null,
    );
    if (created.error) return created;

    await this.dependencies.auditLogger.log({
      actorId: input.actorId,
      action: "event_watch.created",
      resourceType: EVENT_WATCH_RESOURCE_TYPE,
      resourceId: created.data.id,
      metadata: { name: created.data.name, flowId: created.data.flowId, runAsUserId: created.data.runAsUserId },
    });
    return created;
  }
}

export class UpdateEventWatch {
  constructor(private readonly dependencies: SaveEventWatchDependencies) {}

  // `secret`: undefined keeps the stored one, null clears it, a string replaces it.
  async execute(input: {
    id: string;
    watch: EventWatchInput;
    secret: SecretChange;
    actorId: string;
  }): Promise<Result<EventWatch>> {
    const existing = await this.dependencies.watches.findById(input.id);
    if (existing.error) return existing;
    if (!existing.data) return err(domainError("NOT_FOUND", "Event watch not found."));

    const hasSecret = input.secret === undefined ? existing.data.hasSecret : suppliesSecret(input.secret);
    const checked = await validate(this.dependencies, input.watch, hasSecret);
    if (checked.error) return checked;

    const changed = (Object.keys(checked.data) as Array<keyof EventWatchInput>).filter(
      (field) => !sameJson(checked.data[field], existing.data![field]),
    );
    const sourceChanged = SOURCE_FIELDS.some((field) => changed.includes(field));
    const secret = secretFor(checked.data, input.secret);

    const updated = await this.dependencies.watches.update(
      input.id,
      sourceChanged ? { ...checked.data, baselinePending: true } : checked.data,
      secret,
    );
    if (updated.error) return updated;

    await this.dependencies.auditLogger.log({
      actorId: input.actorId,
      action: "event_watch.updated",
      resourceType: EVENT_WATCH_RESOURCE_TYPE,
      resourceId: input.id,
      metadata: { name: checked.data.name, changed, secretChanged: secret !== undefined },
    });
    return updated;
  }
}
