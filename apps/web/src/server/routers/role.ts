import { PERMISSIONS, type PermissionKey } from "@rbrasier/domain";
import { z } from "zod";
import { adminProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const permissionKeySchema = z.enum(
  PERMISSIONS.map((permission) => permission.key) as [PermissionKey, ...PermissionKey[]],
);

export const roleRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
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
        roleId: z.string().uuid(),
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
    .input(z.object({ roleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.deleteRole.execute(input.roleId);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  updatePermissions: adminProcedure
    .input(z.object({ roleId: z.string().uuid(), keys: z.array(permissionKeySchema) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateRolePermissions.execute(
        input.roleId,
        input.keys,
      );
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  assignUser: adminProcedure
    .input(z.object({ userId: z.string().uuid(), roleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.assignUserRole.execute(input.userId, input.roleId);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  removeUser: adminProcedure
    .input(z.object({ userId: z.string().uuid(), roleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.removeUserRole.execute(input.userId, input.roleId);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  listUsers: adminProcedure
    .input(z.object({ roleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.listUsersForRole.execute(input.roleId);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
