import {
  createUserInputSchema,
  deleteUserInputSchema,
  listUsersInputSchema,
  updateUserInputSchema,
} from "@rbrasier/shared";
import { adminProcedure, authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const userRouter = router({
  me: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.repos.users.findById(ctx.userId);
    const user = result.error ? null : result.data;
    return {
      userId: ctx.userId,
      isAdmin: ctx.isAdmin,
      name: user?.name ?? null,
      email: user?.email ?? null,
    };
  }),

  list: adminProcedure.input(listUsersInputSchema).query(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.listUsers.execute(input);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  create: adminProcedure.input(createUserInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.createUser.execute(input);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  update: adminProcedure.input(updateUserInputSchema).mutation(async ({ ctx, input }) => {
    const { id, ...patch } = input;
    const result = await ctx.container.useCases.updateUser.execute(id, patch);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  delete: adminProcedure.input(deleteUserInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.deleteUser.execute(input.id);
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),
});
