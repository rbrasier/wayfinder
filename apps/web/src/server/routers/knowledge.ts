import { z } from "zod";
import type { RetrievalScope } from "@rbrasier/domain";
import { permissionProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const statusSchema = z.enum(["active", "archived", "draft"]);

// Search may be scoped to a flow (curated knowledge) or a session (operator
// uploads). Exactly one must be supplied.
const scopeSchema = z
  .object({
    flowId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
  })
  .refine(
    (scope) => Boolean(scope.flowId) !== Boolean(scope.sessionId),
    "Provide exactly one of flowId or sessionId.",
  );

const toScope = (scope: { flowId?: string; sessionId?: string }): RetrievalScope =>
  scope.flowId ? { flowId: scope.flowId } : { sessionId: scope.sessionId! };

export const knowledgeRouter = router({
  list: permissionProcedure("knowledge:curate")
    .input(
      z.object({
        flowId: z.string().uuid().nullable().default(null),
        status: statusSchema.nullable().default(null),
        tag: z.string().nullable().default(null),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.listCuratedChunks.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  search: permissionProcedure("knowledge:curate")
    .input(
      z.object({
        text: z.string(),
        mode: z.enum(["semantic", "exact"]),
        scope: scopeSchema,
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.searchKnowledge.execute({
        text: input.text,
        mode: input.mode,
        scope: toScope(input.scope),
        ...(input.limit ? { limit: input.limit } : {}),
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  edit: permissionProcedure("knowledge:curate")
    .input(
      z.object({
        chunkId: z.string().uuid(),
        newText: z.string().min(1),
        reason: z.string().nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.editChunk.execute({
        chunkId: input.chunkId,
        newText: input.newText,
        reason: input.reason,
        editedBy: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  setStatus: permissionProcedure("knowledge:curate")
    .input(
      z.object({
        chunkIds: z.array(z.string().uuid()).min(1),
        status: statusSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.setChunkStatus.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true as const };
    }),

  tag: permissionProcedure("knowledge:curate")
    .input(
      z.object({
        chunkIds: z.array(z.string().uuid()).min(1),
        tag: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.tagChunks.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true as const };
    }),

  revert: permissionProcedure("knowledge:curate")
    .input(
      z.object({
        chunkId: z.string().uuid(),
        versionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.revertChunk.execute({
        chunkId: input.chunkId,
        versionId: input.versionId,
        editedBy: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  versions: permissionProcedure("knowledge:curate")
    .input(z.object({ chunkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.listChunkVersions.execute(input.chunkId);
      if (result.error) throw toTrpcError(result.error);
      // The raw embedding is never sent to the client; the history panel shows
      // text, author, and timestamp only.
      return result.data.map((version) => ({
        id: version.id,
        chunkId: version.chunkId,
        chunkText: version.chunkText,
        editedBy: version.editedBy,
        reason: version.reason,
        createdAt: version.createdAt,
      }));
    }),
});
