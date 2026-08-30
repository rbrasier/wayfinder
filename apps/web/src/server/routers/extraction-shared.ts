import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ExtractionSchemaDraft } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { authenticatedProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// The extraction router's gates and input contracts, shared with the schema
// proposal procedures that live beside it. Split out of `extraction.ts` to keep
// that file under the source-size ratchet — the same split `settings.ts` makes.

// Every procedure re-checks the extraction_flows flag server-side — the client
// gate is never the enforcement point (ADR-033 §7).
export const extractionEnabled = authenticatedProcedure.use(async ({ ctx, next }) => {
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

export const authorProcedure = extractionEnabled.use(({ ctx, next }) => {
  if (!ctx.isAdmin && !ctx.permissions.has("extraction:author")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot author extraction flows." });
  }
  return next();
});

export const runProcedure = extractionEnabled.use(({ ctx, next }) => {
  if (!ctx.isAdmin && !ctx.permissions.has("extraction:run")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot run extraction flows." });
  }
  return next();
});

// Listing/viewing is allowed to either an author or a runner.
export const viewProcedure = extractionEnabled.use(({ ctx, next }) => {
  if (
    !ctx.isAdmin &&
    !ctx.permissions.has("extraction:author") &&
    !ctx.permissions.has("extraction:run")
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view extraction flows." });
  }
  return next();
});

export const fieldDraftSchema = z.object({
  label: z.string().min(1),
  annotation: z.string().min(1),
  instruction: z.string(),
  doneWhen: z.string().nullable(),
});

export const contextDocSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  storagePath: z.string(),
  extractedText: z.string().nullable(),
  extractionStatus: z.enum(["pending", "complete", "failed", "unsupported"]),
});

export const inputConfigSchema = z.object({
  cardinality: z.enum(["one_per_file", "many_per_record"]),
  selectionCriteria: z.string().nullable(),
  guidance: z.string(),
});

export const outputConfigSchema = z.object({
  format: z.enum(["docx", "xlsx"]),
  outputTemplate: contextDocSchema.nullable(),
  instruction: z.string(),
  generateSummary: z.boolean(),
  summaryTemplate: contextDocSchema.nullable(),
  contextDocs: z.array(contextDocSchema),
});

export const schemaInput: z.ZodType<ExtractionSchemaDraft> = z.object({
  fields: z.array(fieldDraftSchema),
  input: inputConfigSchema,
  output: outputConfigSchema,
});

export const sampleDocumentSchema = z.object({
  filename: z.string().min(1),
  treePath: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string(),
});

// The sample buffers the client sends, in the shape the extraction use cases
// take. Shared by the sample run and the schema proposer so both read the same
// documents the same way.
export const toSampleDocuments = (
  documents: z.infer<typeof sampleDocumentSchema>[],
): { id: string; filename: string; treePath: string; mimeType: string; buffer: Buffer }[] =>
  documents.map((document, index) => ({
    id: `doc-${index + 1}`,
    filename: document.filename,
    treePath: document.treePath,
    mimeType: document.mimeType,
    buffer: Buffer.from(document.contentBase64, "base64"),
  }));

// The flow's own name, read server-side rather than taken from the client: it
// goes into the proposer's prompt, and a display string the caller supplies is
// not the flow's name.
export const flowNameOf = async (container: Container, flowId: string): Promise<string> => {
  const canvas = await container.useCases.getFlowCanvas.execute(flowId);
  if (canvas.error || !canvas.data) return "";
  return canvas.data.flow.name;
};
