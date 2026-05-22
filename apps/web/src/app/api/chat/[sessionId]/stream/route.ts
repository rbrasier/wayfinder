import { createDataStreamResponse, generateObject, generateText, streamObject } from "ai";
import { resolveModel } from "@rbrasier/adapters";
import type { AiTurnPayload, ConversationalNodeConfig, Flow, FlowNode, SessionMessage } from "@rbrasier/domain";
import { branchChoiceSchema, turnResponseSchema } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";

const getSessionToken = (req: Request): string | null => {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("better-auth.session_token="));
  return pair ? pair.slice("better-auth.session_token=".length) : null;
};

const buildGatheredContext = (
  messages: SessionMessage[],
  stepNodeId: string | null,
): string => {
  if (!stepNodeId) return "";
  const items = messages
    .filter((m) => m.role === "assistant" && m.stepNodeId === stepNodeId && m.aiPayload)
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

  const currentNode = nodes.find((n) => n.id === session.currentNodeId);
  if (!currentNode) return new Response("Current node not found", { status: 500 });

  const nodeConfig = currentNode.config as unknown as ConversationalNodeConfig;

  const orgSettingResult = await container.repos.systemSettings.get("organisation_name");
  const organisationName = orgSettingResult.error ? null : (orgSettingResult.data?.value ?? null);

  const gatheredContext = buildGatheredContext(dbMessages, session.currentNodeId);

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

  const env = container.env;
  const provider = env.AI_DEFAULT_PROVIDER;
  const haikuModel = resolveModel(provider, provider === "anthropic" ? "claude-haiku-4-5-20251001" : undefined);

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const turnStream = streamObject({
        model: haikuModel,
        schema: turnResponseSchema,
        system: systemPromptResult.data,
        messages: messagesWithNew,
      });

      let previousResponseLength = 0;
      for await (const partial of turnStream.partialObjectStream) {
        const currentResponse = partial.response ?? "";
        if (currentResponse.length > previousResponseLength) {
          const newChars = currentResponse.slice(previousResponseLength);
          dataStream.write(`0:${JSON.stringify(newChars)}\n`);
          previousResponseLength = currentResponse.length;
        }
      }

      const turnResult = await turnStream.object;
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
      if (aiPayload.stepCompleteConfidence >= 90 && branchNodes.length > 1) {
        const branchPromptResult = container.services.sessionAgent.buildBranchChoicePrompt({ branchNodes });
        if (!branchPromptResult.error) {
          const branchResult = await generateObject({
            model: haikuModel,
            schema: branchChoiceSchema,
            system: branchPromptResult.data,
            messages: messagesWithNew,
          }).catch(() => null);
          branchChoice = branchResult?.object.branchChoice ?? null;
        }
      }

      const runResult = await container.useCases.runTurn.execute({
        session,
        flowId: flow.id,
        userMessage: lastUserMessage,
        assistantMessage: aiPayload.response,
        aiPayload,
        branchChoice,
        advanceThreshold: nodeConfig.advanceConfidenceThreshold ?? 90,
      });

      if (!runResult.error && runResult.data.advanced) {
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
      }

      if (dbMessages.filter((m) => m.role === "user").length === 0) {
        void generateTitle(container, session.id, lastUserMessage, provider);
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
  provider: string,
): Promise<void> {
  try {
    const cheapModel = resolveModel(
      provider as Parameters<typeof resolveModel>[0],
      provider === "anthropic" ? "claude-haiku-4-5-20251001" : undefined,
    );
    const result = await generateText({
      model: cheapModel,
      system: "Generate a concise title (max 80 characters) for a workflow session based on the user's first message. Return only the title, no quotes or punctuation.",
      prompt: firstUserMessage,
      maxTokens: 30,
    });
    const title = result.text.trim().slice(0, 80);
    if (title) {
      await container.repos.sessions.update(sessionId, { title });
    }
  } catch {
    const fallback = firstUserMessage.slice(0, 80);
    await container.repos.sessions.update(sessionId, { title: fallback }).catch(() => undefined);
  }
}
