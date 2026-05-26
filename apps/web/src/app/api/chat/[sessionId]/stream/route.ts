import { createDataStreamResponse, generateObject, generateText, type LanguageModel } from "ai";
import { recordTokenUsage, resolveModel } from "@rbrasier/adapters";
import type { AiTurnPayload, ConversationalNodeConfig, Flow, FlowNode, SessionMessage } from "@rbrasier/domain";
import { branchChoiceSchema, turnResponseSchema } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";
import { streamTurn } from "./stream-turn";

const getSessionToken = (req: Request): string | null => {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("better-auth.session_token="));
  return pair ? pair.slice("better-auth.session_token=".length) : null;
};

const buildGatheredContext = (messages: SessionMessage[]): string => {
  const items = messages
    .filter((m) => m.role === "assistant" && m.stepNodeId !== null && m.aiPayload)
    .flatMap((m) => m.aiPayload!.contextGathered);
  if (items.length === 0) return "";
  return items.map((item) => `- ${item.key}: ${item.value}`).join("\n");
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const container = getContainer();

  const token = getSessionToken(req);
  if (!token) return new Response("Unauthorized", { status: 401 });

  const authSession = await container.resolveSession(token);
  if (!authSession) return new Response("Unauthorized", { status: 401 });

  const body = await req.json() as { messages?: { role: string; content: string }[] };
  const incomingMessages = body.messages ?? [];
  const lastUserMessage = incomingMessages.filter((m) => m.role === "user").at(-1)?.content ?? "";

  if (!lastUserMessage.trim()) {
    return new Response("Message required", { status: 400 });
  }

  const sessionResult = await container.useCases.getSession.execute(sessionId);
  if (sessionResult.error) return new Response("Server error", { status: 500 });
  if (!sessionResult.data) return new Response("Session not found", { status: 404 });

  const { session, flow, nodes, edges, messages: dbMessages } = sessionResult.data;

  if (session.userId !== authSession.userId) {
    return new Response("Forbidden", { status: 403 });
  }

  if (session.status !== "active") {
    return new Response("Session is not active", { status: 400 });
  }

  if (flow.deletedAt !== null) {
    return new Response("This flow has been deleted", { status: 410 });
  }

  const currentNode = nodes.find((n) => n.id === session.currentNodeId);
  if (!currentNode) return new Response("Current node not found", { status: 500 });

  const nodeConfig = currentNode.config as unknown as ConversationalNodeConfig & { neverDone?: boolean };
  const isNeverDone = Boolean(nodeConfig.neverDone);

  const orgSettingResult = await container.repos.systemSettings.get("organisation_name");
  const organisationName = orgSettingResult.error ? null : (orgSettingResult.data?.value ?? null);

  const gatheredContext = buildGatheredContext(dbMessages);

  const systemPromptResult = container.services.sessionAgent.buildSystemPrompt({
    nodeConfig,
    contextDocs: flow.contextDocs,
    gatheredContext,
    workflowName: flow.name,
    organisationName,
    expertRole: flow.expertRole,
  });
  if (systemPromptResult.error) return new Response("Failed to build prompt", { status: 500 });

  const outgoingEdges = edges.filter((e) => e.fromNodeId === session.currentNodeId);
  const branchNodeIds = outgoingEdges.map((e) => e.toNodeId);
  const branchNodes = nodes
    .filter((n) => branchNodeIds.includes(n.id))
    .map((n) => ({ id: n.id, name: n.name }));

  const coreMessages = dbMessages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  const messagesWithNew = [
    ...coreMessages,
    { role: "user" as const, content: lastUserMessage },
  ];

  const aiConfig = await container.runtimeConfig.getAiConfig();
  const provider = aiConfig.provider;
  const apiKey = aiConfig.apiKeys[provider];
  const chatModelName = aiConfig.models.chat;
  const branchingModelName = aiConfig.models.branching;
  const chatModel = resolveModel(provider, chatModelName, apiKey);
  const branchingModel = resolveModel(provider, branchingModelName, apiKey);

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const userMsgResult = await container.useCases.runTurn.persistUserMessage({
        session,
        userMessage: lastUserMessage,
      });
      if (userMsgResult.error) {
        const cause = userMsgResult.error.cause;
        throw cause instanceof Error ? cause : new Error(userMsgResult.error.message);
      }

      const streamResult = await streamTurn({
        model: chatModel,
        schema: turnResponseSchema,
        system: systemPromptResult.data,
        messages: messagesWithNew,
        writer: dataStream,
      });
      const turnResult = streamResult.object;

      recordTokenUsage(
        container.repos.usageRepo,
        {
          purpose: "chat-turn",
          userId: authSession.userId,
          conversationId: sessionId,
          model: chatModelName,
          provider,
        },
        {
          promptTokens: streamResult.usage.promptTokens,
          completionTokens: streamResult.usage.completionTokens,
          systemTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      );

      const aiPayload: AiTurnPayload = {
        response: turnResult.response,
        rationale: turnResult.rationale,
        stepCompleteConfidence: turnResult.stepCompleteConfidence,
        contextGathered: turnResult.contextGathered,
      };

      dataStream.writeMessageAnnotation({
        type: "confidence",
        score: aiPayload.stepCompleteConfidence,
      });

      let branchChoice: string | null = null;
      if (!isNeverDone && aiPayload.stepCompleteConfidence >= 90 && branchNodes.length > 1) {
        const branchPromptResult = container.services.sessionAgent.buildBranchChoicePrompt({ branchNodes });
        if (!branchPromptResult.error) {
          const branchResult = await generateObject({
            model: branchingModel,
            schema: branchChoiceSchema,
            system: branchPromptResult.data,
            messages: messagesWithNew,
          }).catch(() => null);
          if (branchResult) {
            recordTokenUsage(
              container.repos.usageRepo,
              {
                purpose: "chat-branch-choice",
                userId: authSession.userId,
                conversationId: sessionId,
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
          }
          branchChoice = branchResult?.object.branchChoice ?? null;
        }
      }

      const runResult = await container.useCases.runTurn.persistAssistantTurn({
        session,
        flowId: flow.id,
        assistantMessage: aiPayload.response,
        aiPayload,
        branchChoice,
        advanceThreshold: isNeverDone ? Number.POSITIVE_INFINITY : (nodeConfig.advanceConfidenceThreshold ?? 90),
      });

      if (runResult.error) {
        const cause = runResult.error.cause;
        throw cause instanceof Error ? cause : new Error(runResult.error.message);
      }

      if (runResult.data.advanced) {
        const assistantMessages = await container.repos.sessionMessages.listBySession(session.id);
        if (!assistantMessages.error) {
          const milestone = [...assistantMessages.data].reverse().find(
            (m) => m.role === "assistant" && m.stepNodeId === session.currentNodeId,
          );
          if (
            milestone &&
            nodeConfig.outputType === "generate_document" &&
            nodeConfig.documentTemplatePath
          ) {
            void generateDocument(container, milestone.id, session.id, flow, nodes, assistantMessages.data, currentNode);
          }
        }

        if (runResult.data.newNodeId) {
          const newNode = nodes.find((n) => n.id === runResult.data.newNodeId);
          if (newNode) {
            await generateInitialMessage(
              container,
              session.id,
              runResult.data.newNodeId,
              newNode,
              flow,
              branchingModel,
              organisationName,
              authSession.userId,
              provider,
            );
          }
        }
      }

      if (dbMessages.filter((m) => m.role === "user").length === 0) {
        void generateTitle(container, session.id, lastUserMessage, provider, chatModelName, apiKey, authSession.userId);
      }
    },
    onError: (error) => {
      container.services.errorLogger.log({
        level: "error",
        message: "Streaming turn failed",
        stack: error instanceof Error ? error.stack ?? null : null,
        page: `api/chat/${sessionId}/stream`,
        metadata: { sessionId },
      });
      return "An error occurred during the AI response. Please try again.";
    },
  });
}

async function generateDocument(
  container: ReturnType<typeof getContainer>,
  messageId: string,
  sessionId: string,
  flow: Flow,
  nodes: FlowNode[],
  messages: SessionMessage[],
  node: FlowNode,
): Promise<void> {
  try {
    await container.useCases.generateDocument.execute({
      messageId,
      sessionId,
      messages,
      flow,
      node,
    });
  } catch (cause) {
    await container.services.errorLogger.log({
      level: "error",
      message: "Document generation failed",
      stack: cause instanceof Error ? cause.stack ?? null : null,
      page: `api/chat/${sessionId}/stream`,
      metadata: { sessionId, messageId, nodeId: node.id },
    });
  }
}

async function generateTitle(
  container: ReturnType<typeof getContainer>,
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

async function generateInitialMessage(
  container: ReturnType<typeof getContainer>,
  sessionId: string,
  newNodeId: string,
  newNode: FlowNode,
  flow: Flow,
  model: LanguageModel,
  organisationName: string | null,
  userId: string,
  provider: string,
): Promise<void> {
  try {
    const newNodeConfig = newNode.config as unknown as ConversationalNodeConfig;

    const systemPromptResult = container.services.sessionAgent.buildSystemPrompt({
      nodeConfig: newNodeConfig,
      contextDocs: flow.contextDocs,
      gatheredContext: "",
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
