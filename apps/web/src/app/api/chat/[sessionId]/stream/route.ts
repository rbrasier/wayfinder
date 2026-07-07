import { createDataStreamResponse, formatDataStreamPart, generateObject } from "ai";
import { recordTokenUsage, resolveModel } from "@rbrasier/adapters";
import type { EvaluateStepReadinessOutput } from "@rbrasier/application";
import {
  normaliseAdvanceConfidenceThreshold,
  type AiTurnPayload,
  type ConversationalNodeConfig,
  type ResolvedDocumentGenerationBudget,
  type SessionEvent,
} from "@rbrasier/domain";
import { branchChoiceSchema, turnResponseSchema } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";
import { shouldComputeBranchChoice } from "./branch-gate";
import { countGateHoldsOnNode } from "./gate-holds";
import { shouldEvaluateStepReadiness } from "./readiness-gate";
import { streamTurn } from "./stream-turn";
import {
  appendShortcomingsToContext,
  applyAdvanceSideEffects,
  buildAttachmentAnnotation,
  buildGatheredContext,
  buildPromptSessionUploads,
  generateTitle,
  persistCrossCheckPassNote,
  persistHeldReply,
  streamGapFollowup,
  writeCrossCheckPassNote,
} from "./turn-helpers";

// The most recent turns the model is given as context, mirrored from the
// client's own slice so the two agree (scaling wall #1).
const CONTEXT_WINDOW_MESSAGES = 20;

// How many times the pre-generation gate may hold a single node before it
// becomes advisory and the step advances on the cheap model's threshold. Bounds
// the gate so a flaky grader cannot livelock a step (surface gaps once, then
// let the operator's correction through).
const MAX_GATE_HOLDS = 1;

// The label shown for a context document in the cross-checking badge: the
// filename without its extension (FlowContextDoc has no separate title field).
const documentLabel = (filename: string): string => filename.replace(/\.[^/.]+$/, "");

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

  // Fire-and-forget real-time notifications (scaling wall #2). A NOTIFY failure
  // must never fail the turn — the slow-poll fallback still catches every change.
  const publishEvent = (event: SessionEvent) => {
    void container.services.sessionEvents.publish(sessionId, event);
  };

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
  const claimResult = await container.repos.sessions.claimTurn(
    session.id,
    turnId,
    authSession.userId,
    container.env.TURN_LEASE_SECONDS,
  );
  if (claimResult.error) return new Response("Server error", { status: 500 });
  if (!claimResult.data.claimed) {
    const holderId = claimResult.data.heldBy;
    const holderResult = holderId ? await container.repos.users.findById(holderId) : null;
    const holderName =
      holderResult && !holderResult.error && holderResult.data ? holderResult.data.name : null;
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

  const gatheredContext = buildGatheredContext(dbMessages);

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

  const organisationName = adminSettings.organisationName;
  const globalInstructions = adminSettings.globalInstructions;
  const sessionUploads = uploadsResult.error
    ? []
    : buildPromptSessionUploads(uploadsResult.data, adminSettings.uploadConfig.totalBudgetChars);
  const userProfile =
    userResult.error || !userResult.data
      ? null
      : { name: userResult.data.name, role: userResult.data.role, team: userResult.data.team };
  const retrievedChunks = retrievalResult.error ? [] : retrievalResult.data;

  // The lease is claimed; tell every open window whose turn it now is so they
  // disable Send and can attribute the hold ("Alex's turn is in progress").
  publishEvent({ type: "turn.claimed", userId: authSession.userId, userName: userProfile?.name ?? null });

  const systemPromptResult = container.services.sessionAgent.buildSystemPrompt({
    nodeConfig,
    retrievedChunks,
    sessionUploads,
    gatheredContext,
    workflowName: flow.name,
    organisationName,
    globalInstructions,
    expertRole: flow.expertRole,
    userProfile,
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
  // same 20 the client already slices to (scaling wall #1). Bounding it here (not
  // trusting a client-supplied transcript) keeps prompt size and read cost flat
  // as a session's history grows unbounded.
  const coreMessages = dbMessages
    .slice(-CONTEXT_WINDOW_MESSAGES)
    .map((m) => ({
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
  const provider = aiConfig.provider;
  const apiKey = aiConfig.apiKeys[provider];
  const chatModelName = aiConfig.models.chat;
  const branchingModelName = aiConfig.models.branching;
  const chatModel = resolveModel(provider, chatModelName, apiKey);
  const branchingModel = resolveModel(provider, branchingModelName, apiKey);

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // A doc-gen-heavy turn can outlive the lease window, so re-stamp it while
      // the stream is open; the release in `finally` frees it the instant the
      // turn ends (success or failure) rather than waiting for expiry.
      const heartbeat = setInterval(() => {
        void container.repos.sessions.heartbeatTurn(session.id, turnId);
      }, container.env.TURN_HEARTBEAT_MS);
      try {
      const userMsgResult = await container.useCases.runTurn.persistUserMessage({
        session,
        userMessage: lastUserMessage,
        senderUserId: authSession.userId,
      });
      if (userMsgResult.error) {
        const cause = userMsgResult.error.cause;
        throw cause instanceof Error ? cause : new Error(userMsgResult.error.message);
      }

      // Surface the human's message to collaborators immediately, before the AI
      // reply finishes streaming.
      if (typeof userMsgResult.data.seq === "number") {
        publishEvent({ type: "message.created", seq: userMsgResult.data.seq });
      }

      // Enforce the acting user's spend caps before the model runs (ADR-026 §6).
      // The chat path calls the SDK directly, outside the ILanguageModel port, so
      // it shares the container's enforcer. A blocked user gets a system message
      // and the session stays active — raising/disabling the cap resumes it.
      const quotaCheck = await container.services.quotaEnforcer.check(authSession.userId);
      if (quotaCheck.error) {
        dataStream.write(formatDataStreamPart("text", quotaCheck.error.message));
        await container.repos.sessionMessages.create({
          sessionId: session.id,
          role: "system",
          content: quotaCheck.error.message,
          stepNodeId: session.currentNodeId,
        });
        return;
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
          flowId: flow.id,
          sessionId,
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

      // Branch choice only matters on an actual advance, so it is computed
      // lazily — after the pre-generation gate decides the step is ready. When
      // the step requires confirmation it does not advance now, so the branch is
      // recomputed at Proceed time (ADR-026) — skip the call here.
      const computeBranchChoice = async (): Promise<string | null> => {
        // Gate on the node's configured threshold, not a hardcoded 90: a fork
        // node with a lower threshold would otherwise report "complete" yet never
        // resolve a branch, stalling the session on every turn.
        const gate = shouldComputeBranchChoice({
          isNeverDone,
          requireConfirmation,
          stepCompleteConfidence: aiPayload.stepCompleteConfidence,
          advanceThreshold: realThreshold,
          branchCount: branchNodes.length,
        });
        if (!gate) {
          return null;
        }
        const branchPromptResult = container.services.sessionAgent.buildBranchChoicePrompt({ branchNodes });
        if (branchPromptResult.error) return null;
        const branchResult = await container.services.llmGovernor
          .run(() =>
            generateObject({
              model: branchingModel,
              schema: branchChoiceSchema,
              system: branchPromptResult.data,
              messages: messagesWithNew,
            }),
          )
          .catch(() => null);
        if (branchResult) {
          recordTokenUsage(
            container.repos.usageRepo,
            {
              purpose: "chat-branch-choice",
              userId: authSession.userId,
              conversationId: sessionId,
              flowId: flow.id,
              sessionId,
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
        return branchResult?.object.branchChoice ?? null;
      };

      // Pre-generation evaluation gate: when the cheap model crosses the
      // threshold on a generate_document step, the doc-gen model confirms the
      // would-be document is ready *before* the session advances. The gate fails
      // open — a thrown or errored eval advances exactly as today. It is skipped
      // for flows with no context docs, which have no guidance for the larger
      // model to grade against.
      const shouldEvaluateReadiness = shouldEvaluateStepReadiness({
        isNeverDone,
        requireConfirmation,
        outputType: nodeConfig.outputType,
        hasTemplate: Boolean(nodeConfig.documentTemplatePath),
        hasContextDocs: flow.contextDocs.length > 0,
        stepCompleteConfidence: aiPayload.stepCompleteConfidence,
        advanceThreshold: realThreshold,
        // Bound the gate: once it has already surfaced this node's gaps, a later
        // threshold turn advances rather than looping on a flaky grader.
        priorGateHolds: countGateHoldsOnNode(dbMessages, session.currentNodeId),
        maxGateHolds: MAX_GATE_HOLDS,
      });

      let evaluation: EvaluateStepReadinessOutput | null = null;
      if (shouldEvaluateReadiness) {
        dataStream.writeMessageAnnotation({
          type: "cross-checking",
          active: true,
          documents: flow.contextDocs.map((doc) => documentLabel(doc.filename)),
        });
        try {
          let budget: ResolvedDocumentGenerationBudget | undefined;
          try {
            budget = await container.runtimeConfig.resolveDocumentGenerationBudget();
          } catch {
            budget = undefined;
          }
          const evalResult = await container.useCases.evaluateStepReadiness
            .execute({
              messages: [...messagesWithNew, { role: "assistant" as const, content: aiPayload.response }],
              flow,
              node: currentNode,
              budget,
            })
            .catch(() => null);
          if (evalResult && !evalResult.error) {
            evaluation = evalResult.data;
          }
        } finally {
          // Explicit off-signal so the badge clears the moment the cross-check
          // finishes, rather than lingering through the fail-path follow-up.
          dataStream.writeMessageAnnotation({ type: "cross-checking", active: false });
        }
      }

      // Gate failed: hold the step open and ask the user about the gaps. The
      // reply the gate overruled is persisted first — the user has already
      // watched it stream, and dropping it made the chat appear to rewrite a
      // message once the persisted view took over. The corrective follow-up is
      // then streamed and stored as its own message, and the outstanding items
      // are attached to it (which also records this hold so the gate can bound
      // itself on the next turn).
      if (evaluation && !evaluation.passed) {
        await persistHeldReply(container, session, aiPayload);
        const followup = await streamGapFollowup({
          container,
          writer: dataStream,
          session,
          flowId: flow.id,
          system: systemPromptResult.data,
          messages: messagesWithNew,
          missingInformation: evaluation.missingInformation,
          model: chatModel,
          modelName: chatModelName,
          provider,
          userId: authSession.userId,
        });

        if (followup.messageId) {
          await appendShortcomingsToContext(container, followup.messageId, evaluation.missingInformation);
        }

        if (dbMessages.filter((m) => m.role === "user").length === 0) {
          void generateTitle(container, session.id, lastUserMessage, provider, chatModelName, apiKey, authSession.userId);
        }
        return;
      }

      // Explicit pass feedback: streamed immediately (before the slow branch
      // choice and document generation) so the user sees the cross-check
      // outcome instead of an apparent stall.
      if (evaluation?.passed) {
        writeCrossCheckPassNote(dataStream);
      }

      const branchChoice = await computeBranchChoice();

      const runResult = await container.useCases.runTurn.persistAssistantTurn({
        session,
        flowId: flow.id,
        assistantMessage: aiPayload.response,
        aiPayload,
        branchChoice,
        // Confirmation reuses the neverDone suppression: pass Infinity so the
        // turn never auto-advances, and the real threshold so it can instead
        // mark the step as awaiting operator confirmation.
        advanceThreshold:
          isNeverDone || requireConfirmation ? Number.POSITIVE_INFINITY : realThreshold,
        requireConfirmation,
        confirmationThreshold: realThreshold,
      });

      if (runResult.error) {
        const cause = runResult.error.cause;
        throw cause instanceof Error ? cause : new Error(runResult.error.message);
      }

      // Persisted after the assistant turn so the stored order matches what
      // streamed: reply first, then the pass note.
      if (evaluation?.passed) {
        await persistCrossCheckPassNote(container, session.id, session.currentNodeId);
      }

      if (runResult.data.advanced) {
        await applyAdvanceSideEffects({
          container,
          session: runResult.data.session,
          flow,
          nodes,
          completedNode: currentNode,
          newNodeId: runResult.data.newNodeId,
          fallbackMessages: dbMessages,
          gatheredContext,
          organisationName,
          userProfile,
          userId: authSession.userId,
          isAdmin: authSession.isAdmin,
          model: branchingModel,
          provider,
          globalInstructions,
          // Live "Generating document…" feedback while generation is awaited
          // before the next step opens.
          onDocumentGenerationChange: (active) =>
            dataStream.writeMessageAnnotation({ type: "generating-document", active }),
          // On a pass the gate already extracted the fields and graded them;
          // thread both onward so generation skips the second extraction.
          precomputedDocument: evaluation
            ? {
                fieldValues: evaluation.fieldValues,
                grade: {
                  guidanceAlignmentConfidence: evaluation.guidanceAlignmentConfidence,
                  guidanceAlignmentRationale: evaluation.guidanceAlignmentRationale,
                  criteriaAlignmentConfidence: evaluation.criteriaAlignmentConfidence,
                  criteriaAlignmentRationale: evaluation.criteriaAlignmentRationale,
                },
              }
            : undefined,
        });
      }

      if (dbMessages.filter((m) => m.role === "user").length === 0) {
        void generateTitle(container, session.id, lastUserMessage, provider, chatModelName, apiKey, authSession.userId);
      }
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
        await container.repos.sessions.releaseTurn(session.id, turnId);
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
