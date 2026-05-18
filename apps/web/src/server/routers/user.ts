import {
  createUserInputSchema,
  deleteUserInputSchema,
  listUsersInputSchema,
  updateUserInputSchema,
} from "@rbrasier/shared";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../trpc";

export const userRouter = router({
  list: adminProcedure.input(listUsersInputSchema).query(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.listUsers.execute(input);
    if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
    return result.data;
  }),

  create: adminProcedure.input(createUserInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.createUser.execute(input);
    if (result.error) {
      const code = result.error.code === "ALREADY_EXISTS" ? "CONFLICT" : "INTERNAL_SERVER_ERROR";
      throw new TRPCError({ code, message: result.error.message });
    }
    return result.data;
  }),

  update: adminProcedure.input(updateUserInputSchema).mutation(async ({ ctx, input }) => {
    const { id, ...patch } = input;
    const result = await ctx.container.useCases.updateUser.execute(id, patch);
    if (result.error) {
      const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
      throw new TRPCError({ code, message: result.error.message });
    }
    return result.data;
  }),

  delete: adminProcedure.input(deleteUserInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.deleteUser.execute(input.id);
    if (result.error) {
      const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
      throw new TRPCError({ code, message: result.error.message });
    }
    return { ok: true };
  }),
});
