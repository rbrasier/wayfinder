import { z } from "zod";
import { adminProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const periodEnum = z.enum(["daily", "weekly", "monthly"]);
const scopeEnum = z.enum(["everyone", "role", "user"]);

export const governanceRouter = router({
  dashboard: adminProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getGovernanceDashboard.execute({
        periodDays: input?.periodDays,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  budgets: router({
    list: adminProcedure.query(async ({ ctx }) => {
      const result = await ctx.container.useCases.listBudgets.execute();
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

    create: adminProcedure
      .input(
        z.object({
          scope: scopeEnum,
          // The use case validates the scope/target combination; userId and
          // roleKey are conditional on scope.
          roleKey: z.string().min(1).optional(),
          userId: z.string().uuid().optional(),
          period: periodEnum,
          limitUsd: z.number().positive(),
          warnThresholdPct: z.number().int().min(1).max(100).optional(),
          enabled: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.container.useCases.createBudget.execute(input);
        if (result.error) throw toTrpcError(result.error);
        return result.data;
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          period: periodEnum.optional(),
          limitUsd: z.number().positive().optional(),
          warnThresholdPct: z.number().int().min(1).max(100).optional(),
          enabled: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input;
        const result = await ctx.container.useCases.updateBudget.execute(id, patch);
        if (result.error) throw toTrpcError(result.error);
        return result.data;
      }),

    delete: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.container.useCases.deleteBudget.execute(input.id);
        if (result.error) throw toTrpcError(result.error);
        return result.data;
      }),
  }),

  settings: router({
    getUsageLimitsEnabled: adminProcedure.query(async ({ ctx }) => {
      const result = await ctx.container.useCases.getUsageLimitsEnabled.execute();
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

    setUsageLimitsEnabled: adminProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.container.useCases.setUsageLimitsEnabled.execute(input.enabled);
        if (result.error) throw toTrpcError(result.error);
        // The enforcer reads the switch through the cached runtime config, so the
        // change must take effect on the next AI call without a restart.
        ctx.container.runtimeConfig.invalidateUsageLimits();
        return result.data;
      }),
  }),
});
