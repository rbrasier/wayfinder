import {
  listErrorsInputSchema,
  logErrorInputSchema,
  updateErrorStatusInputSchema,
} from "@rbrasier/shared";
import { TRPCError } from "@trpc/server";
import { adminProcedure, publicProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const errorRouter = router({
  // Public: clients (and the global error boundary) can write errors.
  log: publicProcedure.input(logErrorInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.logError.execute({
      level: input.level,
      message: input.message,
      stack: input.stack ?? null,
      userId: ctx.userId,
      page: input.page ?? null,
      metadata: input.metadata ?? null,
    });
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),

  listGrouped: adminProcedure.input(listErrorsInputSchema).query(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.listErrors.listGrouped(input);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  listInGroup: adminProcedure
    .input(updateErrorStatusInputSchema.pick({ message: true, page: true }))
    .query(async ({ ctx, input }) => {
      if (!input.message)
        throw new TRPCError({ code: "BAD_REQUEST", message: "message required" });
      const result = await ctx.container.useCases.listErrors.listInGroup(
        input.message,
        input.page ?? null,
      );
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  deleteAll: adminProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.container.useCases.deleteAllErrors.execute();
    if (result.error) throw toTrpcError(result.error);
    return { deleted: result.data };
  }),

  updateStatus: adminProcedure
    .input(updateErrorStatusInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const r = await ctx.container.useCases.updateErrorStatus.byId(input.id, input.status);
        if (r.error) throw toTrpcError(r.error);
        return { updated: 1 };
      }
      if (!input.message)
        throw new TRPCError({ code: "BAD_REQUEST", message: "id or message required" });
      const r = await ctx.container.useCases.updateErrorStatus.byGroup(
        input.message,
        input.page ?? null,
        input.status,
      );
      if (r.error) throw toTrpcError(r.error);
      return { updated: r.data };
    }),
});
