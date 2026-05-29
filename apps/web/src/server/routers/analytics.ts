import { z } from "zod";
import { adminProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const analyticsRouter = router({
  overview: adminProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getOverviewDashboard.execute({
        periodDays: input?.periodDays,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  flowDeepDive: adminProcedure
    .input(z.object({ flowId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getFlowDeepDive.execute({
        flowId: input?.flowId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
