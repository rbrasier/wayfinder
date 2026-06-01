import { generateObject, generateText, type LanguageModel } from "ai";
import { recordTokenUsage, resolveModel, type ProviderCredentials } from "@rbrasier/adapters";
import type {
  AiTurnPayload,
  ConversationalNodeConfig,
  Flow,
  FlowNode,
  PromptUserProfile,
  Session,
  SessionMessage,
} from "@rbrasier/domain";
import { turnResponseSchema } from "@rbrasier/shared";
import type { getContainer } from "@/lib/container";

type Container = ReturnType<typeof getContainer>;

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
    const result = await container.useCases.generateDocument.execute({
      messageId,
      sessionId,
      messages,
      flow,
      node,
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

// True only when the auto_node feature flag exists and is enabled. Admins toggle
// it on to use and test auto nodes before the feature is fully released.
export async function isAutoNodeEnabled(container: Container): Promise<boolean> {
  const flag = await container.useCases.getFeatureFlag.execute("auto_node");
  return !flag.error && flag.data?.enabled === true;
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

    const content = result.error
      ? `This automated step (${node.name}) could not be started: ${result.error.message}`
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

    const systemPromptResult = container.services.sessionAgent.buildSystemPrompt({
      nodeConfig: newNodeConfig,
      retrievedChunks,
      gatheredContext,
      workflowName: flow.name,
      organisationName,
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
