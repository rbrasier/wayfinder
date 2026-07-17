import { z } from "zod";
import type { NewAuditLog } from "@rbrasier/domain";
import { adminProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const logInsightsExportInputSchema = z.object({
  flowId: z.string().uuid(),
  rowCount: z.number().int().min(0),
  columnCount: z.number().int().min(0),
  filters: z
    .object({
      datePreset: z.string().optional(),
      statusFilter: z.string().optional(),
      filterColumnKey: z.string().nullable().optional(),
      filterThreshold: z.string().optional(),
      filterOperator: z.string().optional(),
      combineForks: z.boolean().optional(),
      combineVersions: z.boolean().optional(),
    })
    .optional(),
});

export type LogInsightsExportInput = z.infer<typeof logInsightsExportInputSchema>;

export const buildInsightsExportAuditPayload = (
  actorId: string | null,
  input: LogInsightsExportInput,
): NewAuditLog => ({
  actorId,
  action: "insights.exported",
  resourceType: "flow",
  resourceId: input.flowId,
  metadata: {
    rowCount: input.rowCount,
    columnCount: input.columnCount,
    filters: input.filters ?? {},
  },
});

export const analyticsRouter = router({
  overview: adminProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getOverviewDashboard.execute({
        periodDays: input?.periodDays,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  flowDeepDive: adminProcedure
    .input(z.object({ flowId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getFlowDeepDive.execute({
        flowId: input?.flowId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Records that an operator exported the field report (data egress). The file
  // itself is generated client-side; this only emits the audit event.
  logInsightsExport: adminProcedure
    .input(logInsightsExportInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.logAuditEvent.execute(
        buildInsightsExportAuditPayload(ctx.userId, input),
      );
      if (result.error) throw toTrpcError(result.error);
      return { success: true };
    }),
});
