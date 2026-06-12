import { z } from "zod";
import { domainError } from "@rbrasier/domain";
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

// The step-output row records the exact key/label/type/options used at
// generation; richer constraints (optional, maxLength, min/max) live on the
// node's configured fields. Prefer the config defs, falling back to the
// step-output shape for templates whose fields were extracted lazily.
const resolveDisplayFields = (
  config: ConversationalNodeConfig,
  stepFields: StepOutputField[],
): TemplateField[] => {
  if (config.documentTemplateFields && config.documentTemplateFields.length > 0) {
    return config.documentTemplateFields;
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
      if (!message || !message.document) {
        throw toTrpcError(domainError("NOT_FOUND", "Document not found."));
      }

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

      const snapshotResult = await ctx.container.repos.approvals.hasRecordedSnapshot(
        message.sessionId,
      );
      if (snapshotResult.error) throw toTrpcError(snapshotResult.error);

      const stepFields =
        stepOutputResult.error || !stepOutputResult.data ? [] : stepOutputResult.data.fields;
      const valueByKey = new Map(stepFields.map((field) => [field.key, field.value]));
      const fields: DocumentFieldWithValue[] = resolveDisplayFields(config, stepFields).map(
        (field) => ({ ...field, value: valueByKey.get(field.key) ?? "" }),
      );

      const { editable, reason } = documentEditability({
        sessionStatus: session.status,
        allowManualEdit: config.allowManualEdit !== false,
        hasSnapshot: snapshotResult.data,
      });

      return {
        filename: message.document.filename,
        editable,
        reason,
        editedAt: message.document.editedAt ?? null,
        editedByUserId: message.document.editedByUserId ?? null,
        fields,
      };
    }),

  updateFields: authenticatedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        values: z.record(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateDocumentFields.execute({
        messageId: input.messageId,
        editedByUserId: ctx.userId,
        values: input.values,
      });
      if (result.error) throw toTrpcError(result.error);

      if (result.data.fieldErrors) {
        return { ok: false as const, fieldErrors: result.data.fieldErrors };
      }
      return { ok: true as const, document: result.data.document };
    }),
});
