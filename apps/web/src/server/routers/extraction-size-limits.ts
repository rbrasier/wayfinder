import { estimateRunFit } from "@wayfinder/application";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { toTrpcError } from "../trpc-errors";
import { viewProcedure } from "./extraction-procedures";
import { canEditFlow } from "./flow";

const flowIdInput = z.object({ flowId: z.string().uuid() });

// The admin size limits as the authoring screen sees them (issue #335). Spread
// into the extraction router so the client keeps one `extraction.*` namespace.
export const extractionSizeLimitProcedures = {
  // Bounds the authoring controls, so a stepper never offers a value the server
  // will reject.
  getLimits: viewProcedure.query(async ({ ctx }) => {
    const config = await ctx.container.runtimeConfig.getExtractionConfig();
    return {
      sampleMaxDocuments: config.sampleMaxDocuments,
      maxAnalyseDocuments: config.maxAnalyseDocuments,
    };
  }),

  // The pre-run size check: sizes the saved schema against the staged
  // documents' recorded text lengths. Null until a schema exists.
  estimateRunFit: viewProcedure.input(flowIdInput).query(async ({ ctx, input }) => {
    if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view this flow." });
    }
    const schema = await ctx.container.useCases.getExtractionSchema.execute(input.flowId);
    if (schema.error) throw toTrpcError(schema.error);
    if (!schema.data) return null;
    const documents = await ctx.container.useCases.listDraftDocuments.execute(input.flowId);
    if (documents.error) throw toTrpcError(documents.error);
    const config = await ctx.container.runtimeConfig.getExtractionConfig();
    return estimateRunFit({
      schema: schema.data,
      documents: documents.data,
      budget: await ctx.container.runtimeConfig.resolveExtractionPromptBudget(),
      summaryRecordCap: config.summaryRecordCap,
    });
  }),
};
