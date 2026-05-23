import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Container } from "@/lib/container";
import { adminProcedure, authenticatedProcedure, router } from "../trpc";

const flowIdInput = z.object({ flowId: z.string().uuid() });

const canEditFlow = async (
  container: Container,
  flowId: string,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> => {
  if (isAdmin) return true;
  const result = await container.useCases.getFlowCanvas.execute(flowId);
  if (result.error || !result.data) return false;
  const { flow } = result.data;
  return (
    flow.ownerUserId === userId ||
    flow.permissions.some((p) => p.userId === userId && p.role === "owner")
  );
};

const nodeRouter = router({
  previewPrompt: authenticatedProcedure
    .input(
      z.object({
        flowId: z.string().uuid(),
        aiInstruction: z.string(),
        doneWhen: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this flow." });
      }

      const canvasResult = await ctx.container.useCases.getFlowCanvas.execute(input.flowId);
      if (canvasResult.error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: canvasResult.error.message });
      }
      if (!canvasResult.data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found." });
      }

      const { flow } = canvasResult.data;

      const orgSettingResult = await ctx.container.repos.systemSettings.get("organisation_name");
      const organisationName = orgSettingResult.error ? null : (orgSettingResult.data?.value ?? null);

      const promptResult = ctx.container.services.sessionAgent.buildSystemPrompt({
        nodeConfig: {
          aiInstruction: input.aiInstruction,
          doneWhen: input.doneWhen,
          outputType: "conversation_only",
        },
        contextDocs: flow.contextDocs,
        gatheredContext: "",
        workflowName: flow.name,
        organisationName,
        expertRole: flow.expertRole,
      });

      if (promptResult.error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: promptResult.error.message });
      }

      return { systemPrompt: promptResult.data };
    }),

  create: authenticatedProcedure
    .input(
      z.object({
        flowId: z.string().uuid(),
        name: z.string().min(1),
        colour: z.string().nullable().optional(),
        positionX: z.number(),
        positionY: z.number(),
        config: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const result = await ctx.container.useCases.createFlowNode.execute({
        flowId: input.flowId,
        type: "conversational",
        name: input.name,
        colour: input.colour ?? null,
        positionX: input.positionX,
        positionY: input.positionY,
        config: input.config,
      });
      if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      return result.data;
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        nodeId: z.string().uuid(),
        flowId: z.string().uuid(),
        name: z.string().min(1).optional(),
        colour: z.string().nullable().optional(),
        config: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const result = await ctx.container.useCases.updateFlowNode.execute(input.nodeId, {
        name: input.name,
        colour: input.colour,
        config: input.config,
      });
      if (result.error) {
        const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
        throw new TRPCError({ code, message: result.error.message });
      }
      return result.data;
    }),

  updatePosition: authenticatedProcedure
    .input(
      z.object({
        nodeId: z.string().uuid(),
        flowId: z.string().uuid(),
        x: z.number(),
        y: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const result = await ctx.container.useCases.updateFlowNodePosition.execute(input.nodeId, input.x, input.y);
      if (result.error) {
        const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
        throw new TRPCError({ code, message: result.error.message });
      }
      return result.data;
    }),

  delete: authenticatedProcedure
    .input(z.object({ nodeId: z.string().uuid(), flowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const result = await ctx.container.useCases.deleteFlowNode.execute(input.nodeId);
      if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      return { ok: true };
    }),
});

const edgeRouter = router({
  create: authenticatedProcedure
    .input(
      z.object({
        flowId: z.string().uuid(),
        fromNodeId: z.string().uuid(),
        toNodeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const result = await ctx.container.useCases.createFlowEdge.execute(input);
      if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      return result.data;
    }),

  delete: authenticatedProcedure
    .input(z.object({ edgeId: z.string().uuid(), flowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const result = await ctx.container.useCases.deleteFlowEdge.execute(input.edgeId);
      if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      return { ok: true };
    }),
});

export const flowRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listFlows.execute();
    if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
    return result.data;
  }),

  listMine: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listFlowsForUser.execute(ctx.userId);
    if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
    return result.data;
  }),

  create: authenticatedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        expertRole: z.string().min(1),
        description: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.createFlow.execute({
        name: input.name,
        expertRole: input.expertRole,
        description: input.description,
        icon: input.icon,
        ownerUserId: ctx.userId,
      });
      if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      return result.data;
    }),

  getCanvas: authenticatedProcedure
    .input(flowIdInput)
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getFlowCanvas.execute(input.flowId);
      if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
      if (!result.data) throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found." });

      const { flow } = result.data;
      const canEdit =
        ctx.isAdmin ||
        flow.ownerUserId === ctx.userId ||
        flow.permissions.some((p) => p.userId === ctx.userId && p.role === "owner");

      if (!canEdit) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this flow." });

      return result.data;
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        flowId: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
        expertRole: z.string().nullable().optional(),
        status: z.enum(["draft", "published"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const { flowId, ...patch } = input;
      const result = await ctx.container.useCases.updateFlow.execute(flowId, patch);
      if (result.error) {
        const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
        throw new TRPCError({ code, message: result.error.message });
      }
      return result.data;
    }),

  grantOwner: adminProcedure
    .input(z.object({ flowId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.grantFlowOwner.execute(input.flowId, input.userId);
      if (result.error) {
        const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
        throw new TRPCError({ code, message: result.error.message });
      }
      return result.data;
    }),

  contextDoc: router({
    remove: authenticatedProcedure
      .input(z.object({ flowId: z.string().uuid(), docId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
        }
        const result = await ctx.container.useCases.removeContextDoc.execute(input.flowId, input.docId);
        if (result.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
        return { ok: true };
      }),
  }),

  node: nodeRouter,
  edge: edgeRouter,
});
