import { createDataStreamResponse, formatDataStreamPart, generateObject } from "ai";
import { recordTokenUsage, resolveModel } from "@rbrasier/adapters";
import type { EvaluateStepReadinessOutput } from "@rbrasier/application";
import {
  normaliseAdvanceConfidenceThreshold,
  type AiTurnPayload,
  type ConversationalNodeConfig,
  type ResolvedDocumentGenerationBudget,
} from "@rbrasier/domain";
import { branchChoiceSchema, turnResponseSchema } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";
import { shouldComputeBranchChoice } from "./branch-gate";
import { streamTurn } from "./stream-turn";
import {
  appendShortcomingsToContext,
  applyAdvanceSideEffects,
  buildAttachmentAnnotation,
  buildGatheredContext,
  buildPromptSessionUploads,
  generateTitle,
  runMcpToolPrepass,
  streamGapFollowup,
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

  // Collaborative sessions: any authenticated user holding the link may send.
  // The session UUID is the shared secret, identical to the read-only share model.
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
  // A never-completing step has nothing to confirm; confirmation only applies to
  // a step that can actually reach its threshold.
  const requireConfirmation = Boolean(nodeConfig.requireConfirmation) && !isNeverDone;
  // Normalise on read: flow-authored data may store this as a fraction (0.7)
  // rather than a 0-100 percentage, which would otherwise auto-advance every turn.
  const realThreshold = normaliseAdvanceConfidenceThreshold(nodeConfig.advanceConfidenceThreshold);

  const orgSettingResult = await container.repos.systemSettings.get("organisation_name");
  const organisationName = orgSettingResult.error ? null : (orgSettingResult.data?.value ?? null);

  const globalInstructionsResult = await container.repos.systemSettings.get("global_prompt");
  const globalInstructions = globalInstructionsResult.error
    ? null
    : (globalInstructionsResult.data?.value ?? null);

  // Inject the user's own attachments into the turn independent of RAG: a thin
  // message ("here is the solution") retrieves nothing, so without this the agent
  // never sees the file it was just given.
  const uploadsResult = await container.repos.sessionUploads.listBySession(sessionId);
  const uploadConfig = await container.runtimeConfig.getSessionUploadConfig();
  const sessionUploads = uploadsResult.error
    ? []
    : buildPromptSessionUploads(uploadsResult.data, uploadConfig.totalBudgetChars);

  const userResult = await container.repos.users.findById(authSession.userId);
  const userProfile =
    userResult.error || !userResult.data
      ? null
      : { name: userResult.data.name, role: userResult.data.role, team: userResult.data.team };

  const gatheredContext = buildGatheredContext(dbMessages);

  const retrievalResult = await container.useCases.retrieveDocumentChunks.execute({
    flowId: flow.id,
    sessionId,
    query: lastUserMessage,
  });
  const retrievedChunks = retrievalResult.error ? [] : retrievalResult.data;

  const skillsResult = await container.useCases.resolveStepSkills.execute(nodeConfig);
  const resolvedSkills = skillsResult.error ? [] : skillsResult.data;

  // Conversational tool-loop (ADR-032): when a step allows MCP tools, let the model
  // call them in a non-streaming pre-pass and fold the gathered results into the
  // step context, leaving the structured streaming turn below untouched.
  const gatheredContextWithTools = await runMcpToolPrepass({
    container,
    nodeConfig,
    contextMcpServerIds: flow.contextMcpServerIds,
    dbMessages,
    lastUserMessage,
    gatheredContext,
    userId: authSession.userId,
    flowId: flow.id,
    sessionId,
  });

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
        senderUserId: authSession.userId,
      });
      if (userMsgResult.error) {
        const cause = userMsgResult.error.cause;
        throw cause instanceof Error ? cause : new Error(userMsgResult.error.message);
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
      // open — a thrown or errored eval advances exactly as today.
      const shouldEvaluateReadiness =
        !isNeverDone &&
        !requireConfirmation &&
        nodeConfig.outputType === "generate_document" &&
        Boolean(nodeConfig.documentTemplatePath) &&
        aiPayload.stepCompleteConfidence >= realThreshold;

      let evaluation: EvaluateStepReadinessOutput | null = null;
      if (shouldEvaluateReadiness) {
        dataStream.writeMessageAnnotation({ type: "cross-checking", active: true });
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
      }

      // Gate failed: hold the step open, record the gaps as outstanding context,
      // and ask the user about them straight away.
      if (evaluation && !evaluation.passed) {
        const failResult = await container.useCases.runTurn.persistAssistantTurn({
          session,
          flowId: flow.id,
          assistantMessage: aiPayload.response,
          aiPayload,
          branchChoice: null,
          advanceThreshold: Number.POSITIVE_INFINITY,
          requireConfirmation: false,
          confirmationThreshold: realThreshold,
        });
        if (failResult.error) {
          const cause = failResult.error.cause;
          throw cause instanceof Error ? cause : new Error(failResult.error.message);
        }

        const refreshed = await container.repos.sessionMessages.listBySession(session.id);
        const thresholdMessage = refreshed.error
          ? null
          : [...refreshed.data]
              .reverse()
              .find((m) => m.role === "assistant" && m.stepNodeId === session.currentNodeId);
        if (thresholdMessage) {
          await appendShortcomingsToContext(container, thresholdMessage.id, evaluation.missingInformation);
        }

        await streamGapFollowup({
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

        if (dbMessages.filter((m) => m.role === "user").length === 0) {
          void generateTitle(container, session.id, lastUserMessage, provider, chatModelName, apiKey, authSession.userId);
        }
        return;
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
