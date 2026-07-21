import { createDataStreamResponse } from "ai";
import {
  normaliseAdvanceConfidenceThreshold,
  type ConversationalNodeConfig,
  type SessionEvent,
} from "@rbrasier/domain";
import { streamTurnRequestSchema } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";
import { tooManyRequestsResponse } from "@/lib/rate-limit";
import { getSessionTokenFromRequest } from "@/lib/session-token";
import { executeTurn } from "./execute-turn";
import { DataStreamTurnWriter } from "./turn-stream-writer";
import {
  buildAttachmentAnnotation,
  buildPromptSessionUploads,
  renderGatheredContext,
} from "./turn-helpers";
import { runMcpToolPrepass } from "./mcp-turn-helpers";

// The most recent turns the model is given as context, mirrored from the
// client's own slice so the two agree (scaling wall #1).
const CONTEXT_WINDOW_MESSAGES = 20;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const container = getContainer();

  // Fire-and-forget real-time notifications (scaling wall #2). A NOTIFY failure
  // must never fail the turn — the slow-poll fallback still catches every change.
  const publishEvent = (event: SessionEvent) => {
    void container.services.sessionEvents.publish(sessionId, event);
  };

  const token = getSessionTokenFromRequest(req);
  if (!token) return new Response("Unauthorized", { status: 401 });

  const authSession = await container.resolveSession(token);
  if (!authSession) return new Response("Unauthorized", { status: 401 });

  // Throttle turns per user so one account cannot stampede the model or the DB
  // (scaling wall #5 at the edge). Fail open if the limiter itself errors.
  const rateDecision = await container.services.chatRateLimiter.consume(`chat:${authSession.userId}`);
  if (!rateDecision.error && !rateDecision.data.allowed) {
    return tooManyRequestsResponse(rateDecision.data.retryAfterMs);
  }

  // Validate the request body instead of trusting a bare cast (a malformed body
  // otherwise threw deep in the turn). Bad JSON or a bad shape is a clean 400.
  const parsedBody = streamTurnRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return new Response("Invalid request body", { status: 400 });
  const incomingMessages = parsedBody.data.messages ?? [];
  const lastUserMessage = incomingMessages.filter((m) => m.role === "user").at(-1)?.content ?? "";

  if (!lastUserMessage.trim()) {
    return new Response("Message required", { status: 400 });
  }

  // Bounded turn read (scaling wall #1): the tail the prompt uses, plus a
  // SQL-side aggregation of gathered context over the whole history. Replaces
  // the previous `getSession` full-transcript load per turn.
  const sessionResult = await container.useCases.getSessionForTurn.execute(sessionId, {
    messagesTailN: CONTEXT_WINDOW_MESSAGES,
  });
  if (sessionResult.error) return new Response("Server error", { status: 500 });
  if (!sessionResult.data) return new Response("Session not found", { status: 404 });

  const {
    session,
    flow,
    nodes,
    edges,
    messagesTail: dbMessages,
    gatheredContext: gatheredContextItems,
    currentNodeAssistantMessages,
  } = sessionResult.data;

  if (session.status !== "active") {
    return new Response("Session is not active", { status: 400 });
  }

  if (flow.deletedAt !== null) {
    return new Response("This flow has been deleted", { status: 410 });
  }

  // Authorise against the participants table, not knowledge of the URL (scaling
  // wall #11). Opening the link auto-enrols the caller as a collaborator when the
  // flow is visible to them; a viewer (or a revoked collaborator downgraded to
  // viewer) may read but not send, and a non-visible flow is 403.
  const accessResult = await container.useCases.resolveSessionAccess.execute({
    session,
    flow,
    userId: authSession.userId,
    isAdmin: authSession.isAdmin,
    isApprover: false,
    allowAutoEnrol: true,
  });
  if (accessResult.error || !accessResult.data.canSend) {
    return new Response("You do not have permission to send in this session", { status: 403 });
  }

  const currentNode = nodes.find((n) => n.id === session.currentNodeId);
  if (!currentNode) return new Response("Current node not found", { status: 500 });

  // Server-side turn lease (scaling wall #3): claim the single active turn before
  // any write. A second concurrent send finds the lease held and gets 409 with
  // the holder's name, instead of both turns running (double message, double
  // spend, double advance). A crashed turn's lease is taken over after the window.
  const turnId = crypto.randomUUID();
  const claimResult = await container.useCases.turnLease.claim({
    sessionId: session.id,
    turnId,
    userId: authSession.userId,
    leaseSeconds: container.env.TURN_LEASE_SECONDS,
  });
  if (claimResult.error) return new Response("Server error", { status: 500 });
  if (!claimResult.data.claimed) {
    const holderName = claimResult.data.heldByName;
    const message = holderName
      ? `${holderName}'s turn is in progress. Please wait for it to finish.`
      : "A turn is already in progress on this session. Please wait for it to finish.";
    return new Response(message, { status: 409 });
  }

  const nodeConfig = currentNode.config as unknown as ConversationalNodeConfig & { neverDone?: boolean };
  const isNeverDone = Boolean(nodeConfig.neverDone);
  // A never-completing step has nothing to confirm; confirmation only applies to
  // a step that can actually reach its threshold.
  const requireConfirmation = Boolean(nodeConfig.requireConfirmation) && !isNeverDone;
  // Normalise on read: flow-authored data may store this as a fraction (0.7)
  // rather than a 0-100 percentage, which would otherwise auto-advance every turn.
  const realThreshold = normaliseAdvanceConfidenceThreshold(nodeConfig.advanceConfidenceThreshold);

  const gatheredContext = renderGatheredContext(gatheredContextItems);

  // These reads are mutually independent, so run them as one round-trip instead
  // of six serial awaits while a pool connection is held (scaling wall #4). The
  // near-static admin settings come from a short-TTL cache rather than the DB.
  const [adminSettings, uploadsResult, userResult, retrievalResult] = await Promise.all([
    container.adminSettings.get(),
    // Inject the user's own attachments into the turn independent of RAG: a thin
    // message ("here is the solution") retrieves nothing, so without this the
    // agent never sees the file it was just given.
    container.repos.sessionUploads.listBySession(sessionId),
    container.repos.users.findById(authSession.userId),
    container.useCases.retrieveDocumentChunks.execute({
      flowId: flow.id,
      sessionId,
      query: lastUserMessage,
    }),
  ]);

  // With organisations enabled, a member's prompt is grounded in their own
  // organisation; otherwise the single global organisation name is used (ADR-038).
  let organisationName = adminSettings.organisationName;
  if (adminSettings.organisationsEnabled && !userResult.error && userResult.data?.organisationId) {
    const memberOrg = await container.repos.organisations.findById(userResult.data.organisationId);
    if (!memberOrg.error && memberOrg.data) organisationName = memberOrg.data.name;
  }
  const globalInstructions = adminSettings.globalInstructions;
  const sessionUploads = uploadsResult.error
    ? []
    : buildPromptSessionUploads(uploadsResult.data, adminSettings.uploadConfig.totalBudgetChars);
  const userProfile =
    userResult.error || !userResult.data
      ? null
      : { name: userResult.data.name, role: userResult.data.role, team: userResult.data.team };
  const retrievedChunks = retrievalResult.error ? [] : retrievalResult.data;

  const skillsResult = await container.useCases.resolveStepSkills.execute(nodeConfig);
  const resolvedSkills = skillsResult.error ? [] : skillsResult.data;

  // Conversational tool-loop (ADR-032): when a step allows MCP tools, let the model
  // call them in a non-streaming pre-pass and fold the gathered results into the
  // step context, leaving the structured streaming turn below untouched.
  const gatheredContextWithTools = await runMcpToolPrepass({
    container,
    nodeConfig,
    dbMessages,
    lastUserMessage,
    gatheredContext,
    userId: authSession.userId,
    isAdmin: authSession.isAdmin,
    flowId: flow.id,
    sessionId,
    nodeId: session.currentNodeId,
  });

  // The lease is claimed; tell every open window whose turn it now is so they
  // disable Send and can attribute the hold ("Alex's turn is in progress").
  publishEvent({ type: "turn.claimed", userId: authSession.userId, userName: userProfile?.name ?? null });

  const systemPromptResult = container.services.sessionAgent.buildSystemPrompt({
    nodeConfig,
    retrievedChunks,
    sessionUploads,
    gatheredContext: gatheredContextWithTools,
    workflowName: flow.name,
    organisationName,
    globalInstructions,
    expertRole: flow.expertRole,
    userProfile,
    now: new Date(),
    resolvedSkills,
  });
  if (systemPromptResult.error) return new Response("Failed to build prompt", { status: 500 });

  const outgoingEdges = edges.filter((e) => e.fromNodeId === session.currentNodeId);
  const branchNodeIds = outgoingEdges.map((e) => e.toNodeId);
  const branchNodes = nodes
    .filter((node) => branchNodeIds.includes(node.id))
    .map((node) => {
      const config = node.config as { doneWhen?: string; aiInstruction?: string; instruction?: string };
      // doneWhen may hold a sentinel meaning "template complete" — that string is not
      // meaningful guidance for choosing a branch, so fall back to the instruction.
      const doneWhenPurpose =
        config.doneWhen && config.doneWhen !== "__TEMPLATE_COMPLETE__" ? config.doneWhen : undefined;
      const purpose = doneWhenPurpose ?? config.aiInstruction ?? config.instruction;
      return { id: node.id, name: node.name, purpose };
    });

  // Server-side context window: the model sees only the most recent turns, the
  // same 20 the client already slices to (scaling wall #1). `dbMessages` is
  // already the bounded tail (see GetSessionForTurn), so no further slicing.
  const coreMessages = dbMessages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  // The model sees the attachment marker; the persisted user message stays the
  // raw text the user typed (persistUserMessage uses lastUserMessage).
  const annotatedUserMessage = `${lastUserMessage}${buildAttachmentAnnotation(sessionUploads)}`;
  const messagesWithNew = [
    ...coreMessages,
    { role: "user" as const, content: annotatedUserMessage },
  ];

  const aiConfig = await container.runtimeConfig.getAiConfig();
  const chatModelName = aiConfig.models.chat;
  const branchingModelName = aiConfig.models.branching;

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // Everything downstream writes through the framework-free TurnStreamWriter
      // port; this adapter is the one place that maps those semantic calls onto
      // the Vercel data-stream wire format.
      const writer = new DataStreamTurnWriter(dataStream);
      // A doc-gen-heavy turn can outlive the lease window, so re-stamp it while
      // the stream is open; the release in `finally` frees it the instant the
      // turn ends (success or failure) rather than waiting for expiry.
      const heartbeat = setInterval(() => {
        void container.useCases.turnLease.heartbeat(session.id, turnId);
      }, container.env.TURN_HEARTBEAT_MS);
      try {
        await executeTurn({
          container,
          writer,
          publishEvent,
          session,
          flow,
          nodes,
          currentNode,
          nodeConfig,
          dbMessages,
          currentNodeAssistantMessages,
          messagesWithNew,
          systemPrompt: systemPromptResult.data,
          gatheredContext,
          branchNodes,
          isNeverDone,
          requireConfirmation,
          realThreshold,
          organisationName,
          globalInstructions,
          userProfile,
          chatModelName,
          branchingModelName,
          userId: authSession.userId,
          isAdmin: authSession.isAdmin,
          lastUserMessage,
        });
      } finally {
        clearInterval(heartbeat);
        // Announce the final state so every watching window reconciles: publish
        // the latest message seq (advances their Last-Event-ID) and a state sync,
        // then release the lease and signal Send can re-enable.
        const latest = await container.repos.sessionMessages.latestBySession(session.id, 1);
        const latestSeq = latest.error ? undefined : latest.data.at(-1)?.seq;
        if (typeof latestSeq === "number") {
          publishEvent({ type: "message.created", seq: latestSeq });
        }
        publishEvent({ type: "session.updated" });
        // Release in the same lifecycle that persisted the turn (or on the error
        // path); guarded on turnId so a stale release never clears a newer claim.
        await container.useCases.turnLease.release(session.id, turnId);
        publishEvent({ type: "turn.released" });
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
