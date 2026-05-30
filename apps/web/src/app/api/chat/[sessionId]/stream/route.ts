import { createDataStreamResponse, generateObject } from "ai";
import { recordTokenUsage, resolveModel } from "@rbrasier/adapters";
import type { AiTurnPayload, ConversationalNodeConfig } from "@rbrasier/domain";
import { branchChoiceSchema, turnResponseSchema } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";
import { streamTurn } from "./stream-turn";
import {
  buildGatheredContext,
  generateDocument,
  generateInitialMessage,
  generateTitle,
} from "./turn-helpers";

const getSessionToken = (req: Request): string | null => {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("better-auth.session_token="));
  return pair ? pair.slice("better-auth.session_token=".length) : null;
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
          cacheReadTokens: streamResult.usage.cacheReadTokens,
          cacheWriteTokens: streamResult.usage.cacheWriteTokens,
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
            (m) => m.role === "assistant" && m.stepNodeId === currentNode.id,
          );
          if (
            milestone &&
            nodeConfig.outputType === "generate_document" &&
            nodeConfig.documentTemplatePath
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
              currentNode,
            );
          }
        }

        if (runResult.data.newNodeId) {
          const newNode = nodes.find((n) => n.id === runResult.data.newNodeId);
          if (newNode) {
            const refreshed = await container.repos.sessionMessages.listBySession(session.id);
            const nextStepContext = refreshed.error
              ? gatheredContext
              : buildGatheredContext(refreshed.data);
            await generateInitialMessage({
              container,
              sessionId: session.id,
              newNodeId: runResult.data.newNodeId,
              newNode,
              flow,
              model: branchingModel,
              organisationName,
              userId: authSession.userId,
              provider,
              gatheredContext: nextStepContext,
            });
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
