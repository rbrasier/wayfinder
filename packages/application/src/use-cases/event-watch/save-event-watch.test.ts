import { describe, expect, it } from "vitest";
import {
  ok,
  type EventWatch,
  type EventWatchUpdate,
  type Flow,
  type NewAuditLog,
  type NewEventWatch,
  type SecretChange,
  type User,
} from "@wayfinder/domain";
import { CreateEventWatch, UpdateEventWatch, type EventWatchInput } from "./save-event-watch";

const input = (overrides: Partial<EventWatchInput> = {}): EventWatchInput => ({
  name: "Estimates hearings",
  url: "https://api.example.gov.au/hearings",
  method: "GET",
  requestBody: null,
  authType: "bearer",
  apiKeyPlacement: null,
  intervalMinutes: 2,
  itemsPath: "hearings",
  itemIdPath: "id",
  condition: { kind: "transition", fieldPath: "status", from: "live", to: "finished" },
  fireOncePerItem: true,
  maxRunsPerPoll: 20,
  failureThreshold: 5,
  flowId: "flow-1",
  inputMapping: { hearing_id: "id" },
  runAsUserId: "owner-1",
  ...overrides,
});

const stored = (overrides: Partial<EventWatch> = {}): EventWatch => ({
  ...input(),
  id: "watch-1",
  hasSecret: true,
  status: "active",
  baselinePending: false,
  consecutiveFailures: 0,
  lastError: null,
  pausedReason: null,
  pausedAt: null,
  pauseIncidentId: null,
  lastPolledAt: null,
  lastSuccessAt: null,
  nextPollAt: null,
  createdBy: "admin-1",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const publishedFlow = {
  id: "flow-1",
  status: "published",
  deletedAt: null,
  triggerInputs: [
    { key: "hearing_id", label: "Hearing", type: "text", required: true },
    { key: "note", label: "Note", type: "text", required: false },
  ],
} as unknown as Flow;

const build = (options: { flow?: Flow | null; user?: User | null; existing?: EventWatch } = {}) => {
  const created: Array<{ input: NewEventWatch; secret: SecretChange }> = [];
  const updated: Array<{ patch: EventWatchUpdate; secret: SecretChange }> = [];
  const audits: NewAuditLog[] = [];
  const dependencies = {
    watches: {
      findById: async () => ok(options.existing ?? null),
      create: async (watchInput: NewEventWatch, secret: SecretChange) => {
        created.push({ input: watchInput, secret });
        return ok(stored());
      },
      update: async (_id: string, patch: EventWatchUpdate, secret: SecretChange) => {
        updated.push({ patch, secret });
        return ok(stored());
      },
    },
    flows: { findById: async () => ok(options.flow === undefined ? publishedFlow : options.flow) },
    users: { findById: async () => ok(options.user === undefined ? ({ id: "owner-1" } as User) : options.user) },
    auditLogger: {
      log: async (entry: NewAuditLog) => {
        audits.push(entry);
        return ok(true as const);
      },
    },
  };
  return {
    create: new CreateEventWatch(dependencies),
    update: new UpdateEventWatch(dependencies),
    created,
    updated,
    audits,
  };
};

describe("CreateEventWatch", () => {
  it("saves a valid watch with its secret and audits it without the secret", async () => {
    const { create, created, audits } = build();

    const result = await create.execute({ watch: input(), secret: "api-token", actorId: "admin-1" });

    expect(result.error).toBeUndefined();
    expect(created[0]).toEqual({ input: { ...input(), createdBy: "admin-1" }, secret: "api-token" });
    expect(audits[0]).toMatchObject({ action: "event_watch.created", resourceType: "event_watch", actorId: "admin-1" });
    expect(JSON.stringify(audits)).not.toContain("api-token");
  });

  it("rejects a watch the validator finds problems with, naming them", async () => {
    const { create, created } = build();

    const result = await create.execute({ watch: input({ name: "" }), secret: null, actorId: "admin-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toBe("Give the watch a name. Enter the token or key for this connection.");
    expect(created).toEqual([]);
  });

  it("needs a published flow and a run-as person who still has an account", async () => {
    const unpublished = build({ flow: { ...publishedFlow, status: "draft" } as Flow });
    const missingUser = build({ user: null });

    const flowResult = await unpublished.create.execute({ watch: input(), secret: "t", actorId: "admin-1" });
    const userResult = await missingUser.create.execute({ watch: input(), secret: "t", actorId: "admin-1" });

    expect(flowResult.error?.message).toBe("Publish the flow before a watch can start it.");
    expect(userResult.error?.message).toBe("Choose a person who still has an account.");
  });

  it("requires every required trigger input to be mapped and drops undeclared ones", async () => {
    const unmapped = build();
    const extra = build();

    const missing = await unmapped.create.execute({
      watch: input({ inputMapping: { note: "title" } }),
      secret: "t",
      actorId: "admin-1",
    });
    await extra.create.execute({
      watch: input({ inputMapping: { hearing_id: "id", unknown: "x", note: " " } }),
      secret: "t",
      actorId: "admin-1",
    });

    expect(missing.error?.message).toBe("Choose the field that supplies Hearing.");
    expect(extra.created[0]!.input.inputMapping).toEqual({ hearing_id: "id" });
  });

  it("stores no secret for a connection without authentication", async () => {
    const { create, created } = build();

    await create.execute({ watch: input({ authType: "none" }), secret: "left-over", actorId: "admin-1" });

    expect(created[0]!.secret).toBeNull();
  });
});

describe("UpdateEventWatch", () => {
  it("keeps the stored secret when none is supplied", async () => {
    const { update, updated } = build({ existing: stored() });

    const result = await update.execute({ id: "watch-1", watch: input(), secret: undefined, actorId: "admin-1" });

    expect(result.error).toBeUndefined();
    expect(updated[0]!.secret).toBeUndefined();
  });

  it("re-baselines when the source or condition changes, but not for other edits", async () => {
    const source = build({ existing: stored() });
    const cosmetic = build({ existing: stored() });

    await source.update.execute({
      id: "watch-1",
      watch: input({ condition: { kind: "new_item" } }),
      secret: undefined,
      actorId: "admin-1",
    });
    await cosmetic.update.execute({
      id: "watch-1",
      watch: input({ name: "Renamed", intervalMinutes: 5 }),
      secret: undefined,
      actorId: "admin-1",
    });

    expect(source.updated[0]!.patch.baselinePending).toBe(true);
    expect(cosmetic.updated[0]!.patch.baselinePending).toBeUndefined();
  });

  it("audits which fields changed, and whether the secret did, never the secret", async () => {
    const { update, audits } = build({ existing: stored() });

    await update.execute({ id: "watch-1", watch: input({ name: "Renamed" }), secret: "new-token", actorId: "admin-1" });

    expect(audits[0]).toMatchObject({
      action: "event_watch.updated",
      resourceId: "watch-1",
      metadata: { name: "Renamed", changed: ["name"], secretChanged: true },
    });
    expect(JSON.stringify(audits)).not.toContain("new-token");
  });

  it("is NOT_FOUND for a watch that does not exist", async () => {
    const { update } = build();

    const result = await update.execute({ id: "missing", watch: input(), secret: undefined, actorId: "admin-1" });

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
