import { z } from "zod";
import { adminProcedure, authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const usageRouter = router({
  // The signed-in user's own effective limits + current spend for the sidebar
  // meter. Non-admin; exposes only the caller's own numbers (ADR-031).
  myUsage: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.getUserUsage.execute(ctx.userId);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  summary: adminProcedure
    .input(
      z
        .object({
          userId: z.string().uuid().optional(),
          provider: z.string().optional(),
          model: z.string().optional(),
          from: z.date().optional(),
          to: z.date().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getUsageSummary.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
