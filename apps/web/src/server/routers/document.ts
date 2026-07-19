import { z } from "zod";
import { domainError, nodeFieldSet, normaliseOutputType } from "@rbrasier/domain";
import type {
  ConversationalNodeConfig,
  SessionStatus,
  StepOutputField,
  TemplateField,
} from "@rbrasier/domain";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export interface DocumentFieldWithValue extends TemplateField {
  value: string;
  // Present only for a "group" field: the current repeating items, so the edit
  // dialog can seed its per-item editor.
  items?: Array<Record<string, string>>;
}

// Pure gate for whether a generated document may be manually edited. The server
// re-enforces these same conditions in UpdateDocumentFields — this only drives
// the UI affordance and an explanatory reason.
export const documentEditability = (input: {
  sessionStatus: SessionStatus;
  allowManualEdit: boolean;
  hasSnapshot: boolean;
}): { editable: boolean; reason: string | null } => {
  if (input.sessionStatus !== "active") {
    return { editable: false, reason: "This session is no longer active." };
  }
  if (!input.allowManualEdit) {
    return { editable: false, reason: "Editing is disabled for this step." };
  }
  if (input.hasSnapshot) {
    return { editable: false, reason: "The document is locked after approval." };
  }
  return { editable: true, reason: null };
};

// The step-output row records the exact key/label/type/options used at capture;
// richer constraints (optional, maxLength, min/max) live on the node's
// configured field set. Prefer the declared fields — the template fields for a
// document step, the author-declared fields for a structured step — via the
// single nodeFieldSet accessor, falling back to the step-output shape for
// templates whose fields were extracted lazily.
const resolveDisplayFields = (
  config: ConversationalNodeConfig,
  stepFields: StepOutputField[],
): TemplateField[] => {
  const declared = nodeFieldSet(config);
  if (declared.length > 0) {
    return declared;
  }
  return stepFields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    ...(field.options ? { options: field.options } : {}),
    optional: false,
    raw: field.label,
  }));
};

export const documentRouter = router({
  getFields: authenticatedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const messageResult = await ctx.container.repos.sessionMessages.findById(input.messageId);
      if (messageResult.error) throw toTrpcError(messageResult.error);
      const message = messageResult.data;
      if (!message) throw toTrpcError(domainError("NOT_FOUND", "Record not found."));

      const [sessionResult, nodeResult, stepOutputResult] = await Promise.all([
        ctx.container.repos.sessions.findById(message.sessionId),
        message.stepNodeId
          ? ctx.container.repos.flowNodes.findById(message.stepNodeId)
          : Promise.resolve({ data: null }),
        ctx.container.repos.sessionStepOutputs.findByMessageId(input.messageId),
      ]);

      if (sessionResult.error) throw toTrpcError(sessionResult.error);
      const session = sessionResult.data;
      if (!session) throw toTrpcError(domainError("NOT_FOUND", "Session not found."));

      const node = "error" in nodeResult ? null : nodeResult.data;
      const config = (node?.config ?? {}) as unknown as ConversationalNodeConfig;
      const isStructured = normaliseOutputType(config.outputType) === "structured";

      // A document step surfaces its fields off the generated document; a
      // structured step has no document, so its record is the step output alone
      // (ADR-038 §4). Anything else with neither is genuinely not found.
      if (!message.document && !isStructured) {
        throw toTrpcError(domainError("NOT_FOUND", "Document not found."));
      }

      const snapshotResult = await ctx.container.repos.approvals.hasRecordedSnapshot(
        message.sessionId,
      );
      if (snapshotResult.error) throw toTrpcError(snapshotResult.error);

      const stepFields =
        stepOutputResult.error || !stepOutputResult.data ? [] : stepOutputResult.data.fields;
      const valueByKey = new Map(stepFields.map((field) => [field.key, field.value]));
      const itemsByKey = new Map(
        stepFields.filter((field) => field.items).map((field) => [field.key, field.items!]),
      );
      const fields: DocumentFieldWithValue[] = resolveDisplayFields(config, stepFields).map(
        (field) => ({
          ...field,
          value: valueByKey.get(field.key) ?? "",
          ...(field.type === "group" ? { items: itemsByKey.get(field.key) ?? [] } : {}),
        }),
      );

      const { editable, reason } = documentEditability({
        sessionStatus: session.status,
        allowManualEdit: config.allowManualEdit !== false,
        hasSnapshot: snapshotResult.data,
      });

      return {
        filename: message.document?.filename ?? null,
        editable,
        reason,
        editedAt: message.document?.editedAt ?? null,
        editedByUserId: message.document?.editedByUserId ?? null,
        fields,
      };
    }),

  updateFields: authenticatedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        values: z.record(z.string()),
        groupItems: z.record(z.array(z.record(z.string()))).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const messageResult = await ctx.container.repos.sessionMessages.findById(input.messageId);
      if (messageResult.error) throw toTrpcError(messageResult.error);
      const message = messageResult.data;
      if (!message) throw toTrpcError(domainError("NOT_FOUND", "Record not found."));

      const nodeResult = message.stepNodeId
        ? await ctx.container.repos.flowNodes.findById(message.stepNodeId)
        : { data: null };
      const node = "error" in nodeResult ? null : nodeResult.data;
      const config = (node?.config ?? {}) as unknown as ConversationalNodeConfig;

      // A structured step has no document to regenerate — its record is the
      // step output, updated in place (ADR-038 §4).
      if (normaliseOutputType(config.outputType) === "structured") {
        const structuredResult = await ctx.container.useCases.updateStructuredStepOutput.execute({
          messageId: input.messageId,
          editedByUserId: ctx.userId,
          values: input.values,
          groupItems: input.groupItems,
        });
        if (structuredResult.error) throw toTrpcError(structuredResult.error);
        if (!structuredResult.data.ok) {
          return { ok: false as const, fieldErrors: structuredResult.data.fieldErrors };
        }
        return { ok: true as const };
      }

      const result = await ctx.container.useCases.updateDocumentFields.execute({
        messageId: input.messageId,
        editedByUserId: ctx.userId,
        values: input.values,
        groupItems: input.groupItems,
      });
      if (result.error) throw toTrpcError(result.error);

      if (result.data.fieldErrors) {
        return { ok: false as const, fieldErrors: result.data.fieldErrors };
      }
      return { ok: true as const, document: result.data.document };
    }),
});
