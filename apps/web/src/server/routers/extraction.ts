import type { ExtractionSchemaDraft } from "@rbrasier/domain";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { canEditFlow } from "./flow";

// Every procedure re-checks the extraction_flows flag server-side — the client
// gate is never the enforcement point (ADR-033 §7).
const extractionEnabled = authenticatedProcedure.use(async ({ ctx, next }) => {
  const enabled = await ctx.container.useCases.isFeatureEnabledForUser.execute(
    ctx.userId,
    "extraction_flows",
    ctx.isAdmin,
  );
  if (enabled.error) throw toTrpcError(enabled.error);
  if (!enabled.data) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Synthesise Information is not enabled for you.",
    });
  }
  return next();
});

const authorProcedure = extractionEnabled.use(({ ctx, next }) => {
  if (!ctx.isAdmin && !ctx.permissions.has("extraction:author")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot author extraction flows." });
  }
  return next();
});

const runProcedure = extractionEnabled.use(({ ctx, next }) => {
  if (!ctx.isAdmin && !ctx.permissions.has("extraction:run")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot run extraction flows." });
  }
  return next();
});

// Listing/viewing is allowed to either an author or a runner.
const viewProcedure = extractionEnabled.use(({ ctx, next }) => {
  if (
    !ctx.isAdmin &&
    !ctx.permissions.has("extraction:author") &&
    !ctx.permissions.has("extraction:run")
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view extraction flows." });
  }
  return next();
});

const flowIdInput = z.object({ flowId: z.string().uuid() });

const fieldDraftSchema = z.object({
  label: z.string().min(1),
  annotation: z.string().min(1),
  instruction: z.string(),
  doneWhen: z.string().nullable(),
});

const contextDocSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  storagePath: z.string(),
  extractedText: z.string().nullable(),
  extractionStatus: z.enum(["pending", "complete", "failed", "unsupported"]),
});

const schemaInput: z.ZodType<ExtractionSchemaDraft> = z.object({
  fields: z.array(fieldDraftSchema),
  input: z.object({
    cardinality: z.enum(["one_per_file", "many_per_record"]),
    selectionCriteria: z.string().nullable(),
    guidance: z.string(),
  }),
  output: z.object({
    format: z.enum(["docx", "xlsx"]),
    outputTemplate: contextDocSchema.nullable(),
    instruction: z.string(),
    generateSummary: z.boolean(),
    summaryTemplate: contextDocSchema.nullable(),
    contextDocs: z.array(contextDocSchema),
  }),
});

const sampleDocumentSchema = z.object({
  filename: z.string().min(1),
  treePath: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string(),
});

export const extractionRouter = router({
  // The user's own extraction flows (the /synthesise list).
  listMine: viewProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listExtractionFlowsForUser.execute(ctx.userId);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  // Every extraction flow across the org (the /admin/synthesise list).
  listAll: extractionEnabled.query(async ({ ctx }) => {
    if (!ctx.isAdmin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
    }
    const result = await ctx.container.useCases.listExtractionFlows.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  create: authorProcedure
    .input(z.object({ name: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.createExtractionFlow.execute({
        name: input.name,
        ownerUserId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  getSchema: viewProcedure.input(flowIdInput).query(async ({ ctx, input }) => {
    if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view this flow." });
    }
    const result = await ctx.container.useCases.getExtractionSchema.execute(input.flowId);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  saveSchema: authorProcedure
    .input(z.object({ flowId: z.string().uuid(), schema: schemaInput }))
    .mutation(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit this flow." });
      }
      const result = await ctx.container.useCases.saveExtractionSchema.execute({
        flowId: input.flowId,
        schema: input.schema,
      });
      if (result.error) throw toTrpcError(result.error);
      return { versionId: result.data.id };
    }),

  publish: authorProcedure.input(flowIdInput).mutation(async ({ ctx, input }) => {
    if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot publish this flow." });
    }
    const result = await ctx.container.useCases.publishFlowVersion.execute({
      flowId: input.flowId,
      publishedByUserId: ctx.userId,
    });
    if (result.error) throw toTrpcError(result.error);
    return { versionId: result.data.id, versionNumber: result.data.versionNumber };
  }),

  // Synchronous sample/preview extraction against the flow's authored (draft)
  // schema — 2-3 documents (ADR-033 §8 / phase §8). Full batch is Phase 2.
  runSample: runProcedure
    .input(z.object({ flowId: z.string().uuid(), documents: z.array(sampleDocumentSchema) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot run this flow." });
      }

      const schemaResult = await ctx.container.useCases.getExtractionSchema.execute(input.flowId);
      if (schemaResult.error) throw toTrpcError(schemaResult.error);
      if (!schemaResult.data) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Configure the extraction schema before running a sample.",
        });
      }

      const documents = input.documents.map((document, index) => ({
        id: `doc-${index + 1}`,
        filename: document.filename,
        treePath: document.treePath,
        mimeType: document.mimeType,
        buffer: Buffer.from(document.contentBase64, "base64"),
      }));

      const result = await ctx.container.useCases.runSampleExtraction.execute({
        schema: schemaResult.data,
        documents,
        userId: ctx.userId,
        flowId: input.flowId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
