import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const approvalRouter = router({
  // Reaching an approval node: compute the suggestion and write/return the
  // pending row that gates the session.
  suggest: authenticatedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        flowId: z.string().uuid(),
        nodeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.suggestApprover.execute({
        sessionId: input.sessionId,
        flowId: input.flowId,
        nodeId: input.nodeId,
        requestedByUserId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  confirmAndSend: authenticatedProcedure
    .input(
      z.object({
        approvalId: z.string().uuid(),
        approverUserId: z.string().uuid().nullish(),
        approverEmail: z.string().email().nullish(),
        isOverride: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.confirmAndSend.execute({
        approvalId: input.approvalId,
        approverUserId: input.approverUserId ?? null,
        approverEmail: input.approverEmail ?? null,
        isOverride: input.isOverride,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  decide: authenticatedProcedure
    .input(
      z.object({
        approvalId: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "changes_requested"]),
        comment: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.decideApproval.execute({
        approvalId: input.approvalId,
        decidedByUserId: ctx.userId,
        decision: input.decision,
        comment: input.comment ?? null,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  listPending: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listPendingApprovals.execute(ctx.userId);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),
});
