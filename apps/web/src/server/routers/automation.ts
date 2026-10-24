import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { WebhookActor } from "@rbrasier/application";
import { buildRetryFailedStep } from "@/lib/automation/unattended-runs";
import { authenticatedProcedure, router, type TrpcContext } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { canEditFlow } from "./flow";

const RUN_HISTORY_LIMIT = 50;

const triggerInputSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().max(120),
  type: z.enum(["text", "number", "date", "boolean", "json"]),
  required: z.boolean(),
});

const actorOf = (ctx: TrpcContext & { userId: string }): WebhookActor => ({
  userId: ctx.userId,
  isAdmin: ctx.isAdmin,
  canUseWebhooks: ctx.isAdmin || ctx.permissions.has("flow:webhook_trigger"),
});

const requireFlowEditor = async (ctx: TrpcContext & { userId: string }, flowId: string): Promise<void> => {
  if (!(await canEditFlow(ctx.container, flowId, ctx.userId, ctx.isAdmin))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
  }
};

// A flow's triggers (ADR-064) and the unattended runs they start (ADR-065):
// the flow editor's Triggers tab reads and writes through here.
export const automationRouter = router({
  flowTriggers: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireFlowEditor(ctx, input.flowId);
      const [flow, webhook] = await Promise.all([
        ctx.container.repos.flows.findById(input.flowId),
        ctx.container.repos.flowTriggers.findByFlow(input.flowId, "webhook"),
      ]);
      if (flow.error) throw toTrpcError(flow.error);
      if (webhook.error) throw toTrpcError(webhook.error);
      return {
        triggerInputs: flow.data?.triggerInputs ?? [],
        webhook: webhook.data,
        webhookUrl: `${ctx.container.env.BETTER_AUTH_URL}/api/triggers/${input.flowId}`,
        canManageWebhook: actorOf(ctx).canUseWebhooks,
        isAdmin: ctx.isAdmin,
      };
    }),

  setTriggerInputs: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid(), inputs: z.array(triggerInputSchema).max(50) }))
    .mutation(async ({ ctx, input }) => {
      await requireFlowEditor(ctx, input.flowId);
      const result = await ctx.container.useCases.setTriggerInputs.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return { triggerInputs: result.data.triggerInputs ?? [] };
    }),

  configureWebhook: authenticatedProcedure
    .input(
      z.object({ flowId: z.string().uuid(), enabled: z.boolean(), runAsUserId: z.string().uuid().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.configureWebhookTrigger.execute({
        flowId: input.flowId,
        actor: actorOf(ctx),
        enabled: input.enabled,
        runAsUserId: input.runAsUserId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  rotateWebhookToken: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.rotateWebhookToken.execute({
        flowId: input.flowId,
        actor: actorOf(ctx),
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  setWebhookHmac: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.setWebhookHmac.execute({
        flowId: input.flowId,
        actor: actorOf(ctx),
        enabled: input.enabled,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  webhookRuns: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireFlowEditor(ctx, input.flowId);
      const webhook = await ctx.container.repos.flowTriggers.findByFlow(input.flowId, "webhook");
      if (webhook.error) throw toTrpcError(webhook.error);
      if (!webhook.data) return [];
      const runs = await ctx.container.useCases.listTriggerRuns.execute({
        sourceId: webhook.data.id,
        limit: RUN_HISTORY_LIMIT,
      });
      if (runs.error) throw toTrpcError(runs.error);
      return runs.data;
    }),

  retryRun: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await buildRetryFailedStep(ctx.container).execute({
        sessionId: input.sessionId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
