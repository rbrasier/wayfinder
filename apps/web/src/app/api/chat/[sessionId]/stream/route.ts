import { createDataStreamResponse, generateText, streamObject, streamText } from "ai";
import { resolveModel } from "@rbrasier/adapters";
import type { ConversationalNodeConfig } from "@rbrasier/domain";
import { turnSchema } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";

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

  const currentNode = nodes.find((n) => n.id === session.currentNodeId);
  if (!currentNode) return new Response("Current node not found", { status: 500 });

  const nodeConfig = currentNode.config as unknown as ConversationalNodeConfig;

  const systemPromptResult = container.services.sessionAgent.buildSystemPrompt({
    nodeConfig,
    contextDocs: flow.contextDocs,
    gatheredContext: "",
  });
  if (systemPromptResult.error) return new Response("Failed to build prompt", { status: 500 });

  const confSystemResult = container.services.sessionAgent.buildConfidenceSystemPrompt({ nodeConfig });
  if (confSystemResult.error) return new Response("Failed to build confidence prompt", { status: 500 });

  const outgoingEdges = edges.filter((e) => e.fromNodeId === session.currentNodeId);
  const branchNodeIds = outgoingEdges.map((e) => e.toNodeId);
  const branchNodeNames = nodes
    .filter((n) => branchNodeIds.includes(n.id))
    .map((n) => `${n.id} (${n.name})`);

  const branchHint = branchNodeNames.length > 1
    ? `\n\nAvailable branch targets for branchChoice: ${branchNodeNames.join(", ")}`
    : "";

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

  const textModel = resolveModel(provider, provider === "anthropic" ? "claude-sonnet-4-20250514" : undefined);
  const confModel = resolveModel(provider, provider === "anthropic" ? "claude-haiku-4-5-20251001" : undefined);

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const textStream = streamText({
        model: textModel,
        system: systemPromptResult.data,
        messages: messagesWithNew,
      });

      const confStream = streamObject({
        model: confModel,
        schema: turnSchema,
        system: confSystemResult.data + branchHint,
        messages: messagesWithNew,
      });

      textStream.mergeIntoDataStream(dataStream);

      const [fullText, turn] = await Promise.all([
        textStream.text,
        confStream.object,
      ]);

      dataStream.writeMessageAnnotation({
        type: "confidence",
        score: turn.confidence.score,
        readyToAdvance: turn.confidence.readyToAdvance,
        missingInformation: turn.confidence.missingInformation,
      });

      await container.useCases.runTurn.execute({
        session,
        flowId: flow.id,
        userMessage: lastUserMessage,
        assistantMessage: fullText,
        confidence: turn.confidence,
        branchChoice: turn.branchChoice,
        advanceThreshold: (nodeConfig.advanceConfidenceThreshold ?? 90),
      });

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
