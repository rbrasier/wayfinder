import { parseExtractionSchema, type ExtractionSchemaDraft } from "@rbrasier/domain";
import { buildExtractionSystemPrompt } from "@rbrasier/application";
import { DocumentGeneratorRouter, DocxGenerator, XlsxGenerator } from "@rbrasier/adapters";
import type { Container } from "@/lib/container";
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

// Template parsing routes docx vs xlsx by the file's bytes (ADR-039), so a
// single router instance handles both without the caller pre-selecting a format.
const templateGenerator = new DocumentGeneratorRouter(new DocxGenerator(), new XlsxGenerator());

const flowIdInput = z.object({ flowId: z.string().uuid() });

// Run controls carry a run id, so ownership is re-checked through the run's
// owning flow — the same flow-edit gate the rest of the router uses. Every
// control procedure passes through here before mutating a run.
interface RunControlContext {
  container: Container;
  userId: string;
  isAdmin: boolean;
}

const assertRunEditable = async (ctx: RunControlContext, runId: string): Promise<void> => {
  const run = await ctx.container.repos.extractionRuns.getRun(runId);
  if (run.error) throw toTrpcError(run.error);
  if (!(await canEditFlow(ctx.container, run.data.flowId, ctx.userId, ctx.isAdmin))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot control this run." });
  }
};

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

const batchFileSchema = z.object({
  filename: z.string().min(1),
  treePath: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string(),
});

const batchArchiveSchema = z.object({
  filename: z.string().min(1),
  contentBase64: z.string(),
});

const runIdInput = z.object({ runId: z.string().uuid() });

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

  // The exact system prompt each document extraction is given, built from the
  // author's current (unsaved) draft — the same builder the runtime uses, so the
  // "view system prompt" preview matches what the AI actually receives. Mirrors
  // the conversational node's flow.node.previewPrompt.
  previewSystemPrompt: viewProcedure
    .input(z.object({ flowId: z.string().uuid(), schema: schemaInput }))
    .query(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view this flow." });
      }
      const parsed = parseExtractionSchema(input.schema);
      if (parsed.error) throw toTrpcError(parsed.error);
      return {
        systemPrompt: buildExtractionSystemPrompt({
          fields: parsed.data.fields,
          guidance: parsed.data.input.guidance,
          contextDocs: parsed.data.output.contextDocs,
        }),
      };
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

  // Soft-deletes an extraction flow (a `flow` row with flowType "extraction").
  // Author-gated and re-checked through the shared flow-edit guard.
  delete: authorProcedure.input(flowIdInput).mutation(async ({ ctx, input }) => {
    if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot delete this flow." });
    }
    const result = await ctx.container.useCases.deleteFlow.execute(input.flowId);
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),

  // Parses an uploaded output template (.docx/.xlsx) into the fields it declares
  // — its {{ tags }} or header row — the same mechanism the conversational node
  // uses. Stores the template so a later run can render into it, and returns the
  // FlowContextDoc the author saves onto the schema's output config.
  parseOutputTemplate: authorProcedure
    .input(
      z.object({
        flowId: z.string().uuid(),
        filename: z.string().min(1),
        contentBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit this flow." });
      }

      const lowerName = input.filename.toLowerCase();
      if (!lowerName.endsWith(".docx") && !lowerName.endsWith(".xlsx")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only .docx and .xlsx templates are accepted." });
      }
      const format: "docx" | "xlsx" = lowerName.endsWith(".xlsx") ? "xlsx" : "docx";

      const buffer = Buffer.from(input.contentBase64, "base64");
      const generator = templateGenerator;

      const tags = generator.extractTags({ templateBytes: buffer });
      if (tags.error) throw toTrpcError(tags.error);
      // A .docx with no tags captures nothing; a .xlsx with none is valid (header
      // mode), so only .docx is rejected here — matching the node template route.
      if (format === "docx" && tags.data.tags.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This template has no {{ tag }} placeholders. Add at least one tag (e.g. {{ supplier_name }}) where the extracted value should go, then re-upload.",
        });
      }

      const fields = generator.extractFields({ templateBytes: buffer });
      if (fields.error) throw toTrpcError(fields.error);

      const fullText = generator.extractFullText({ templateBytes: buffer });

      const mimeType =
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const storagePath = `extraction-templates/${input.flowId}/${timestamp}-${safeFilename}`;

      const stored = await ctx.container.objectStorage.put(storagePath, buffer, mimeType);
      if (stored.error) throw toTrpcError(stored.error);

      const spreadsheetTemplateMode: "tags" | "header" | null =
        format === "xlsx" ? (tags.data.tags.length > 0 ? "tags" : "header") : null;

      return {
        template: {
          id: crypto.randomUUID(),
          filename: safeFilename,
          mimeType,
          sizeBytes: buffer.byteLength,
          storagePath,
          extractedText: fullText.data?.text ?? null,
          extractionStatus: "complete" as const,
        },
        fields: fields.data.fields,
        format,
        spreadsheetTemplateMode,
      };
    }),

  // Uploads a context document to the output config — the extraction-flow
  // equivalent of a flow's whole-flow context. Stores the bytes, extracts their
  // text, and returns the FlowContextDoc the author saves onto output.contextDocs
  // so every document extraction is grounded on the same reference material.
  parseContextDoc: authorProcedure
    .input(
      z.object({
        flowId: z.string().uuid(),
        filename: z.string().min(1),
        mimeType: z.string().min(1),
        contentBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit this flow." });
      }

      const buffer = Buffer.from(input.contentBase64, "base64");
      const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const storagePath = `extraction-context/${input.flowId}/${timestamp}-${safeFilename}`;

      const stored = await ctx.container.objectStorage.put(storagePath, buffer, input.mimeType);
      if (stored.error) throw toTrpcError(stored.error);

      const extracted = await ctx.container.services.documentExtractor.extract({
        buffer,
        mimeType: input.mimeType,
      });
      // Unsupported/blank extraction is not fatal — the doc is still stored and
      // listed; it simply contributes no text to the grounding section.
      const extractedText = extracted.error ? null : extracted.data;

      return {
        contextDoc: {
          id: crypto.randomUUID(),
          filename: safeFilename,
          mimeType: input.mimeType,
          sizeBytes: buffer.byteLength,
          storagePath,
          extractedText,
          extractionStatus: (extracted.error ? "failed" : "complete") as "complete" | "failed",
        },
      };
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

  // Starts a durable full-batch run (ADR-033 §5-6, Phase 2). Requires a
  // published extraction version — enforced server-side inside StartBatchRun.
  startBatch: runProcedure
    .input(
      z.object({
        flowId: z.string().uuid(),
        files: z.array(batchFileSchema),
        archives: z.array(batchArchiveSchema).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot run this flow." });
      }

      // Resolve the admin-configured intake limits at run time so a settings
      // change takes effect without a redeploy (extraction-flows-2 §2).
      const config = await ctx.container.runtimeConfig.getExtractionConfig();

      const result = await ctx.container.useCases.startBatchRun.execute({
        flowId: input.flowId,
        userId: ctx.userId,
        files: input.files.map((file) => ({
          filename: file.filename,
          treePath: file.treePath,
          mimeType: file.mimeType,
          buffer: Buffer.from(file.contentBase64, "base64"),
        })),
        archives: input.archives.map((archive) => ({
          filename: archive.filename,
          buffer: Buffer.from(archive.contentBase64, "base64"),
        })),
        limits: {
          maxFiles: config.maxFilesPerRun,
          archiveLimits: {
            maxEntries: config.maxArchiveEntries,
            maxEntryBytes: config.maxArchiveEntryBytes,
            maxTotalBytes: config.maxArchiveTotalBytes,
          },
        },
      });
      if (result.error) throw toTrpcError(result.error);
      return { runId: result.data.id, totalCount: result.data.totalCount };
    }),

  // Live progress for the run screen: the run row plus COUNT(*) GROUP BY status
  // (phase §8). Ownership is enforced by the run's flow-edit check.
  runStatus: runProcedure.input(runIdInput).query(async ({ ctx, input }) => {
    const run = await ctx.container.repos.extractionRuns.getRun(input.runId);
    if (run.error) throw toTrpcError(run.error);
    if (!(await canEditFlow(ctx.container, run.data.flowId, ctx.userId, ctx.isAdmin))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view this run." });
    }
    const counts = await ctx.container.repos.extractionRuns.countByStatus(input.runId);
    if (counts.error) throw toTrpcError(counts.error);
    return { run: run.data, counts: counts.data };
  }),

  cancel: runProcedure.input(runIdInput).mutation(async ({ ctx, input }) => {
    await assertRunEditable(ctx, input.runId);
    const result = await ctx.container.useCases.cancelRun.execute(input.runId);
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),

  retryFailed: runProcedure.input(runIdInput).mutation(async ({ ctx, input }) => {
    await assertRunEditable(ctx, input.runId);
    const result = await ctx.container.useCases.retryFailed.execute(input.runId);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  continue: runProcedure.input(runIdInput).mutation(async ({ ctx, input }) => {
    await assertRunEditable(ctx, input.runId);
    const result = await ctx.container.useCases.continueRun.execute(input.runId);
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),

  // Run history for a flow's /synthesise sub-rows and the run-history view
  // (phase §5): status, counts, and cost per run, newest first.
  listRuns: viewProcedure.input(flowIdInput).query(async ({ ctx, input }) => {
    // canEditFlow short-circuits true for admins without checking the flow
    // exists, so an unknown flow id would otherwise return an empty list. Reject
    // it up front — mirroring how run-scoped procedures 404 an unknown run.
    const flow = await ctx.container.repos.flows.findById(input.flowId);
    if (flow.error) throw toTrpcError(flow.error);
    if (!flow.data) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found." });
    }
    if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view this flow's runs." });
    }
    const runs = await ctx.container.repos.extractionRuns.listRunsForFlow(input.flowId);
    if (runs.error) throw toTrpcError(runs.error);
    return runs.data;
  }),

  // The results viewer's data (phase §4): the run, its output records (with
  // stored server-side confidence), and its input documents for the files pane
  // and source highlighting. Exceptions are files with no record or a failed /
  // unreadable status.
  getResults: runProcedure.input(runIdInput).query(async ({ ctx, input }) => {
    await assertRunEditable(ctx, input.runId);
    const run = await ctx.container.repos.extractionRuns.getRun(input.runId);
    if (run.error) throw toTrpcError(run.error);

    const records = await ctx.container.repos.extractionRuns.listRecords(input.runId);
    if (records.error) throw toTrpcError(records.error);

    const documents = await ctx.container.repos.extractionRuns.listDocuments(input.runId);
    if (documents.error) throw toTrpcError(documents.error);

    return {
      run: run.data,
      records: records.data,
      documents: documents.data.map((document) => ({
        id: document.id,
        filename: document.filename,
        treePath: document.treePath,
        status: document.status,
        recordId: document.recordId,
        readable: document.status !== "unreadable",
      })),
      exceptionFileIds: documents.data
        .filter(
          (document) =>
            document.recordId === null ||
            document.status === "failed" ||
            document.status === "unreadable",
        )
        .map((document) => document.id),
    };
  }),

  generateDocuments: runProcedure.input(runIdInput).mutation(async ({ ctx, input }) => {
    await assertRunEditable(ctx, input.runId);
    const config = await ctx.container.runtimeConfig.getExtractionConfig();
    const result = await ctx.container.useCases.generateRunDocuments.execute({
      runId: input.runId,
      userId: ctx.userId,
      costCeilingUsd: config.perRunCostCeilingUsd,
    });
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  export: runProcedure.input(runIdInput).mutation(async ({ ctx, input }) => {
    await assertRunEditable(ctx, input.runId);
    const result = await ctx.container.useCases.exportRunResults.execute({
      runId: input.runId,
      userId: ctx.userId,
    });
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  editResult: runProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        recordId: z.string().uuid(),
        fieldKey: z.string().min(1),
        newValue: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRunEditable(ctx, input.runId);

      // The record must belong to the run whose ownership we just checked —
      // knowing a record UUID is not itself authorisation (v1.59.0 IDOR precedent).
      const records = await ctx.container.repos.extractionRuns.listRecords(input.runId);
      if (records.error) throw toTrpcError(records.error);
      if (!records.data.some((record) => record.id === input.recordId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found in this run." });
      }

      const editor = await ctx.container.repos.users.findById(ctx.userId);
      const editorLabel = editor.data?.name ?? editor.data?.email ?? "an operator";

      const result = await ctx.container.useCases.editRecordField.execute({
        recordId: input.recordId,
        fieldKey: input.fieldKey,
        newValue: input.newValue,
        editorUserId: ctx.userId,
        editorLabel,
      });
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  markComplete: runProcedure.input(runIdInput).mutation(async ({ ctx, input }) => {
    await assertRunEditable(ctx, input.runId);
    const result = await ctx.container.useCases.markRunComplete.execute({
      runId: input.runId,
      userId: ctx.userId,
    });
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),

  // The summary rendered as markdown above the rows (phase §2.3). Reads the
  // stored markdown artifact; null when no summary was generated for the run.
  summaryMarkdown: runProcedure.input(runIdInput).query(async ({ ctx, input }) => {
    await assertRunEditable(ctx, input.runId);
    const bytes = await ctx.container.objectStorage.get(
      `extraction-runs/${input.runId}/outputs/summary.md`,
    );
    if (bytes.error) return { markdown: null };
    return { markdown: bytes.data.toString("utf8") };
  }),

  // The per-run field report (phase §5), reusing the Insights report structure.
  runReport: runProcedure.input(runIdInput).query(async ({ ctx, input }) => {
    await assertRunEditable(ctx, input.runId);
    const result = await ctx.container.useCases.getExtractionRunReport.execute({ runId: input.runId });
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),
});
