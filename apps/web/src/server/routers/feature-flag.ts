import { z } from "zod";
import { adminProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const featureFlagRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listFeatureFlags.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  upsert: adminProcedure
    .input(
      z.object({
        key: z.string().min(1),
        enabled: z.boolean(),
        rolloutPct: z.number().min(0).max(100).default(100),
        description: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.upsertFeatureFlag.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
