import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, authenticatedProcedure, router } from "../trpc";

export const sessionRouter = router({
  list: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listSessions.execute(ctx.userId);
    if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
    return result.data;
  }),

  listAll: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listAllSessions.execute();
    if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
    return result.data;
  }),

  get: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getSession.execute(input.sessionId);
      if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      if (!result.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });

      const { session } = result.data;
      if (!ctx.isAdmin && session.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
      }

      return result.data;
    }),

  create: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.startSession.execute({
        flowId: input.flowId,
        userId: ctx.userId,
      });
      if (result.error) {
        const code = result.error.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : result.error.code === "VALIDATION_FAILED"
          ? "BAD_REQUEST"
          : "INTERNAL_SERVER_ERROR";
        throw new TRPCError({ code, message: result.error.message });
      }
      return result.data;
    }),

  listPublishedFlows: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listFlows.execute();
    if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
    return result.data.filter((f) => f.status === "published");
  }),

  overrideBranch: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid(), targetNodeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sessionResult = await ctx.container.useCases.getSession.execute(input.sessionId);
      if (sessionResult.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: sessionResult.error.message });
      if (!sessionResult.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      if (!ctx.isAdmin && sessionResult.data.session.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
      }
      const result = await ctx.container.useCases.overrideBranch.execute({
        sessionId: input.sessionId,
        targetNodeId: input.targetNodeId,
      });
      if (result.error) {
        const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND"
          : result.error.code === "VALIDATION_FAILED" ? "BAD_REQUEST"
          : "INTERNAL_SERVER_ERROR";
        throw new TRPCError({ code, message: result.error.message });
      }
      return result.data;
    }),
});
