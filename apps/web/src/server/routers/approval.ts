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
        // Only consulted for `rejected`: route the session back to the originator
        // or close the request entirely.
        routeBack: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.decideApproval.execute({
        approvalId: input.approvalId,
        decidedByUserId: ctx.userId,
        decision: input.decision,
        comment: input.comment ?? null,
        routeBack: input.routeBack,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Enriched with the context the approver needs to decide: chat name, who
  // raised it, and the previous step's key output (document or output fields).
  listPending: authenticatedProcedure.query(async ({ ctx }) => {
    const userResult = await ctx.container.repos.users.findById(ctx.userId);
    if (userResult.error) throw toTrpcError(userResult.error);
    const result = await ctx.container.useCases.listPendingApprovalsWithContext.execute({
      approverUserId: ctx.userId,
      approverEmail: userResult.data?.email ?? null,
    });
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  // Whether an approval request can actually be emailed. False when notifications
  // are disabled or no transport is configured, so the gate can offer the
  // operator a manual fallback (mailto / copy link) instead.
  emailStatus: authenticatedProcedure.query(async ({ ctx }) => {
    const configured =
      ctx.container.env.NOTIFICATIONS_ENABLED &&
      (await ctx.container.services.emailSender.isConfigured());
    return { configured };
  }),
});
