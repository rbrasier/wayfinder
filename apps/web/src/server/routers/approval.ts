import { z } from "zod";
import type { ApprovalNodeConfig, ApproverSource } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// 10 MB of evidence, expressed as the base64 that carries it — a scan or a
// photographed page fits comfortably, and a payload larger than this is a
// mistake rather than proof of an approval.
const OFF_SYSTEM_EVIDENCE_BASE64_LIMIT = Math.ceil((10 * 1024 * 1024 * 4) / 3);

export interface NextApprovalStep {
  nodeId: string;
  nodeName: string;
  approverSource: ApproverSource;
  roleHint: string | null;
  instructions: string | null;
}

// Where a decision left the session, when it left it on another approval. It
// lets the approver who just decided nominate the next approver from the same
// modal, instead of the request stalling until the originator reopens the chat.
// Best-effort: failing to describe the next step must not fail the decision that
// has already committed.
const resolveNextApproval = async (
  container: Container,
  newNodeId: string | null,
): Promise<NextApprovalStep | null> => {
  if (!newNodeId) return null;

  const nodeResult = await container.repos.flowNodes.findById(newNodeId);
  if (nodeResult.error || !nodeResult.data) return null;

  const node = nodeResult.data;
  if (node.type !== "approval") return null;

  const config = node.config as unknown as ApprovalNodeConfig;
  return {
    nodeId: node.id,
    nodeName: node.name?.trim() || "Approval",
    approverSource: config.approverSource,
    roleHint: config.roleHint?.trim() || null,
    instructions: config.instructions?.trim() || null,
  };
};

// Every mutation in the session router publishes this; none in this router did.
// The chat holds one EventSource keyed on it, so without it an open chat never
// learns that a request was sent, decided, withdrawn or reassigned — it would
// correct only on the next unrelated refresh.
//
// Fire-and-forget, matching the session router: the row has already committed,
// and a bus failure must not fail the action that succeeded.
const publishSessionUpdated = (
  ctx: { container: Container },
  sessionId: string,
): void => {
  void ctx.container.services.sessionEvents.publish(sessionId, { type: "session.updated" });
};

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

      // Resolved here rather than in SuggestApprover so the gate always has the
      // statement, whether the row was just raised or is being re-read. The
      // resolution caches itself on the pending row, so this costs at most one
      // model call per approval (ADR-040 §2).
      const subject = await ctx.container.useCases.resolveApprovalSubject.execute({
        approvalId: result.data.approval.id,
      });
      if (subject.error) throw toTrpcError(subject.error);

      return { ...result.data, subject: subject.data };
    }),

  // The gate's source of truth once a row exists. Read-only on purpose:
  // `suggest` has to be a mutation because it raises the row, and a UI reading
  // through a mutation can never refetch — which is what left the originator
  // showing "Choose the approver" for a request the previous approver had
  // already sent.
  forNode: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid(), nodeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.loadPendingApproval.execute(input);
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
        // The originator's note to the approver. Bounded like the decision
        // comment — it travels by email, and a whole document does not belong
        // in one.
        requestMessage: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.confirmAndSend.execute({
        approvalId: input.approvalId,
        approverUserId: input.approverUserId ?? null,
        approverEmail: input.approverEmail ?? null,
        isOverride: input.isOverride,
        requestMessage: input.requestMessage ?? null,
      });
      if (result.error) throw toTrpcError(result.error);
      publishSessionUpdated(ctx, result.data.sessionId);
      return result.data;
    }),

  // Changing who an open request is with, without pulling the work back a step.
  // Gated in the use case to the session owner or an admin — on a chained
  // approval the row's requester is the previous approver, not the person
  // watching the chat.
  reassign: authenticatedProcedure
    .input(
      z.object({
        approvalId: z.string().uuid(),
        approverUserId: z.string().uuid().nullish(),
        approverEmail: z.string().email().nullish(),
        isOverride: z.boolean().optional(),
        // Undefined keeps the note the request already carries; a supplied
        // value replaces it.
        requestMessage: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.reassignApproval.execute({
        approvalId: input.approvalId,
        reassignedByUserId: ctx.userId,
        approverUserId: input.approverUserId ?? null,
        approverEmail: input.approverEmail ?? null,
        isOverride: input.isOverride,
        ...(input.requestMessage !== undefined
          ? { requestMessage: input.requestMessage }
          : {}),
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      publishSessionUpdated(ctx, result.data.approval.sessionId);
      return result.data;
    }),

  // The originator taking their own request back before it is decided. The
  // use case gates it to the requester (or an admin) and returns the session to
  // the nearest prior conversational step.
  withdraw: authenticatedProcedure
    .input(
      z.object({
        approvalId: z.string().uuid(),
        reason: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.withdrawApproval.execute({
        approvalId: input.approvalId,
        withdrawnByUserId: ctx.userId,
        reason: input.reason ?? null,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      publishSessionUpdated(ctx, result.data.approval.sessionId);
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
      publishSessionUpdated(ctx, result.data.approval.sessionId);

      const nextApproval = await resolveNextApproval(ctx.container, result.data.newNodeId);
      // Who to tell, when email cannot tell them. Best-effort by construction:
      // the decision has already committed, so a resolution failure costs a
      // suggestion, not the decision.
      const notify = await ctx.container.useCases.resolveDecisionNotifyTargets.execute({
        approval: result.data.approval,
        newNodeId: result.data.newNodeId,
        sessionCompleted: result.data.sessionCompleted,
        decidedByUserId: ctx.userId,
      });
      return {
        ...result.data,
        nextApproval,
        notifyTargets: notify.error ? [] : notify.data,
      };
    }),

  // Records that the assigned approver approved outside Wayfinder (ADR-055).
  // Distinct from `decide` because it authorises a different person on a
  // different question: the nominator, who is not the approver.
  //
  // The evidence rides the mutation as base64, matching how the extraction
  // router takes an uploaded template, so the panel keeps one code path for the
  // decision, the cache invalidation and the session event.
  recordOffSystem: authenticatedProcedure
    .input(
      z.object({
        approvalId: z.string().uuid(),
        // The calendar date the approval happened. Validated against the
        // session it belongs to in the use case, not here.
        approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD."),
        comment: z.string().max(2000).nullish(),
        evidenceFilename: z.string().min(1).max(255),
        evidenceMimeType: z.string().min(1).max(255),
        evidenceContentBase64: z.string().min(1).max(OFF_SYSTEM_EVIDENCE_BASE64_LIMIT),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.recordOffSystemApproval.execute({
        approvalId: input.approvalId,
        nominatedByUserId: ctx.userId,
        approvedOn: input.approvedOn,
        comment: input.comment ?? null,
        evidence: {
          filename: input.evidenceFilename,
          mimeType: input.evidenceMimeType,
          bytes: Buffer.from(input.evidenceContentBase64, "base64"),
        },
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      publishSessionUpdated(ctx, result.data.approval.sessionId);

      const nextApproval = await resolveNextApproval(ctx.container, result.data.newNodeId);
      return { ...result.data, nextApproval };
    }),

  // Enriched with the context the approver needs to decide: chat name, who
  // raised it, and the previous step's key output (document or output fields).
  listPending: authenticatedProcedure.query(async ({ ctx }) => {
    const userResult = await ctx.container.repos.users.findById(ctx.userId);
    if (userResult.error) throw toTrpcError(userResult.error);
    const result = await ctx.container.useCases.listApprovalsWithContext.execute({
      approverUserId: ctx.userId,
      approverEmail: userResult.data?.email ?? null,
    });
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  // The same context, widened past the pending queue so an approver can review
  // what they have already decided and where that work ended up.
  list: authenticatedProcedure
    .input(z.object({ scope: z.enum(["pending", "decided", "all"]).default("pending") }))
    .query(async ({ ctx, input }) => {
      const userResult = await ctx.container.repos.users.findById(ctx.userId);
      if (userResult.error) throw toTrpcError(userResult.error);
      const result = await ctx.container.useCases.listApprovalsWithContext.execute({
        approverUserId: ctx.userId,
        approverEmail: userResult.data?.email ?? null,
        scope: input.scope,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // One decision, for its own page. The authorisation lives in the use case
  // because the rule is about the approval rather than the session: being named
  // on any approval of a session already opens that session (ADR-018), but a
  // decision record is only readable by the people it is about.
  get: authenticatedProcedure
    .input(z.object({ approvalId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userResult = await ctx.container.repos.users.findById(ctx.userId);
      if (userResult.error) throw toTrpcError(userResult.error);
      const result = await ctx.container.useCases.listApprovalsWithContext.getById({
        approvalId: input.approvalId,
        viewerUserId: ctx.userId,
        viewerEmail: userResult.data?.email ?? null,
        isAdmin: ctx.isAdmin,
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
