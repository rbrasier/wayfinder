import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../trpc";

export const featureFlagRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listFeatureFlags.execute();
    if (result.error)
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
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
      if (result.error)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      return result.data;
    }),
});
