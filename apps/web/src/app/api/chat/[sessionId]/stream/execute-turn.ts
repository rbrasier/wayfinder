import type { EvaluateStepReadinessOutput } from "@rbrasier/application";
import { nodeFieldSet } from "@rbrasier/domain";
import type {
  AiTurnPayload,
  ConversationalNodeConfig,
  Flow,
  FlowNode,
  PromptUserProfile,
  ResolvedDocumentGenerationBudget,
  Session,
  SessionEvent,
  SessionMessage,
  TurnStreamWriter,
} from "@rbrasier/domain";
import { branchChoiceSchema, turnResponseSchema, type BranchChoice } from "@rbrasier/shared";
import type { Container } from "@/lib/container";
import { shouldComputeBranchChoice } from "./branch-gate";
import { countGateHoldsOnNode } from "./gate-holds";
import { shouldEvaluateStepReadiness } from "./readiness-gate";
import { streamTurn } from "./stream-turn";
import {
  appendShortcomingsToContext,
  applyAdvanceSideEffects,
  generateTitle,
  persistCrossCheckPassNote,
  persistHeldReply,
  streamGapFollowup,
  writeCrossCheckPassNote,
} from "./turn-helpers";

// How many times the pre-generation gate may hold a single node before it
// becomes advisory and the step advances on the cheap model's threshold. Bounds
// the gate so a flaky grader cannot livelock a step (surface gaps once, then
// let the operator's correction through).
const MAX_GATE_HOLDS = 1;

// The label shown for a context document in the cross-checking badge: the
// filename without its extension (FlowContextDoc has no separate title field).
const documentLabel = (filename: string): string => filename.replace(/\.[^/.]+$/, "");

export interface ExecuteTurnInput {
  container: Container;
  writer: TurnStreamWriter;
  // Fire-and-forget real-time notifications; a failure never fails the turn.
  publishEvent: (event: SessionEvent) => void;
  session: Session;
  flow: Flow;
  nodes: FlowNode[];
  currentNode: FlowNode;
  nodeConfig: ConversationalNodeConfig & { neverDone?: boolean };
  // The bounded turn tail (already sliced by GetSessionForTurn).
  dbMessages: SessionMessage[];
  // The current node's full assistant-message history, for the gate-hold count.
  currentNodeAssistantMessages: SessionMessage[];
  // The tail plus the new (attachment-annotated) user message.
  messagesWithNew: { role: "user" | "assistant" | "system"; content: string }[];
  systemPrompt: string;
  gatheredContext: string;
  branchNodes: { id: string; name: string; purpose: string | undefined }[];
  isNeverDone: boolean;
  requireConfirmation: boolean;
  realThreshold: number;
  organisationName: string | null;
  globalInstructions: string | null | undefined;
  userProfile: PromptUserProfile | null;
  chatModelName: string;
  branchingModelName: string;
  userId: string;
  isAdmin: boolean;
  // The raw text the user typed (the persisted user message; used for the title).
  lastUserMessage: string;
}

// The chat turn's business orchestration, extracted verbatim from the stream
// route's `execute` callback. The route owns the HTTP response, the turn lease
// (heartbeat + release), and building this input; everything from persisting the
// user message through the pre-generation gate, the assistant turn, the advance
// side effects, and the title lives here. It writes to the client only through
// the framework-free `TurnStreamWriter` port.
export async function executeTurn(input: ExecuteTurnInput): Promise<void> {
  const {
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
    systemPrompt,
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
    userId,
    isAdmin,
    lastUserMessage,
  } = input;

  const userMsgResult = await container.useCases.runTurn.persistUserMessage({
    session,
    userMessage: lastUserMessage,
    senderUserId: userId,
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
  const quotaCheck = await container.services.quotaEnforcer.check(userId);
  if (quotaCheck.error) {
    writer.writeText(quotaCheck.error.message);
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "system",
      content: quotaCheck.error.message,
      stepNodeId: session.currentNodeId,
    });
    return;
  }

  // Through the ILanguageModel port: the concurrency governor, usage
  // recording, quota enforcement, and Langfuse tracing all apply as
  // decorators (ADR-026). No hand-rolled recordTokenUsage here.
  const streamResult = await streamTurn({
    llm: container.services.llm,
    purpose: "chat-turn",
    model: chatModelName,
    userId,
    flowId: flow.id,
    sessionId: session.id,
    schema: turnResponseSchema,
    system: systemPrompt,
    messages: messagesWithNew,
    writer,
  });
  const turnResult = streamResult.object;

  const aiPayload: AiTurnPayload = {
    response: turnResult.response,
    rationale: turnResult.rationale,
    stepCompleteConfidence: turnResult.stepCompleteConfidence,
    contextGathered: turnResult.contextGathered,
  };

  writer.writeAnnotation({
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
    // Through the ILanguageModel port: the concurrency governor, usage
    // recording, and quota enforcement all apply as decorators (ADR-026), so
    // there is no hand-rolled governor run or recordTokenUsage here.
    const branchResult = await container.services.llm.generateObject<BranchChoice>({
      purpose: "chat-branch-choice",
      userId,
      flowId: flow.id,
      sessionId: session.id,
      model: branchingModelName,
      schema: branchChoiceSchema,
      system: branchPromptResult.data,
      messages: messagesWithNew,
    });
    if (branchResult.error) return null;
    return branchResult.data.object.branchChoice ?? null;
  };

  // Pre-generation evaluation gate: when the cheap model crosses the
  // threshold on a generate_document step, the doc-gen model confirms the
  // would-be document is ready *before* the session advances. The gate fails
  // open — a thrown or errored eval advances exactly as today. It is skipped
  // for flows with no context docs, which have no guidance for the larger
  // model to grade against.
  const shouldEvaluateReadiness = shouldEvaluateStepReadiness({
    isNeverDone,
    outputType: nodeConfig.outputType,
    hasTemplate: Boolean(nodeConfig.documentTemplatePath),
    hasFields: nodeFieldSet(nodeConfig).length > 0,
    hasContextDocs: flow.contextDocs.length > 0,
    stepCompleteConfidence: aiPayload.stepCompleteConfidence,
    advanceThreshold: realThreshold,
    // Bound the gate: once it has already surfaced this node's gaps, a later
    // threshold turn advances rather than looping on a flaky grader. Counted
    // over the current node's full history (not the bounded tail, which can
    // miss an older hold on a long-running node).
    priorGateHolds: countGateHoldsOnNode(currentNodeAssistantMessages, session.currentNodeId),
    maxGateHolds: MAX_GATE_HOLDS,
  });

  let evaluation: EvaluateStepReadinessOutput | null = null;
  if (shouldEvaluateReadiness) {
    writer.writeAnnotation({
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
      writer.writeAnnotation({ type: "cross-checking", active: false });
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
      writer,
      session,
      flowId: flow.id,
      system: systemPrompt,
      messages: messagesWithNew,
      missingInformation: evaluation.missingInformation,
      modelName: chatModelName,
      userId,
    });

    if (followup.messageId) {
      await appendShortcomingsToContext(container, followup.messageId, evaluation.missingInformation);
    }

    if (dbMessages.filter((m) => m.role === "user").length === 0) {
      void generateTitle(container, session.id, lastUserMessage, chatModelName, userId);
    }
    return;
  }

  // Explicit pass feedback: streamed immediately (before the slow branch
  // choice and document generation) so the user sees the cross-check
  // outcome instead of an apparent stall.
  if (evaluation?.passed) {
    writeCrossCheckPassNote(writer);
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
    advanceThreshold: isNeverDone || requireConfirmation ? Number.POSITIVE_INFINITY : realThreshold,
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
      userId,
      isAdmin,
      modelName: branchingModelName,
      globalInstructions,
      // Live "Generating document…" feedback while generation is awaited
      // before the next step opens.
      onDocumentGenerationChange: (active) =>
        writer.writeAnnotation({ type: "generating-document", active }),
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
    void generateTitle(container, session.id, lastUserMessage, chatModelName, userId);
  }
}
