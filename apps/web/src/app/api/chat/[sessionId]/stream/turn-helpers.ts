import { formatDataStreamPart } from "ai";
import {
  type AiTurnPayload,
  type ConversationalNodeConfig,
  type DocumentGenerationConfidence,
  type Flow,
  type FlowNode,
  type GatheredContextItem,
  type PromptSessionUpload,
  type PromptUserProfile,
  type ResolvedDocumentGenerationBudget,
  type Session,
  type SessionMessage,
  type SessionUpload,
} from "@rbrasier/domain";
import { turnResponseSchema } from "@rbrasier/shared";
import type { getContainer } from "@/lib/container";
import { OUTSTANDING_CONTEXT_KEY } from "./gate-holds";
import { streamTurn, type StreamTurnWriter } from "./stream-turn";

// Re-exported from its lightweight home so existing importers keep working while
// the gate-hold counter can depend on the constant without pulling this module.
export { OUTSTANDING_CONTEXT_KEY };

type Container = ReturnType<typeof getContainer>;

// Turn completed session uploads into prompt-ready documents, truncating the
// combined extracted text to the configured budget. Uploads store full text with
// no upload-time cap (see uploads/route.ts), so the budget must be applied here
// before the text reaches the prompt.
export const buildPromptSessionUploads = (
  uploads: SessionUpload[],
  budgetChars: number,
): PromptSessionUpload[] => {
  const completed = uploads.filter(
    (upload) =>
      upload.extractionStatus === "complete" &&
      upload.extractedText !== null &&
      upload.extractedText.trim().length > 0,
  );

  const result: PromptSessionUpload[] = [];
  let remaining = Math.max(0, budgetChars);
  for (const upload of completed) {
    if (remaining <= 0) break;
    const fullText = upload.extractedText ?? "";
    const slice = fullText.slice(0, remaining);
    const wasTruncated = slice.length < fullText.length;
    result.push({
      filename: upload.filename,
      extractedText: wasTruncated
        ? `${slice}\n\n[Document truncated to fit the context budget.]`
        : slice,
    });
    remaining -= slice.length;
  }
  return result;
};

// Marker appended to the user turn shown to the model so a thin message still
// signals that files are attached. Empty when there are no uploads.
export const buildAttachmentAnnotation = (uploads: PromptSessionUpload[]): string => {
  if (uploads.length === 0) return "";
  return `\n\n[Attached: ${uploads.map((upload) => upload.filename).join(", ")}]`;
};

export const buildGatheredContext = (messages: SessionMessage[]): string => {
  const items = messages
    .filter((m) => m.role === "assistant" && m.stepNodeId !== null && m.aiPayload)
    .flatMap((m) => m.aiPayload!.contextGathered);
  return renderGatheredContext(items);
};

// Same renderer, driven by the SQL-side aggregation returned by
// `GetSessionForTurn`. Kept separate so the stream route (bounded turn read)
// does not go through the message-scanning path above just to hand back a
// string.
export const renderGatheredContext = (items: GatheredContextItem[]): string => {
  if (items.length === 0) return "";
  return items.map((item) => `- ${item.key}: ${item.value}`).join("\n");
};

// Merge the pre-generation evaluation's missing-information items into an
// assistant message's gathered context, labelled outstanding. Best-effort: a
// failure here must not break the turn.
export async function appendShortcomingsToContext(
  container: Container,
  messageId: string,
  items: string[],
): Promise<void> {
  if (items.length === 0) return;
  const existing = await container.repos.sessionMessages.findById(messageId);
  if (existing.error || !existing.data || !existing.data.aiPayload) return;

  const outstanding = items.map((item) => ({ key: OUTSTANDING_CONTEXT_KEY, value: item }));
  const mergedPayload: AiTurnPayload = {
    ...existing.data.aiPayload,
    contextGathered: [...existing.data.aiPayload.contextGathered, ...outstanding],
  };

  await container.repos.sessionMessages.updateAiPayload(messageId, mergedPayload).catch(() => undefined);
}

// A writer that accepts any pre-formatted data-stream part (StreamTurnWriter is
// nominally text-only; the boundary and note parts share the same wire format).
interface DataStreamPartWriter {
  write: (part: ReturnType<typeof formatDataStreamPart<"text">>) => void;
}

// Closes the current streamed bubble so the next text part opens a new one on
// the client. Without this every text written into one response concatenates
// into a single bubble, which the persisted view then appears to rewrite.
const writeMessageBoundary = (writer: DataStreamPartWriter): void => {
  writer.write(formatDataStreamPart("finish_step", { finishReason: "stop", isContinued: false }));
};

// The pre-generation gate overruled this reply, but the user has already
// watched it stream. Persist it as a real message so the corrective follow-up
// appends below it instead of appearing to rewrite the conversation.
// Best-effort: a failure here must not block the follow-up.
export async function persistHeldReply(
  container: Container,
  session: Session,
  aiPayload: AiTurnPayload,
): Promise<void> {
  await container.repos.sessionMessages
    .create({
      sessionId: session.id,
      role: "assistant",
      content: aiPayload.response,
      confidence: Math.round(aiPayload.stepCompleteConfidence),
      stepNodeId: session.currentNodeId,
      aiPayload,
    })
    .catch(() => undefined);
}

export const CROSS_CHECK_PASS_NOTE =
  "Cross-check complete — everything is in alignment with the reference documents.";

// Streamed the moment the cross-check passes, so the user gets explicit
// feedback before the (slow) branch choice and document generation run.
export function writeCrossCheckPassNote(writer: DataStreamPartWriter): void {
  writeMessageBoundary(writer);
  writer.write(formatDataStreamPart("text", CROSS_CHECK_PASS_NOTE));
}

// Persisted separately from the streamed note (and after the assistant turn)
// so the stored order matches what streamed: reply first, then the note.
// Best-effort: a failure here must not block the advance.
export async function persistCrossCheckPassNote(
  container: Container,
  sessionId: string,
  stepNodeId: string | null,
): Promise<void> {
  await container.repos.sessionMessages
    .create({ sessionId, role: "system", content: CROSS_CHECK_PASS_NOTE, stepNodeId })
    .catch(() => undefined);
}

export interface StreamGapFollowupInput {
  container: Container;
  writer: StreamTurnWriter;
  session: Session;
  flowId: string;
  system: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  missingInformation: string[];
  modelName: string;
  userId: string;
}

// After a failed pre-generation evaluation, generate and stream a follow-up
// assistant turn that asks the user for the outstanding items, then persist it.
// The step does not advance, so the follow-up keeps the conversation on the same
// node until the gaps are filled. Returns the persisted follow-up's id (or null
// if persistence failed) so the caller can attach the outstanding items to it.
export async function streamGapFollowup(input: StreamGapFollowupInput): Promise<{ messageId: string | null }> {
  // The grading model can fail the gate on confidence alone without listing an
  // item, so fall back to a generic line rather than handing the chat model an
  // empty bullet list.
  const gaps =
    input.missingInformation.length > 0
      ? input.missingInformation.map((item) => `- ${item}`).join("\n")
      : "- Some details in your answers still need to be confirmed before this step can be marked complete.";
  const followupSystem = [
    input.system,
    "",
    "[Cross-check correction] Your previous reply implied this step was complete, but a higher-quality review found outstanding information. Do not claim the step is complete or advance it. In your next reply, briefly tell the user what the review found is still missing or unclear, then ask them for it — in a single, friendly message. The still-required items are:",
    gaps,
  ].join("\n");

  // The follow-up corrects the reply above it, so it must arrive as a NEW
  // bubble — appended, never merged into the message it corrects.
  writeMessageBoundary(input.writer);

  // Through the ILanguageModel port: usage recording, quota enforcement,
  // Langfuse tracing, and the concurrency governor all apply as decorators
  // (ADR-026). No hand-rolled recordTokenUsage here.
  const streamResult = await streamTurn({
    llm: input.container.services.llm,
    purpose: "chat-gap-followup",
    model: input.modelName,
    userId: input.userId,
    flowId: input.flowId,
    sessionId: input.session.id,
    schema: turnResponseSchema,
    system: followupSystem,
    messages: input.messages,
    writer: input.writer,
  });
  const turnResult = streamResult.object;

  const aiPayload: AiTurnPayload = {
    response: turnResult.response,
    rationale: turnResult.rationale,
    stepCompleteConfidence: turnResult.stepCompleteConfidence,
    contextGathered: turnResult.contextGathered,
  };

  const created = await input.container.repos.sessionMessages
    .create({
      sessionId: input.session.id,
      role: "assistant",
      content: turnResult.response,
      confidence: Math.round(turnResult.stepCompleteConfidence),
      stepNodeId: input.session.currentNodeId,
      aiPayload,
    })
    .catch(() => null);

  return { messageId: created && !created.error ? created.data.id : null };
}

export async function generateDocument(
  container: Container,
  messageId: string,
  sessionId: string,
  flow: Flow,
  _nodes: FlowNode[],
  messages: SessionMessage[],
  node: FlowNode,
  // Threaded by the pre-generation evaluation gate on a pass so generation
  // reuses the already-extracted values and grade rather than recomputing them.
  precomputed?: { fieldValues?: Record<string, string>; grade?: DocumentGenerationConfidence },
): Promise<boolean> {
  try {
    // Resolve the admin-configured budget at the edge (ADR-027). A failure here
    // must never block generation, which falls back to the use-case defaults.
    let budget: ResolvedDocumentGenerationBudget | undefined;
    try {
      budget = await container.runtimeConfig.resolveDocumentGenerationBudget();
    } catch {
      budget = undefined;
    }

    const result = await container.useCases.generateDocument.execute({
      messageId,
      sessionId,
      messages,
      flow,
      node,
      budget,
      fieldValues: precomputed?.fieldValues,
      grade: precomputed?.grade,
    });
    if (result.error) {
      const status = await container.repos.sessionMessages.updateDocumentStatus(messageId, "failed");
      if (status.error) {
        await container.services.errorLogger.log({
          level: "error",
          message: "Failed to mark document status after generation error",
          stack: null,
          page: `api/chat/${sessionId}/stream`,
          metadata: { sessionId, messageId, nodeId: node.id, originalError: result.error.message },
        });
        return false;
      }
      await container.services.errorLogger.log({
        level: "error",
        message: `Document generation failed: ${result.error.message}`,
        stack: result.error.cause instanceof Error ? result.error.cause.stack ?? null : null,
        page: `api/chat/${sessionId}/stream`,
        metadata: { sessionId, messageId, nodeId: node.id, errorCode: result.error.code },
      });
      return false;
    }
    return true;
  } catch (cause) {
    await container.repos.sessionMessages
      .updateDocumentStatus(messageId, "failed")
      .catch(() => undefined);
    await container.services.errorLogger.log({
      level: "error",
      message: "Document generation threw",
      stack: cause instanceof Error ? cause.stack ?? null : null,
      page: `api/chat/${sessionId}/stream`,
      metadata: { sessionId, messageId, nodeId: node.id },
    });
    return false;
  }
}

// Routed through the ILanguageModel port so usage recording, quota enforcement,
// the concurrency governor, and Langfuse tracing all apply as decorators
// (ADR-026) — no hand-rolled recordTokenUsage or direct SDK call here.
// Best-effort: any failure (including a quota block) falls back to a truncated
// slice of the first user message.
export async function generateTitle(
  container: Container,
  sessionId: string,
  firstUserMessage: string,
  modelName: string,
  userId: string,
): Promise<void> {
  const result = await container.services.llm.generateText({
    purpose: "chat-title",
    userId,
    sessionId,
    model: modelName,
    system:
      "Generate a concise title (max 80 characters) for a workflow session based on the user's first message. Return only the title, no quotes or punctuation.",
    prompt: firstUserMessage,
    maxTokens: 30,
  });
  const generated = result.error ? "" : result.data.text.trim().slice(0, 80);
  const title = generated || firstUserMessage.slice(0, 80);
  if (title) {
    await container.repos.sessions.update(sessionId, { title }).catch(() => undefined);
  }
}

export async function isAutoNodeEnabled(
  container: Container,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  const flag = await container.useCases.isFeatureEnabledForUser.execute(userId, "auto_node", isAdmin);
  return !flag.error && flag.data === true;
}

export interface DispatchAutoNodeInput {
  container: Container;
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
  userId: string;
  userRole: "admin" | "user";
}

// Runs an auto node: gathers its request fields, records a pending execution and
// hands off to the node executor (n8n). The result returns later via the inbound
// webhook, which advances the session. Surfaces a non-interactive status message.
export async function dispatchAutoNode(input: DispatchAutoNodeInput): Promise<void> {
  const { container, session, flow, node, messages, userId, userRole } = input;
  try {
    const result = await container.useCases.runAutoNode.execute({
      session,
      flow,
      node,
      messages,
      userId,
      userRole,
    });

    // A synchronous completion (the mock executor) carries its result inline —
    // apply it so the session advances without waiting for a callback.
    if (!result.error && result.data.status === "completed") {
      await container.useCases.applyAutoNodeResult.execute({
        sessionId: session.id,
        correlationId: result.data.correlationId,
        nodeId: node.id,
        status: "completed",
        data: result.data.data,
      });
    }

    const content = result.error
      ? `This automated step (${node.name}) could not be started: ${result.error.message}`
      : result.data.status === "completed"
        ? `Completed automated step: ${node.name}.`
        : `Running automated step: ${node.name}. This step completes on its own — no input is needed.`;

    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "system",
      content,
      stepNodeId: node.id,
    });

    if (result.error) {
      await container.services.errorLogger.log({
        level: "error",
        message: `Auto node dispatch failed: ${result.error.message}`,
        stack: result.error.cause instanceof Error ? result.error.cause.stack ?? null : null,
        page: `api/chat/${session.id}/stream`,
        metadata: { sessionId: session.id, nodeId: node.id, errorCode: result.error.code },
      });
    }
  } catch (cause) {
    await container.services.errorLogger.log({
      level: "error",
      message: "Auto node dispatch threw",
      stack: cause instanceof Error ? cause.stack ?? null : null,
      page: `api/chat/${session.id}/stream`,
      metadata: { sessionId: session.id, nodeId: node.id },
    });
  }
}

export async function isScheduledNodeEnabled(
  container: Container,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  const flag = await container.useCases.isFeatureEnabledForUser.execute(
    userId,
    "scheduled_node",
    isAdmin,
  );
  return !flag.error && flag.data === true;
}

// Flatten the context gathered across the conversation into a key/value map so a
// scheduled node can anchor its fire time to an earlier step's metadata.
const buildSessionMetadata = (messages: SessionMessage[]): Record<string, string> => {
  const metadata: Record<string, string> = {};
  for (const message of messages) {
    if (message.role !== "assistant" || !message.aiPayload) continue;
    for (const item of message.aiPayload.contextGathered) {
      metadata[item.key] = item.value;
    }
  }
  return metadata;
};

const buildScheduleTranscript = (messages: SessionMessage[]): string =>
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n")
    .slice(0, 8000);

export interface DispatchScheduledNodeInput {
  container: Container;
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
}

// Reaching a scheduled node creates an active schedule row and pauses the
// session (no initial message is generated). The worker resumes it when due.
export async function dispatchScheduledNode(input: DispatchScheduledNodeInput): Promise<void> {
  const { container, session, flow, node, messages } = input;
  try {
    const metadata = buildSessionMetadata(messages);
    const priorOutputs = await container.repos.sessionStepOutputs.listBySession(session.id);
    const result = await container.useCases.scheduleNodeEvent.execute({
      session,
      node,
      metadata,
      priorStepOutputs: priorOutputs.error ? [] : priorOutputs.data,
      insights: Object.entries(metadata).map(([key, value]) => ({ key, value })),
      transcript: buildScheduleTranscript(messages),
      contextDocs: flow.contextDocs,
    });

    let content: string;
    if (result.error) {
      content = `This scheduled step (${node.name}) could not be scheduled: ${result.error.message}`;
    } else if (result.data.status === "failed") {
      const reason =
        typeof result.data.payload.reason === "string" ? result.data.payload.reason : "unknown reason";
      content = `Scheduled step "${node.name}" could not start: ${reason}`;
    } else {
      content = `Scheduled step: ${node.name}. Next: ${result.data.nextFireAt.toISOString()}.`;
    }

    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "system",
      content,
      stepNodeId: node.id,
    });

    if (result.error) {
      await container.services.errorLogger.log({
        level: "error",
        message: `Scheduled node dispatch failed: ${result.error.message}`,
        stack: result.error.cause instanceof Error ? result.error.cause.stack ?? null : null,
        page: `api/chat/${session.id}/stream`,
        metadata: { sessionId: session.id, nodeId: node.id, errorCode: result.error.code },
      });
    }
  } catch (cause) {
    await container.services.errorLogger.log({
      level: "error",
      message: "Scheduled node dispatch threw",
      stack: cause instanceof Error ? cause.stack ?? null : null,
      page: `api/chat/${session.id}/stream`,
      metadata: { sessionId: session.id, nodeId: node.id },
    });
  }
}

export interface GenerateInitialMessageInput {
  container: Container;
  sessionId: string;
  newNodeId: string;
  newNode: FlowNode;
  flow: Flow;
  // Model name string; the port resolves this to a concrete SDK model. Usage
  // recording, quota enforcement, Langfuse tracing, and the concurrency
  // governor all apply as decorators (ADR-026).
  modelName: string;
  organisationName: string | null;
  userProfile: PromptUserProfile | null;
  userId: string;
  gatheredContext: string;
  globalInstructions?: string | null;
}

export async function generateInitialMessage(input: GenerateInitialMessageInput): Promise<void> {
  const {
    container,
    sessionId,
    newNodeId,
    newNode,
    flow,
    modelName,
    organisationName,
    userProfile,
    userId,
    gatheredContext,
    globalInstructions,
  } = input;
  try {
    const newNodeConfig = newNode.config as unknown as ConversationalNodeConfig;

    // No user message yet for an opening turn — retrieve against the context
    // gathered so far so the AI still sees the most relevant document excerpts.
    const retrievalResult = await container.useCases.retrieveDocumentChunks.execute({
      flowId: flow.id,
      sessionId,
      query: gatheredContext,
    });
    const retrievedChunks = retrievalResult.error ? [] : retrievalResult.data;

    // Carry the user's attachments into the opener too, so a step that follows an
    // upload sees the document without the user re-stating it.
    const uploadsResult = await container.repos.sessionUploads.listBySession(sessionId);
    const uploadConfig = await container.runtimeConfig.getSessionUploadConfig();
    const sessionUploads = uploadsResult.error
      ? []
      : buildPromptSessionUploads(uploadsResult.data, uploadConfig.totalBudgetChars);

    const systemPromptResult = container.services.sessionAgent.buildSystemPrompt({
      nodeConfig: newNodeConfig,
      retrievedChunks,
      sessionUploads,
      gatheredContext,
      workflowName: flow.name,
      organisationName,
      globalInstructions,
      expertRole: flow.expertRole,
      userProfile,
    });
    if (systemPromptResult.error) return;

    const result = await container.services.llm.generateObject<{
      response: string;
      rationale: string;
      stepCompleteConfidence: number;
      contextGathered: { key: string; value: string }[];
    }>({
      purpose: "chat-turn",
      userId,
      flowId: flow.id,
      sessionId,
      model: modelName,
      schema: turnResponseSchema,
      system: systemPromptResult.data,
      messages: [{ role: "user", content: "Please begin." }],
    });
    if (result.error) {
      await container.services.errorLogger.log({
        level: "error",
        message: `Initial message generation failed: ${result.error.message}`,
        stack: result.error.cause instanceof Error ? result.error.cause.stack ?? null : null,
        page: `api/chat/${sessionId}/stream`,
        metadata: { sessionId, newNodeId },
      });
      return;
    }

    const aiPayload: AiTurnPayload = {
      response: result.data.object.response,
      rationale: result.data.object.rationale,
      stepCompleteConfidence: result.data.object.stepCompleteConfidence,
      contextGathered: result.data.object.contextGathered,
    };

    await container.repos.sessionMessages.create({
      sessionId,
      role: "assistant",
      content: result.data.object.response,
      confidence: Math.round(result.data.object.stepCompleteConfidence),
      stepNodeId: newNodeId,
      aiPayload,
    });
  } catch (cause) {
    await container.services.errorLogger.log({
      level: "error",
      message: "Initial message generation failed",
      stack: cause instanceof Error ? cause.stack ?? null : null,
      page: `api/chat/${sessionId}/stream`,
      metadata: { sessionId, newNodeId },
    });
  }
}

export interface ApplyAdvanceSideEffectsInput {
  container: Container;
  // The session after it advanced (its currentNodeId is the new node).
  session: Session;
  flow: Flow;
  nodes: FlowNode[];
  // The node that just completed — its template drives document generation.
  completedNode: FlowNode;
  newNodeId: string | null;
  // Messages to fall back to if a re-fetch fails while building next-step context.
  fallbackMessages: SessionMessage[];
  gatheredContext: string;
  organisationName: string | null;
  userProfile: PromptUserProfile | null;
  userId: string;
  isAdmin: boolean;
  // Model name string used for the opener (generateInitialMessage) — the port
  // resolves this to a concrete SDK model. Was previously a resolved
  // LanguageModel + provider pair; both are now decorator concerns.
  modelName: string;
  globalInstructions?: string | null;
  // Threaded from the pre-generation evaluation gate on a pass: the values it
  // already extracted and the grade it produced, so document generation skips
  // the redundant second extraction and grading.
  precomputedDocument?: { fieldValues: Record<string, string>; grade: DocumentGenerationConfidence };
  // Called with true while the completed step's document is generated and false
  // once it finishes. The streaming route uses it to write the transient
  // "Generating document…" badge annotation; the Proceed path omits it.
  onDocumentGenerationChange?: (active: boolean) => void;
}

// The post-advance side effects shared by the auto-advance turn and the operator
// Proceed path (ADR-026): generate the completed step's document, then open the
// next step (AI opener) or dispatch a scheduled / auto node. Extracted verbatim
// from the stream route so both callers produce an identical outcome.
export async function applyAdvanceSideEffects(input: ApplyAdvanceSideEffectsInput): Promise<void> {
  const {
    container,
    session,
    flow,
    nodes,
    completedNode,
    newNodeId,
    fallbackMessages,
    gatheredContext,
    organisationName,
    userProfile,
    userId,
    isAdmin,
    modelName,
    globalInstructions,
    precomputedDocument,
    onDocumentGenerationChange,
  } = input;

  const completedNodeConfig = completedNode.config as unknown as ConversationalNodeConfig;

  const assistantMessages = await container.repos.sessionMessages.listBySession(session.id);
  if (!assistantMessages.error) {
    const milestone = [...assistantMessages.data]
      .reverse()
      .find((m) => m.role === "assistant" && m.stepNodeId === completedNode.id);
    if (
      milestone &&
      completedNodeConfig.outputType === "generate_document" &&
      completedNodeConfig.documentTemplatePath
    ) {
      await container.repos.sessionMessages
        .updateDocumentStatus(milestone.id, "pending")
        .catch(() => undefined);
      // Await generation before opening the next step: a fire-and-forget call
      // raced the opener onto the screen and, on a terminal step (no opener to
      // keep the turn alive), was orphaned before it could persist the document.
      onDocumentGenerationChange?.(true);
      try {
        await generateDocument(
          container,
          milestone.id,
          session.id,
          flow,
          nodes,
          assistantMessages.data,
          completedNode,
          precomputedDocument,
        );
      } finally {
        onDocumentGenerationChange?.(false);
      }
    }
  }

  if (!newNodeId) return;

  const newNode = nodes.find((n) => n.id === newNodeId);
  if (!newNode) return;

  const refreshed = await container.repos.sessionMessages.listBySession(session.id);
  const nextStepContext = refreshed.error ? gatheredContext : buildGatheredContext(refreshed.data);
  const messages = refreshed.error ? fallbackMessages : refreshed.data;

  if (newNode.type === "scheduled" && (await isScheduledNodeEnabled(container, userId, isAdmin))) {
    await dispatchScheduledNode({ container, session, flow, node: newNode, messages });
    return;
  }

  if (newNode.type === "auto" && (await isAutoNodeEnabled(container, userId, isAdmin))) {
    await dispatchAutoNode({
      container,
      session,
      flow,
      node: newNode,
      messages,
      userId,
      userRole: isAdmin ? "admin" : "user",
    });
    return;
  }

  if (newNode.type !== "approval") {
    // Approval nodes park the session on the operator-facing approval gate,
    // which raises its own request — generating an AI opener here would leave a
    // stray chat message above the gate.
    await generateInitialMessage({
      container,
      sessionId: session.id,
      newNodeId,
      newNode,
      flow,
      modelName,
      organisationName,
      userProfile,
      userId,
      gatheredContext: nextStepContext,
      globalInstructions,
    });
  }
}

