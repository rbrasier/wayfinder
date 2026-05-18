import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../trpc";

export const usageRouter = router({
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
      if (result.error)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      return result.data;
    }),
});
