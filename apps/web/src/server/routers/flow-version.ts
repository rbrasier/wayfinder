import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { canEditFlow } from "./flow";

// Version history is owner/admin-only — it mirrors the flow's edit permission.
export const flowVersionRouter = router({
  list: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this flow's history." });
      }
      const result = await ctx.container.useCases.listFlowVersions.execute(input.flowId);
      if (result.error) throw toTrpcError(result.error);

      // Resolve publisher display names so the panel reads "by <name>".
      const publisherIds = [
        ...new Set(result.data.map((v) => v.publishedByUserId).filter((id): id is string => Boolean(id))),
      ];
      const publishers = await Promise.all(publisherIds.map((id) => ctx.container.repos.users.findById(id)));
      const nameById = new Map(
        publishers
          .map((p) => p.data)
          .filter((user): user is NonNullable<typeof user> => Boolean(user))
          .map((user) => [user.id, user.name ?? user.email]),
      );

      return result.data.map((version) => ({
        ...version,
        publishedByName: version.publishedByUserId ? nameById.get(version.publishedByUserId) ?? null : null,
      }));
    }),

  // Lightweight header summary: which version is live and whether the editor has
  // unpublished changes open as a draft. Powers the version indicator that sits
  // beside the published-state badge in the flow editor.
  status: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this flow's history." });
      }
      const [draftResult, publishedResult] = await Promise.all([
        ctx.container.repos.flowVersions.openDraft(input.flowId),
        ctx.container.repos.flowVersions.latestPublished(input.flowId),
      ]);
      if (draftResult.error) throw toTrpcError(draftResult.error);
      if (publishedResult.error) throw toTrpcError(publishedResult.error);

      return {
        hasOpenDraft: Boolean(draftResult.data),
        latestPublishedNumber: publishedResult.data?.versionNumber ?? null,
      };
    }),

  get: authenticatedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getFlowVersion.execute(input.versionId);
      if (result.error) throw toTrpcError(result.error);
      if (!(await canEditFlow(ctx.container, result.data.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this version." });
      }
      return result.data;
    }),

  restore: authenticatedProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        changeSummary: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const versionResult = await ctx.container.useCases.getFlowVersion.execute(input.versionId);
      if (versionResult.error) throw toTrpcError(versionResult.error);
      if (!(await canEditFlow(ctx.container, versionResult.data.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to restore this flow." });
      }
      const result = await ctx.container.useCases.restoreFlowVersion.execute({
        versionId: input.versionId,
        restoredByUserId: ctx.userId,
        changeSummary: input.changeSummary ?? null,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
