import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  domainError,
  isRecordLocked,
  nodeFieldSet,
  normaliseOutputType,
  summariseDocumentEdits,
} from "@wayfinder/domain";
import type {
  ConversationalNodeConfig,
  DocumentEdit,
  SessionStatus,
  StepOutputField,
  TemplateField,
} from "@wayfinder/domain";
import { accessError, authorizeSessionAccess } from "@/lib/session-access";
import type { Container } from "@/lib/container";
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
//
// The lock question is delegated to the domain rule rather than answered here,
// because the two answering it separately is what produced the defect: the guard
// let a pending approver edit their own subject step while this still reported
// the document locked, so the dialog refused an edit the server would have
// allowed.
export const documentEditability = (input: {
  sessionStatus: SessionStatus;
  allowManualEdit: boolean;
  hasSnapshot: boolean;
  hasPendingApproval: boolean;
  sessionIsOnStep: boolean;
}): { editable: boolean; reason: string | null } => {
  if (input.sessionStatus !== "active") {
    return { editable: false, reason: "This session is no longer active." };
  }
  if (!input.allowManualEdit) {
    return { editable: false, reason: "Editing is disabled for this step." };
  }
  const locked = isRecordLocked({
    hasRecordedSnapshot: input.hasSnapshot,
    hasPendingApproval: input.hasPendingApproval,
    sessionIsOnStep: input.sessionIsOnStep,
  });
  if (locked) {
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

// Who made each edit, as the reader should see them. Resolved once per distinct
// editor rather than per edit, and never allowed to fail the query: a deleted
// account costs the name, not the record of what changed.
const resolveEditorNames = async (
  container: Container,
  editHistory: readonly DocumentEdit[],
): Promise<Map<string, string>> => {
  const userIds = [
    ...new Set(
      editHistory
        .map((entry) => entry.editedByUserId)
        .filter((userId): userId is string => userId !== null),
    ),
  ];

  const names = new Map<string, string>();
  await Promise.all(
    userIds.map(async (userId) => {
      const result = await container.repos.users.findById(userId);
      if (result.error || !result.data) return;
      const name = result.data.name?.trim();
      names.set(userId, name && name.length > 0 ? name : result.data.email);
    }),
  );
  return names;
};

const ACCESS_CODE = {
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  500: "INTERNAL_SERVER_ERROR",
} as const;

// Holding a message UUID is not authorisation (ADR-045 §1). Both procedures
// resolve the message's session and test the caller against its participant
// membership — the same check the REST document routes already apply.
const authoriseSession = async (
  container: Container,
  sessionId: string,
  userId: string,
  isAdmin: boolean,
  requireSend: boolean,
): Promise<void> => {
  const outcome = await authorizeSessionAccess(container, sessionId, userId, isAdmin, {
    requireSend,
    // The approver grant (ADR-018) is read-only, so it opens the field view but
    // never the edit. An approver's *scoped* edit right is a different check —
    // see `canSend` below.
    allowApprover: !requireSend,
  });
  if (outcome.authorized) return;
  throw new TRPCError({
    code: ACCESS_CODE[outcome.status],
    message: accessError(outcome.status),
  });
};

// Whether the caller has ordinary send access to the session. False for an
// approver, who is a read-only viewer — their edit goes through the scoped
// approver path instead, which checks that the step is their own subject.
const hasSendAccess = async (
  container: Container,
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> => {
  const outcome = await authorizeSessionAccess(container, sessionId, userId, isAdmin, {
    requireSend: true,
    allowApprover: false,
  });
  return outcome.authorized;
};

export const documentRouter = router({
  getFields: authenticatedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const messageResult = await ctx.container.repos.sessionMessages.findById(input.messageId);
      if (messageResult.error) throw toTrpcError(messageResult.error);
      const message = messageResult.data;
      if (!message) throw toTrpcError(domainError("NOT_FOUND", "Record not found."));
      await authoriseSession(ctx.container, message.sessionId, ctx.userId, ctx.isAdmin, false);

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

      const [snapshotResult, approvalsResult] = await Promise.all([
        ctx.container.repos.approvals.hasRecordedSnapshot(message.sessionId),
        ctx.container.repos.approvals.listBySession(message.sessionId),
      ]);
      if (snapshotResult.error) throw toTrpcError(snapshotResult.error);
      if (approvalsResult.error) throw toTrpcError(approvalsResult.error);

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
        hasPendingApproval: approvalsResult.data.some((approval) => approval.status === "pending"),
        sessionIsOnStep:
          message.stepNodeId !== null && session.currentNodeId === message.stepNodeId,
      });

      // What each approver actually changed. The history has always been
      // recorded and has always survived regeneration; nothing read it back, so
      // an originator could see *that* their document was edited and never what
      // the new values were.
      const editHistory = message.document?.editHistory ?? [];
      const editorNames = await resolveEditorNames(ctx.container, editHistory);
      const summary = summariseDocumentEdits({
        editHistory,
        fields: fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          // A group's value lives in its items; hand the summariser the same
          // JSON shape the edit diff stores, so both render identically.
          value: field.type === "group" ? JSON.stringify(field.items ?? []) : field.value,
        })),
      });

      return {
        filename: message.document?.filename ?? null,
        editable,
        reason,
        editedAt: message.document?.editedAt ?? null,
        editedByUserId: message.document?.editedByUserId ?? null,
        fields,
        editSummary: {
          edits: summary.edits.map((entry) => ({
            editedAt: entry.editedAt,
            editedBy: entry.editedByUserId
              ? editorNames.get(entry.editedByUserId) ?? null
              : null,
            changes: entry.changes,
          })),
          untouched: summary.untouched,
        },
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

      // Two ways in: ordinary send access, or a pending approver editing the one
      // step their approval is about (ADR-045 §2). The approver path re-checks
      // that scope itself, so a caller with neither is rejected by the first
      // check below.
      const canSend = await hasSendAccess(
        ctx.container,
        message.sessionId,
        ctx.userId,
        ctx.isAdmin,
      );
      if (!canSend) {
        const approverEdit = await ctx.container.useCases.approverEditSubjectFields.execute({
          messageId: input.messageId,
          editedByUserId: ctx.userId,
          values: input.values,
          groupItems: input.groupItems,
        });
        if (approverEdit.error) throw toTrpcError(approverEdit.error);
        if (approverEdit.data.fieldErrors) {
          return { ok: false as const, fieldErrors: approverEdit.data.fieldErrors };
        }
        return { ok: true as const, document: approverEdit.data.document };
      }

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
