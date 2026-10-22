import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const RUN_HISTORY_LIMIT = 50;

// Admin-only, and only while the event_watch flag is on for the admin (ADR-063 §8).
const eventWatchProcedure = authenticatedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
  const enabled = await ctx.container.useCases.isFeatureEnabledForUser.execute(ctx.userId, "event_watch", true);
  if (enabled.error || enabled.data !== true) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Event Watch is switched off." });
  }
  return next();
});

const conditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("transition"),
    fieldPath: z.string().max(500),
    from: z.string().max(500).nullable(),
    to: z.string().max(500),
  }),
  z.object({
    kind: z.literal("matches"),
    fieldPath: z.string().max(500),
    operator: z.enum(["equals", "not_equals", "contains", "regex"]),
    value: z.string().max(500),
  }),
  z.object({ kind: z.literal("new_item") }),
  z.object({ kind: z.literal("changed"), fieldPath: z.string().max(500) }),
]);

const connectionSchema = z.object({
  url: z.string().max(2000),
  method: z.enum(["GET", "POST"]),
  requestBody: z.unknown(),
  authType: z.enum(["none", "bearer", "api_key"]),
  apiKeyPlacement: z.object({ in: z.enum(["header", "query"]), name: z.string().max(200) }).nullable(),
});

const watchSchema = connectionSchema.extend({
  name: z.string().max(120),
  intervalMinutes: z.number().int(),
  itemsPath: z.string().max(500),
  itemIdPath: z.string().max(500),
  condition: conditionSchema,
  fireOncePerItem: z.boolean(),
  maxRunsPerPoll: z.number().int(),
  failureThreshold: z.number().int(),
  flowId: z.string().uuid(),
  inputMapping: z.record(z.string().max(64), z.string().max(500)),
  runAsUserId: z.string().uuid(),
});

// `undefined` keeps the stored secret, `null` clears it, a string replaces it.
const secretSchema = z.string().max(4000).nullable().optional();

// Zod reads `unknown` as optional; the use cases want a body that is always set.
const withBody = <T extends { requestBody?: unknown }>(value: T): T & { requestBody: unknown } => ({
  ...value,
  requestBody: value.requestBody ?? null,
});

const byId = z.object({ id: z.string().uuid() });

// Admin → Event Watch (ADR-063): the list, the editor and run history.
export const eventWatchRouter = router({
  list: eventWatchProcedure.query(async ({ ctx }) => {
    const listings = await ctx.container.useCases.listEventWatches.execute();
    if (listings.error) throw toTrpcError(listings.error);
    const flows = await ctx.container.repos.flows.list();
    const people = await ctx.container.repos.users.findByIds([
      ...new Set(listings.data.map((listing) => listing.watch.runAsUserId)),
    ]);
    const flowNames = new Map((flows.data ?? []).map((flow) => [flow.id, flow.name]));
    const personNames = new Map((people.data ?? []).map((person) => [person.id, person.name ?? person.email]));
    return listings.data.map((listing) => ({
      ...listing,
      flowName: flowNames.get(listing.watch.flowId) ?? null,
      runAsName: personNames.get(listing.watch.runAsUserId) ?? null,
    }));
  }),

  get: eventWatchProcedure.input(byId).query(async ({ ctx, input }) => {
    const watch = await ctx.container.repos.eventWatches.findById(input.id);
    if (watch.error) throw toTrpcError(watch.error);
    if (!watch.data) throw new TRPCError({ code: "NOT_FOUND", message: "Event watch not found." });
    const runAs = await ctx.container.repos.users.findById(watch.data.runAsUserId);
    return {
      watch: watch.data,
      runAs: runAs.data ? { userId: runAs.data.id, email: runAs.data.email, displayName: runAs.data.name } : null,
    };
  }),

  // Published guided flows a watch can start, with the inputs each declares.
  flowOptions: eventWatchProcedure.query(async ({ ctx }) => {
    const flows = await ctx.container.repos.flows.list();
    if (flows.error) throw toTrpcError(flows.error);
    return flows.data
      .filter((flow) => flow.status === "published" && !flow.deletedAt)
      .map((flow) => ({ id: flow.id, name: flow.name, triggerInputs: flow.triggerInputs ?? [] }));
  }),

  countNeedingAttention: eventWatchProcedure.query(async ({ ctx }) => {
    const count = await ctx.container.useCases.countWatchesNeedingAttention.execute();
    if (count.error) throw toTrpcError(count.error);
    return count.data;
  }),

  create: eventWatchProcedure
    .input(z.object({ watch: watchSchema, secret: z.string().max(4000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.container.useCases.createEventWatch.execute({
        watch: withBody(input.watch),
        secret: input.secret,
        actorId: ctx.userId,
      });
      if (created.error) throw toTrpcError(created.error);
      return created.data;
    }),

  update: eventWatchProcedure
    .input(byId.extend({ watch: watchSchema, secret: secretSchema }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.container.useCases.updateEventWatch.execute({
        id: input.id,
        watch: withBody(input.watch),
        secret: input.secret,
        actorId: ctx.userId,
      });
      if (updated.error) throw toTrpcError(updated.error);
      return updated.data;
    }),

  delete: eventWatchProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const deleted = await ctx.container.useCases.deleteEventWatch.execute({ id: input.id, actorId: ctx.userId });
    if (deleted.error) throw toTrpcError(deleted.error);
    return { id: input.id };
  }),

  pause: eventWatchProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const paused = await ctx.container.useCases.pauseEventWatch.execute({ id: input.id, actorId: ctx.userId });
    if (paused.error) throw toTrpcError(paused.error);
    return paused.data;
  }),

  resume: eventWatchProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const resumed = await ctx.container.useCases.resumeEventWatch.execute({ id: input.id, actorId: ctx.userId });
    if (resumed.error) throw toTrpcError(resumed.error);
    return resumed.data;
  }),

  // A failed request is an answer, not an error: the editor shows it in place.
  test: eventWatchProcedure
    .input(z.object({ watchId: z.string().uuid().optional(), connection: connectionSchema, secret: secretSchema }))
    .mutation(async ({ ctx, input }) => {
      const sample = await ctx.container.useCases.testEventWatch.execute({
        watchId: input.watchId,
        connection: withBody(input.connection),
        secret: input.secret,
        actorId: ctx.userId,
      });
      if (sample.error) return { ok: false as const, message: sample.error.message };
      return { ok: true as const, ...sample.data };
    }),

  preview: eventWatchProcedure
    .input(
      z.object({
        sample: z.unknown(),
        itemsPath: z.string().max(500),
        itemIdPath: z.string().max(500),
        condition: conditionSchema,
      }),
    )
    .mutation(({ ctx, input }) => {
      const preview = ctx.container.useCases.previewEventWatch.execute({ ...input, sample: input.sample ?? null });
      if (preview.error) return { ok: false as const, message: preview.error.message };
      return { ok: true as const, ...preview.data };
    }),

  runs: eventWatchProcedure.input(byId).query(async ({ ctx, input }) => {
    const runs = await ctx.container.useCases.listTriggerRuns.execute({
      sourceId: input.id,
      limit: RUN_HISTORY_LIMIT,
    });
    if (runs.error) throw toTrpcError(runs.error);
    return runs.data;
  }),
});
