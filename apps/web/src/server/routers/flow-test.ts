import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { canEditFlow } from "./flow";

// Every procedure here is gated on edit rights for the flow, reusing the same
// helper the flow router uses rather than re-deriving owner/admin: flow
// permissions already carry group and organisation visibility, and a
// hand-rolled check would drift from them. A test run of a draft must never
// become a route for an operator to reach unpublished work (ADR-048 §3).
const assertCanEdit = async (
  ctx: { container: Parameters<typeof canEditFlow>[0]; userId: string; isAdmin: boolean },
  flowId: string,
): Promise<void> => {
  if (await canEditFlow(ctx.container, flowId, ctx.userId, ctx.isAdmin)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You do not have permission to test this flow.",
  });
};

const seedContextItemSchema = z.object({
  nodeId: z.string().guid(),
  key: z.string(),
  value: z.string(),
});

const seedStepOutputSchema = z.object({
  nodeId: z.string().guid(),
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.string(),
      options: z.array(z.string()).optional(),
      value: z.string(),
      items: z.array(z.record(z.string(), z.string())).optional(),
    }),
  ),
});

const seedSchema = z.object({
  gatheredContext: z.array(seedContextItemSchema).default([]),
  stepOutputs: z.array(seedStepOutputSchema).default([]),
});

export const flowTestRouter = router({
  start: authenticatedProcedure
    .input(
      z.object({
        flowId: z.string().guid(),
        startNodeId: z.string().guid().optional(),
        seed: seedSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanEdit(ctx, input.flowId);

      const result = await ctx.container.useCases.startTestRun.execute({
        flowId: input.flowId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
        startNodeId: input.startNodeId,
        // Cast: the router validates shape, the domain owns meaning. The seed
        // validator re-checks every value against the node's declared fields
        // before a single row is written, so a wrong `type` string here becomes
        // a reported reject rather than a bad row.
        seed: input.seed as never,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  report: authenticatedProcedure
    .input(z.object({ sessionId: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getTestRunReport.execute({
        sessionId: input.sessionId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  delete: authenticatedProcedure
    .input(z.object({ sessionId: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.deleteTestSession.execute({
        sessionId: input.sessionId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return { deleted: true };
    }),

  // Real sessions on this flow that a seed could be cloned from. Live only —
  // cloning a previous test run would seed a test from invented data.
  listSeedableSessions: authenticatedProcedure
    .input(z.object({ flowId: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      await assertCanEdit(ctx, input.flowId);

      const result = await ctx.container.repos.sessions.listAll("live");
      if (result.error) throw toTrpcError(result.error);

      return result.data
        .filter((session) => session.flowId === input.flowId)
        .map((session) => ({
          id: session.id,
          title: session.title,
          status: session.status,
          updatedAt: session.updatedAt,
        }));
    }),

  cloneSeed: authenticatedProcedure
    .input(z.object({ sessionId: z.string().guid(), upToNodeId: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.buildSeedFromSession.execute({
        sessionId: input.sessionId,
        upToNodeId: input.upToNodeId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  generateSeed: authenticatedProcedure
    .input(z.object({ flowId: z.string().guid(), startNodeId: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanEdit(ctx, input.flowId);

      const result = await ctx.container.useCases.generateSeed.execute({
        flowId: input.flowId,
        startNodeId: input.startNodeId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  fixture: router({
    // Scoped to the caller in the repository, not here: a fixture cloned from a
    // live session can hold real personal data, so "not yours" and "not found"
    // must be the same answer.
    list: authenticatedProcedure
      .input(z.object({ flowId: z.string().guid() }))
      .query(async ({ ctx, input }) => {
        await assertCanEdit(ctx, input.flowId);

        const result = await ctx.container.repos.flowTestFixtures.listByFlow(
          input.flowId,
          ctx.userId,
        );
        if (result.error) throw toTrpcError(result.error);
        return result.data;
      }),

    create: authenticatedProcedure
      .input(
        z.object({
          flowId: z.string().guid(),
          name: z.string().min(1).max(200),
          startNodeId: z.string().guid(),
          gatheredContext: z.array(seedContextItemSchema).default([]),
          stepOutputs: z.array(seedStepOutputSchema).default([]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertCanEdit(ctx, input.flowId);

        const result = await ctx.container.repos.flowTestFixtures.create({
          flowId: input.flowId,
          name: input.name,
          startNodeId: input.startNodeId,
          gatheredContext: input.gatheredContext,
          stepOutputs: input.stepOutputs as never,
          createdByUserId: ctx.userId,
        });
        if (result.error) throw toTrpcError(result.error);
        return result.data;
      }),

    update: authenticatedProcedure
      .input(
        z.object({
          id: z.string().guid(),
          name: z.string().min(1).max(200).optional(),
          startNodeId: z.string().guid().optional(),
          gatheredContext: z.array(seedContextItemSchema).optional(),
          stepOutputs: z.array(seedStepOutputSchema).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input;
        const result = await ctx.container.repos.flowTestFixtures.update(
          id,
          ctx.userId,
          patch as never,
        );
        if (result.error) throw toTrpcError(result.error);
        return result.data;
      }),

    delete: authenticatedProcedure
      .input(z.object({ id: z.string().guid() }))
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.container.repos.flowTestFixtures.delete(input.id, ctx.userId);
        if (result.error) throw toTrpcError(result.error);
        return { deleted: true };
      }),
  }),
});
