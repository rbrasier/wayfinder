import { buildAuditQuery, toAuditCsv, toAuditJson, verifyAuditChain } from "@rbrasier/domain";
import { sha256Hex } from "@rbrasier/adapters";
import { z } from "zod";
import { adminProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const filterInputSchema = z.object({
  actorId: z.string().nullish(),
  action: z.string().nullish(),
  resourceType: z.string().nullish(),
  resourceId: z.string().nullish(),
  from: z.date().nullish(),
  to: z.date().nullish(),
});

const searchInputSchema = filterInputSchema.extend({
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});

export const auditRouter = router({
  search: adminProcedure.input(searchInputSchema).query(async ({ ctx, input }) => {
    const query = buildAuditQuery(input);
    if (query.error) throw toTrpcError(query.error);
    const result = await ctx.container.repos.auditQuery.search(query.data);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  getById: adminProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const result = await ctx.container.repos.auditQuery.getById(input.id);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  export: adminProcedure
    .input(filterInputSchema.extend({ format: z.enum(["csv", "json"]) }))
    .mutation(async ({ ctx, input }) => {
      const query = buildAuditQuery(input);
      if (query.error) throw toTrpcError(query.error);
      const result = await ctx.container.repos.auditQuery.exportRows(query.data);
      if (result.error) throw toTrpcError(result.error);

      const isCsv = input.format === "csv";
      return {
        filename: `audit-log.${input.format}`,
        contentType: isCsv ? "text/csv" : "application/json",
        content: isCsv ? toAuditCsv(result.data) : toAuditJson(result.data),
      };
    }),

  // On-demand tamper check: recompute the whole chain and report the first
  // break, if any. Not on the write path — this is the detection mechanism.
  verifyChain: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.repos.auditQuery.loadChain();
    if (result.error) throw toTrpcError(result.error);
    const firstBreak = verifyAuditChain(result.data, sha256Hex);
    return { intact: firstBreak === null, rows: result.data.length, firstBreak };
  }),
});
