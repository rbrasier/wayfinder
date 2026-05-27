import { generateObject, generateText, type LanguageModel } from "ai";
import { recordTokenUsage, resolveModel } from "@rbrasier/adapters";
import type {
  AiTurnPayload,
  ConversationalNodeConfig,
  Flow,
  FlowNode,
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
): Promise<void> {
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
        return;
      }
      await container.services.errorLogger.log({
        level: "error",
        message: `Document generation failed: ${result.error.message}`,
        stack: result.error.cause instanceof Error ? result.error.cause.stack ?? null : null,
        page: `api/chat/${sessionId}/stream`,
        metadata: { sessionId, messageId, nodeId: node.id, errorCode: result.error.code },
      });
    }
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
  }
}

export async function generateTitle(
  container: Container,
  sessionId: string,
  firstUserMessage: string,
  provider: Parameters<typeof resolveModel>[0],
  modelName: string,
  apiKey: string | null,
  userId: string,
): Promise<void> {
  try {
    const cheapModel = resolveModel(provider, modelName, apiKey);
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

export interface GenerateInitialMessageInput {
  container: Container;
  sessionId: string;
  newNodeId: string;
  newNode: FlowNode;
  flow: Flow;
  model: LanguageModel;
  organisationName: string | null;
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
    userId,
    provider,
    gatheredContext,
  } = input;
  try {
    const newNodeConfig = newNode.config as unknown as ConversationalNodeConfig;

    const systemPromptResult = container.services.sessionAgent.buildSystemPrompt({
      nodeConfig: newNodeConfig,
      contextDocs: flow.contextDocs,
      gatheredContext,
      workflowName: flow.name,
      organisationName,
      expertRole: flow.expertRole,
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
