import { z } from "zod";
import { adminProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({ kind: z.literal("by_session"), sessionId: z.string().min(1) }),
]);

export const legalHoldRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.repos.legalHolds.list();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        reason: z.string().nullish(),
        scope: scopeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.legalHolds.create({
        name: input.name,
        reason: input.reason ?? null,
        createdBy: ctx.userId,
        scope: input.scope,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  release: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.legalHolds.release(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
