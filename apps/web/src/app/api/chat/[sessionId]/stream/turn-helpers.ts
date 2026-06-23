import { generateObject, generateText, type LanguageModel } from "ai";
import { recordTokenUsage, resolveModel, type ProviderCredentials } from "@rbrasier/adapters";
import {
  ok,
  type AiTurnPayload,
  type ConversationalNodeConfig,
  type Flow,
  type FlowEdge,
  type FlowNode,
  type PromptSessionUpload,
  type PromptUserProfile,
  type ResolvedDocumentGenerationBudget,
  type Result,
  type Session,
  type SessionMessage,
  type SessionUpload,
} from "@rbrasier/domain";
import { branchChoiceSchema, turnResponseSchema } from "@rbrasier/shared";
import type { getContainer } from "@/lib/container";

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
  if (items.length === 0) return "";
  return items.map((item) => `- ${item.key}: ${item.value}`).join("\n");
};

export async function generateDocument(
  container: Container,
  messageId: string,
  sessionId: string,
  flow: Flow,
  _nodes: FlowNode[],
  messages: SessionMessage[],
  node: FlowNode,
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

export async function generateTitle(
  container: Container,
  sessionId: string,
  firstUserMessage: string,
  provider: Parameters<typeof resolveModel>[0],
  modelName: string,
  credentials: ProviderCredentials,
  userId: string,
): Promise<void> {
  try {
    const cheapModel = resolveModel(provider, modelName, credentials);
    const result = await generateText({
      model: cheapModel,
      system: "Generate a concise title (max 80 characters) for a workflow session based on the user's first message. Return only the title, no quotes or punctuation.",
      prompt: firstUserMessage,
      maxTokens: 30,
    });
    recordTokenUsage(
      container.repos.usageRepo,
      {
        purpose: "chat-title",
        userId,
        conversationId: sessionId,
        model: modelName,
        provider,
      },
      {
        promptTokens: result.usage.promptTokens ?? 0,
        completionTokens: result.usage.completionTokens ?? 0,
        systemTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    );
    const title = result.text.trim().slice(0, 80);
    if (title) {
      await container.repos.sessions.update(sessionId, { title });
    }
  } catch {
    const fallback = firstUserMessage.slice(0, 80);
    await container.repos.sessions.update(sessionId, { title: fallback }).catch(() => undefined);
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
  model: LanguageModel;
  organisationName: string | null;
  userProfile: PromptUserProfile | null;
  userId: string;
  provider: string;
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
    model,
    organisationName,
    userProfile,
    userId,
    provider,
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

    const result = await generateObject({
      model,
      schema: turnResponseSchema,
      system: systemPromptResult.data,
      messages: [{ role: "user", content: "Please begin." }],
    });

    const aiPayload: AiTurnPayload = {
      response: result.object.response,
      rationale: result.object.rationale,
      stepCompleteConfidence: result.object.stepCompleteConfidence,
      contextGathered: result.object.contextGathered,
    };

    await container.repos.sessionMessages.create({
      sessionId,
      role: "assistant",
      content: result.object.response,
      confidence: Math.round(result.object.stepCompleteConfidence),
      stepNodeId: newNodeId,
      aiPayload,
    });

    recordTokenUsage(
      container.repos.usageRepo,
      {
        purpose: "chat-turn",
        userId,
        conversationId: sessionId,
        model: provider === "anthropic" ? "claude-haiku-4-5-20251001" : undefined,
        provider: provider as Parameters<typeof recordTokenUsage>[1]["provider"],
      },
      {
        promptTokens: result.usage.promptTokens ?? 0,
        completionTokens: result.usage.completionTokens ?? 0,
        systemTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    );
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
  model: LanguageModel;
  provider: string;
  globalInstructions?: string | null;
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
    model,
    provider,
    globalInstructions,
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
      void generateDocument(
        container,
        milestone.id,
        session.id,
        flow,
        nodes,
        assistantMessages.data,
        completedNode,
      );
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
      model,
      organisationName,
      userProfile,
      userId,
      provider,
      gatheredContext: nextStepContext,
      globalInstructions,
    });
  }
}

// Recomputes the branch choice for a forked confirmation step at Proceed time,
// because the operator may have chatted further since the threshold was reached
// (ADR-026). Returns null for a single edge or when the model cannot decide.
async function recomputeBranchChoice(
  container: Container,
  session: Session,
  nodes: FlowNode[],
  edges: FlowEdge[],
  messages: SessionMessage[],
): Promise<string | null> {
  const outgoingEdges = edges.filter((e) => e.fromNodeId === session.currentNodeId);
  if (outgoingEdges.length <= 1) return null;

  const branchNodeIds = outgoingEdges.map((e) => e.toNodeId);
  const branchNodes = nodes
    .filter((node) => branchNodeIds.includes(node.id))
    .map((node) => {
      const config = node.config as { doneWhen?: string; aiInstruction?: string; instruction?: string };
      const doneWhenPurpose =
        config.doneWhen && config.doneWhen !== "__TEMPLATE_COMPLETE__" ? config.doneWhen : undefined;
      const purpose = doneWhenPurpose ?? config.aiInstruction ?? config.instruction;
      return { id: node.id, name: node.name, purpose };
    });

  const branchPromptResult = container.services.sessionAgent.buildBranchChoicePrompt({ branchNodes });
  if (branchPromptResult.error) return null;

  const aiConfig = await container.runtimeConfig.getAiConfig();
  const provider = aiConfig.provider;
  const branchingModelName = aiConfig.models.branching;
  const branchingModel = resolveModel(provider, branchingModelName, aiConfig.apiKeys[provider]);

  const coreMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  const branchResult = await generateObject({
    model: branchingModel,
    schema: branchChoiceSchema,
    system: branchPromptResult.data,
    messages: coreMessages,
  }).catch(() => null);
  if (!branchResult) return null;

  recordTokenUsage(
    container.repos.usageRepo,
    {
      purpose: "chat-branch-choice",
      userId: session.userId,
      conversationId: session.id,
      model: branchingModelName,
      provider,
    },
    {
      promptTokens: branchResult.usage.promptTokens ?? 0,
      completionTokens: branchResult.usage.completionTokens ?? 0,
      systemTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  );

  return branchResult.object.branchChoice ?? null;
}

export interface ConfirmStepInput {
  container: Container;
  session: Session;
  flow: Flow;
  nodes: FlowNode[];
  edges: FlowEdge[];
  messages: SessionMessage[];
  confirmedByUserId: string;
  isAdmin: boolean;
}

export interface ConfirmStepResult {
  advanced: boolean;
  // A forked step whose branch could not be resolved — the UI opens the manual
  // branch-override path instead of silently failing.
  needsManualBranch: boolean;
  newNodeId: string | null;
}

// Orchestrates an operator Proceed: recompute the branch for a fork, run the
// ConfirmStepAdvance use-case, then fire the shared advance side effects so the
// outcome matches auto-advance (ADR-026).
export async function confirmStep(input: ConfirmStepInput): Promise<Result<ConfirmStepResult>> {
  const { container, session, flow, nodes, edges, messages, confirmedByUserId, isAdmin } = input;

  const completedNode = nodes.find((node) => node.id === session.currentNodeId);
  if (!session.currentNodeId || !completedNode) {
    return ok({ advanced: false, needsManualBranch: false, newNodeId: null });
  }

  const branchChoice = await recomputeBranchChoice(container, session, nodes, edges, messages);

  const advanceResult = await container.useCases.confirmStepAdvance.execute({
    sessionId: session.id,
    nodeId: session.currentNodeId,
    branchChoice,
    confirmedByUserId,
  });
  if (advanceResult.error) return advanceResult;

  const { advanced, newNodeId, needsManualBranch } = advanceResult.data;
  if (!advanced) {
    return ok({ advanced, needsManualBranch, newNodeId });
  }

  const orgSettingResult = await container.repos.systemSettings.get("organisation_name");
  const organisationName = orgSettingResult.error ? null : (orgSettingResult.data?.value ?? null);

  const globalInstructionsResult = await container.repos.systemSettings.get("global_prompt");
  const globalInstructions = globalInstructionsResult.error
    ? null
    : (globalInstructionsResult.data?.value ?? null);

  const userResult = await container.repos.users.findById(confirmedByUserId);
  const userProfile =
    userResult.error || !userResult.data
      ? null
      : { name: userResult.data.name, role: userResult.data.role, team: userResult.data.team };

  const aiConfig = await container.runtimeConfig.getAiConfig();
  const provider = aiConfig.provider;
  const branchingModel = resolveModel(provider, aiConfig.models.branching, aiConfig.apiKeys[provider]);

  await applyAdvanceSideEffects({
    container,
    session: advanceResult.data.session,
    flow,
    nodes,
    completedNode,
    newNodeId,
    fallbackMessages: messages,
    gatheredContext: buildGatheredContext(messages),
    organisationName,
    userProfile,
    userId: confirmedByUserId,
    isAdmin,
    model: branchingModel,
    provider,
    globalInstructions,
  });

  return ok({ advanced, needsManualBranch, newNodeId });
}
