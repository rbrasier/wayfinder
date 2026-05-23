import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../trpc";

export const settingsRouter = router({
  get: adminProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.get(input.key);
      if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      return result.data ?? null;
    }),

  set: adminProcedure
    .input(z.object({ key: z.string().min(1), value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(input.key, input.value);
      if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      return result.data;
    }),
});
