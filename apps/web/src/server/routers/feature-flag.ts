import { z } from "zod";
import { authenticatedProcedure, router, technicalAdminProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { ADMIN_SURFACE_FLAGS, isAdminSurfaceEnabled } from "../admin-surface-flags";

export const featureFlagRouter = router({
  isEnabledForMe: authenticatedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.isFeatureEnabledForUser.execute(
        ctx.userId,
        input.key,
        ctx.isAdmin,
      );
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // For the admin sidebar and screens only (ADR-066 §5); authoring keeps
  // isEnabledForMe, so a Technical Admin gains no authoring capability here.
  isAdminSurfaceEnabled: technicalAdminProcedure
    .input(z.object({ key: z.enum(ADMIN_SURFACE_FLAGS) }))
    .query(({ ctx, input }) => isAdminSurfaceEnabled(ctx.container, input.key)),

  list: technicalAdminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listFeatureFlags.execute();
    if (result.error) throw toTrpcError(result.error);

    const withRoles = await Promise.all(
      result.data.map(async (flag) => {
        const allowlist = await ctx.container.repos.featureFlagRoles.listRoleIdsForFlag(flag.key);
        return { ...flag, roleIds: allowlist.error ? [] : allowlist.data };
      }),
    );
    return withRoles;
  }),

  upsert: technicalAdminProcedure
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

  setRoles: technicalAdminProcedure
    .input(z.object({ key: z.string().min(1), roleIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.setFeatureFlagRoles.execute(input.key, input.roleIds);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),
});
