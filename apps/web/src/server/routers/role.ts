import { PERMISSIONS, type PermissionKey } from "@rbrasier/domain";
import { z } from "zod";
import { adminCallerOf, adminProcedure, anyPermissionProcedure, router, userAdminProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const permissionKeySchema = z.enum(
  PERMISSIONS.map((permission) => permission.key) as [PermissionKey, ...PermissionKey[]],
);

export const roleRouter = router({
  // Read by user management, the Flags page and spend caps (ADR-066 §4).
  list: anyPermissionProcedure(["admin:users", "admin:technical", "admin:oversight"]).query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listRoles.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(1), description: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.createRole.execute({
        name: input.name,
        description: input.description ?? null,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  rename: adminProcedure
    .input(
      z.object({
        roleId: z.string().guid(),
        name: z.string().min(1),
        description: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.renameRole.execute({
        roleId: input.roleId,
        name: input.name,
        description: input.description,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  delete: adminProcedure
    .input(z.object({ roleId: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.deleteRole.execute(input.roleId);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  updatePermissions: adminProcedure
    .input(z.object({ roleId: z.string().guid(), keys: z.array(permissionKeySchema) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateRolePermissions.execute(
        input.roleId,
        input.keys,
      );
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  assignUser: userAdminProcedure
    .input(z.object({ userId: z.string().guid(), roleId: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.assignUserRole.execute(input.userId, input.roleId, adminCallerOf(ctx));
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  removeUser: userAdminProcedure
    .input(z.object({ userId: z.string().guid(), roleId: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.removeUserRole.execute(input.userId, input.roleId, adminCallerOf(ctx));
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  listUsers: userAdminProcedure
    .input(z.object({ roleId: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.listUsersForRole.execute(input.roleId);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
