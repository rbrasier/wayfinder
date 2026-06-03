import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const assertOwnsSession = async (
  ctx: Parameters<Parameters<typeof authenticatedProcedure.query>[0]>[0]["ctx"],
  sessionId: string,
): Promise<void> => {
  const session = await ctx.container.repos.sessions.findById(sessionId);
  if (session.error) throw toTrpcError(session.error);
  if (!session.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
  if (session.data.userId !== ctx.userId && !ctx.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this session." });
  }
};

export const scheduleRouter = router({
  listForSession: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwnsSession(ctx, input.sessionId);
      const result = await ctx.container.repos.schedules.listForSession(input.sessionId);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  cancel: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid(), scheduleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsSession(ctx, input.sessionId);

      const existing = await ctx.container.repos.schedules.listForSession(input.sessionId);
      if (existing.error) throw toTrpcError(existing.error);
      const owned = existing.data.some((schedule) => schedule.id === input.scheduleId);
      if (!owned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found for this session." });
      }

      const result = await ctx.container.repos.schedules.cancel(input.scheduleId);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
