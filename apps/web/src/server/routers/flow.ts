import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Container } from "@/lib/container";
import { adminProcedure, authenticatedProcedure, permissionProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const flowIdInput = z.object({ flowId: z.string().uuid() });

export const canEditFlow = async (
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

// Opens/refreshes the published flow's single draft after an edit. Best-effort:
// a versioning hiccup must never break the edit itself, and it no-ops for flows
// that have never been published (nothing to diverge from yet).
const syncDraft = (container: Container, flowId: string): void => {
  void container.useCases.syncFlowDraft.execute(flowId).catch(() => undefined);
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
        throw toTrpcError(canvasResult.error);
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
        gatheredContext: "",
        workflowName: flow.name,
        organisationName,
        expertRole: flow.expertRole,
      });

      if (promptResult.error) {
        throw toTrpcError(promptResult.error);
      }

      return { systemPrompt: promptResult.data };
    }),

  create: authenticatedProcedure
    .input(
      z.object({
        flowId: z.string().uuid(),
        // Nodes are persisted on type-select with a blank name (v1.36.0); the
        // author names the step afterwards in the config modal. The canvas
        // renders an "Untitled step" fallback while the name is empty.
        name: z.string(),
        colour: z.string().nullable().optional(),
        type: z.enum(["conversational", "auto", "scheduled", "approval"]).optional(),
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
        type: input.type ?? "conversational",
        name: input.name,
        colour: input.colour ?? null,
        positionX: input.positionX,
        positionY: input.positionY,
        config: input.config,
      });
      if (result.error) throw toTrpcError(result.error);
      syncDraft(ctx.container, input.flowId);
      return result.data;
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        nodeId: z.string().uuid(),
        flowId: z.string().uuid(),
        // Blank names are allowed (v1.36.0) — canvas shows an "Untitled step" fallback.
        name: z.string().optional(),
        colour: z.string().nullable().optional(),
        type: z.enum(["conversational", "auto", "scheduled", "approval"]).optional(),
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
        type: input.type,
        config: input.config,
      });
      if (result.error) throw toTrpcError(result.error);
      syncDraft(ctx.container, input.flowId);
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
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  delete: authenticatedProcedure
    .input(z.object({ nodeId: z.string().uuid(), flowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const result = await ctx.container.useCases.deleteFlowNode.execute(input.nodeId);
      if (result.error) throw toTrpcError(result.error);
      syncDraft(ctx.container, input.flowId);
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
      if (result.error) throw toTrpcError(result.error);
      syncDraft(ctx.container, input.flowId);
      return result.data;
    }),

  delete: authenticatedProcedure
    .input(z.object({ edgeId: z.string().uuid(), flowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const result = await ctx.container.useCases.deleteFlowEdge.execute(input.edgeId);
      if (result.error) throw toTrpcError(result.error);
      syncDraft(ctx.container, input.flowId);
      return { ok: true };
    }),
});

export const flowRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listFlows.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  listMine: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listFlowsForUser.execute(ctx.userId);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  create: permissionProcedure("workflow:create_own")
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
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  getCanvas: authenticatedProcedure
    .input(flowIdInput)
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getFlowCanvas.execute(input.flowId);
      if (result.error) throw toTrpcError(result.error);
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
        // Optional one-line note recorded on the version when publishing.
        changeSummary: z.string().max(500).nullable().optional(),
        visibility: z
          .discriminatedUnion("kind", [
            z.object({ kind: z.literal("private") }),
            z.object({ kind: z.literal("global") }),
          ])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
      }
      const { flowId, changeSummary, ...patch } = input;
      const result = await ctx.container.useCases.updateFlow.execute(flowId, patch, {
        canPublishToEveryone:
          ctx.isAdmin || ctx.permissions.has("workflow:publish_to_everyone"),
      });
      if (result.error) throw toTrpcError(result.error);

      // The publish transition promotes the open draft into an immutable
      // version (ADR-015); any other edit refreshes the draft snapshot.
      if (patch.status === "published") {
        const published = await ctx.container.useCases.publishFlowVersion.execute({
          flowId,
          publishedByUserId: ctx.userId,
          changeSummary: changeSummary ?? null,
        });
        if (published.error) throw toTrpcError(published.error);
      } else {
        syncDraft(ctx.container, flowId);
      }

      return result.data;
    }),

  delete: authenticatedProcedure
    .input(flowIdInput)
    .mutation(async ({ ctx, input }) => {
      if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to delete this flow." });
      }
      const result = await ctx.container.useCases.deleteFlow.execute(input.flowId);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  grantOwner: adminProcedure
    .input(z.object({ flowId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.container.repos.flows.findById(input.flowId);
      const previousPermissions = before.data?.permissions ?? [];
      const result = await ctx.container.useCases.grantFlowOwner.execute(input.flowId, input.userId);
      if (result.error) throw toTrpcError(result.error);
      // Fire-and-forget: the notifier records its outcome in the outbox and a
      // slow or failing SMTP server must never delay or break the grant.
      void ctx.container.useCases.notifyOnFlowShared
        .execute({ flow: result.data, previousPermissions, grantedByUserId: ctx.userId })
        .catch(() => undefined);
      return result.data;
    }),

  contextDoc: router({
    remove: authenticatedProcedure
      .input(z.object({ flowId: z.string().uuid(), docId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this flow." });
        }
        const flowResult = await ctx.container.repos.flows.findById(input.flowId);
        const removedDoc = flowResult.data?.contextDocs.find((doc) => doc.id === input.docId);
        const result = await ctx.container.useCases.removeContextDoc.execute(input.flowId, input.docId);
        if (result.error) throw toTrpcError(result.error);
        // Drop the document's chunks so its content is no longer retrievable.
        if (removedDoc) {
          await ctx.container.repos.documentChunks.deleteByStoragePath(removedDoc.storagePath);
        }
        return { ok: true };
      }),
  }),

  node: nodeRouter,
  edge: edgeRouter,
});
