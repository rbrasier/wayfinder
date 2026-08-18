import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { DEFAULT_CACHE_TTL_SECONDS } from "@rbrasier/domain";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const requireAdmin = (isAdmin: boolean): void => {
  if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
};

const sourceInput = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["directory", "managed", "api"]),
  config: z.record(z.unknown()).default({}),
  displayField: z.string().min(1),
  keyField: z.string().optional(),
  credentialRef: z.string().optional(),
  cacheTtlSeconds: z.number().int().positive().default(DEFAULT_CACHE_TTL_SECONDS),
  enabled: z.boolean().default(true),
});

export const lookupSourceRouter = router({
  list: authenticatedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.isAdmin);
    const result = await ctx.container.useCases.listLookupSources.execute();
    if (result.error) throw toTrpcError(result.error);
    // Safe to return whole: a source stores only `credentialRef`, the name of an
    // environment variable, never the secret itself (ADR-050 §2a).
    return result.data;
  }),

  create: authenticatedProcedure.input(sourceInput).mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.isAdmin);
    const result = await ctx.container.useCases.registerLookupSource.execute(input);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  update: authenticatedProcedure
    .input(z.object({ id: z.string().min(1), source: sourceInput }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.updateLookupSource.execute(
        input.id,
        input.source,
      );
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.deleteLookupSource.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return { deleted: true };
    }),

  // Runs against a draft, so an admin sees the source's fields and can pick the
  // display and key before saving anything (ADR-050 §2b).
  test: authenticatedProcedure
    .input(
      z.object({
        kind: z.enum(["directory", "managed", "api"]),
        config: z.record(z.unknown()).default({}),
        credentialRef: z.string().optional(),
        displayField: z.string().optional(),
        keyField: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.testLookupSource.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // The operator-facing type-ahead. Not admin-gated: any operator filling a
  // field bound to a source has to be able to search it.
  search: authenticatedProcedure
    .input(
      z.object({
        sourceName: z.string().min(1),
        query: z.string().default(""),
        limit: z.number().int().positive().max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.services.valueSetProvider.search(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
