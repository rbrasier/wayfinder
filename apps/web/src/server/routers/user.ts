import {
  createUserInputSchema,
  deleteUserInputSchema,
  listUsersInputSchema,
  resetUserPasswordInputSchema,
  updateProfileInputSchema,
  updateUserInputSchema,
} from "@rbrasier/shared";
import { adminCallerOf, anyPermissionProcedure, authenticatedProcedure, router, userAdminProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const userRouter = router({
  me: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.repos.users.findById(ctx.userId);
    const user = result.error ? null : result.data;
    return {
      userId: ctx.userId,
      isAdmin: ctx.isAdmin,
      name: user?.name ?? null,
      role: user?.role ?? null,
      team: user?.team ?? null,
      email: user?.email ?? null,
      permissions: [...ctx.permissions],
      // Drives the first-login welcome tour gate (ADR-056): pending until the
      // user completes or skips it, or an admin restarts it from Settings.
      welcomeTourPending: user ? user.welcomeTourCompletedAt === null : false,
    };
  }),

  completeWelcomeTour: authenticatedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.container.useCases.setWelcomeTourCompleted.execute(ctx.userId, true);
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),

  restartWelcomeTour: authenticatedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.container.useCases.setWelcomeTourCompleted.execute(ctx.userId, false);
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),

  updateProfile: authenticatedProcedure
    .input(updateProfileInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateUser.execute(ctx.userId, input, adminCallerOf(ctx));
      if (result.error) throw toTrpcError(result.error);
      return {
        name: result.data.name,
        role: result.data.role,
        team: result.data.team,
        email: result.data.email,
      };
    }),

  list: anyPermissionProcedure(["admin:users", "admin:oversight"]).input(listUsersInputSchema).query(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.listUsers.execute(input);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  create: userAdminProcedure.input(createUserInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.createUser.execute(input, adminCallerOf(ctx));
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  update: userAdminProcedure.input(updateUserInputSchema).mutation(async ({ ctx, input }) => {
    const { id, ...patch } = input;
    const result = await ctx.container.useCases.updateUser.execute(id, patch, adminCallerOf(ctx));
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  resetPassword: userAdminProcedure
    .input(resetUserPasswordInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.resetUserPassword.execute({
        actorId: ctx.userId,
        userId: input.id,
        password: input.password,
        caller: adminCallerOf(ctx),
      });
      if (result.error) throw toTrpcError(result.error);
      return { sessionsRevoked: result.data.sessionsRevoked };
    }),

  delete: userAdminProcedure.input(deleteUserInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.deleteUser.execute(input.id, adminCallerOf(ctx));
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),
});
