"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { toast } from "sonner";
import type { ApproverSource, FlowEdge, FlowNode } from "@rbrasier/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatActionsMenu } from "@/components/chat/chat-actions-menu";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ApprovalGate } from "@/components/chat/approval-gate";
import { BranchOverrideModal } from "@/components/chat/branch-override-modal";
import { toBranchOptions } from "@/lib/chat/branch-options";
import { ConfirmStepCard } from "@/components/chat/confirm-step-card";
import { hasPendingDocumentGeneration } from "@/components/chat/document-poll-state";
import { MessageFeed } from "@/components/chat/message-feed";
import { AppHeader } from "@/components/layout/app-header";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { buildStepRail, topoSortNodes } from "@/lib/flow-utils";
import { trpc } from "@/trpc/client";
import { ManualEstimateModal } from "@/components/chat/manual-estimate-modal";
import { shouldPromptForEstimate } from "@/components/chat/manual-estimate-state";

const NULL_BRANCH_THRESHOLD = 3;

// The shape useChat expects for messages sourced from the persisted history —
// used both at initialisation and to re-sync the streamed list between turns.
const toUiMessages = (
  messages: { id: string; role: string; content: string; confidence: number | null }[],
) =>
  messages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
    annotations:
      m.confidence !== null ? [{ type: "confidence", score: m.confidence }] : undefined,
  }));

const statusVariant = (status: string) => {
  if (status === "active") return "blue";
  if (status === "complete") return "green";
  return "grey";
};

function countStalls(
  messages: { role: string; confidence: number | null; stepNodeId: string | null }[],
  currentNodeId: string | null,
  edges: FlowEdge[],
): number {
  if (!currentNodeId) return 0;
  const outgoing = edges.filter((e) => e.fromNodeId === currentNodeId);
  if (outgoing.length <= 1) return 0;

  const assistantOnCurrent = messages.filter(
    (m) => m.role === "assistant" && m.stepNodeId === currentNodeId && (m.confidence ?? 0) >= 90,
  );
  return assistantOnCurrent.length;
}

export function ChatSessionContent({ sessionId }: { sessionId: string }) {
  const router = useRouter();

  const utils = trpc.useUtils();
  const sessionQuery = trpc.session.get.useQuery({ sessionId });
  const meQuery = trpc.user.me.useQuery();
  const sessionData = sessionQuery.data;
  // The server grants approvers read-only access to sessions they don't own so
  // they can open the request for context. Treated like a shared viewer: no
  // composer, gate, or step actions.
  const isReadOnly = sessionData?.readOnly === true;
  const isAdmin = meQuery.data?.isAdmin ?? false;

  const myUserId = meQuery.data?.userId ?? null;

  // The manual-time estimate is asked once, when the operator's own session has
  // finished. Skipping is remembered for the visit only — the row stays null, so
  // a later visit can still capture it.
  const [estimateDismissed, setEstimateDismissed] = useState(false);
  const recordEstimateMutation = trpc.session.recordManualEstimate.useMutation({
    onSuccess: () => {
      void utils.session.get.invalidate({ sessionId });
    },
  });
  const emitTypingMutation = trpc.session.emitTyping.useMutation();
  const lastTypingEmitRef = useRef(0);
  // Live typing presence over the event bus instead of a 2 s poll (scaling wall
  // #2): each `typing` event stamps an expiry a few seconds out, and a light tick
  // recomputes the indicator so it fades when the events stop.
  const typingExpiryRef = useRef<Map<string, number>>(new Map());
  const [typingTick, setTypingTick] = useState(0);

  const [_regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [overrideOpen, setOverrideOpen] = useState(false);
  const kickoffSentRef = useRef(false);

  const renameMutation = trpc.session.rename.useMutation({
    onSuccess: () => {
      void utils.session.get.invalidate({ sessionId });
      toast.success("Chat renamed");
    },
    onError: (error) => toast.error(error.message),
  });

  const closeMutation = trpc.session.close.useMutation({
    onSuccess: () => {
      toast.success("Chat abandoned");
      void utils.session.list.invalidate();
      router.push("/chats");
    },
    onError: (error) => toast.error(error.message),
  });

  const overrideMutation = trpc.session.overrideBranch.useMutation({
    onSuccess: () => {
      setOverrideOpen(false);
      void utils.session.get.invalidate({ sessionId });
      toast.success("Advanced to selected step");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Optimistic Proceed: the confirm mutation generates the completed step's
  // document and opens the next step before it resolves, so the card must hide
  // (and the generating badge show) the moment the operator clicks — not when
  // everything finishes. Cleared only after the refetched session reflects the
  // advance, so the card cannot flash back in between.
  const [isConfirmingStep, setIsConfirmingStep] = useState(false);
  const confirmStepMutation = trpc.session.confirmStep.useMutation({
    onSuccess: async (result) => {
      await utils.session.get.invalidate({ sessionId });
      setIsConfirmingStep(false);
      // A forked step the AI could not route on its own falls back to the
      // existing manual branch-override picker rather than failing silently.
      if (result.needsManualBranch) {
        setOverrideOpen(true);
        return;
      }
      if (result.advanced) toast.success("Step confirmed");
    },
    onError: (error) => {
      setIsConfirmingStep(false);
      toast.error(error.message);
    },
  });

  const handleConfirmStep = () => {
    setIsConfirmingStep(true);
    confirmStepMutation.mutate({ sessionId });
  };

  const dbMessages = sessionData?.messages ?? [];
  const rawNodes: FlowNode[] = sessionData?.nodes ?? [];
  const edges: FlowEdge[] = sessionData?.edges ?? [];
  const currentNodeId = sessionData?.session.currentNodeId ?? null;

  const nodes = useMemo(() => {
    const edgesAsEdgeLike = edges.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId }));
    return topoSortNodes(rawNodes, edgesAsEdgeLike);
  }, [rawNodes, edges]);

  const currentNode = rawNodes.find((node) => node.id === currentNodeId) ?? null;
  const isApprovalGate = currentNode?.type === "approval";
  const currentNodeConfig = currentNode?.config as Record<string, unknown> | undefined;
  const isDocumentTemplateStep =
    currentNodeConfig?.["outputType"] === "generate_document" &&
    Boolean(currentNodeConfig?.["documentTemplatePath"]);
  const awaitingConfirmationNodeId = sessionData?.session.awaitingConfirmationNodeId ?? null;
  const isAwaitingConfirmation =
    awaitingConfirmationNodeId !== null && awaitingConfirmationNodeId === currentNodeId;

  const senderNamesById = useMemo(() => {
    const namesById: Record<string, string> = {};
    for (const participant of sessionData?.participants ?? []) {
      if (participant.name) namesById[participant.id] = participant.name;
    }
    return namesById;
  }, [sessionData?.participants]);

  // Derived from the typing-event expiry map; `typingTick` forces recompute as
  // entries arrive and lapse. The current user is filtered out so they never see
  // their own indicator echoed back over the bus.
  const typingUsers = useMemo(() => {
    void typingTick;
    const now = Date.now();
    const active: { userId: string; name: string | null }[] = [];
    for (const [userId, expiresAt] of typingExpiryRef.current) {
      if (expiresAt <= now || userId === myUserId) continue;
      active.push({ userId, name: senderNamesById[userId] ?? null });
    }
    return active;
  }, [typingTick, myUserId, senderNamesById]);

  const completedNodeIds: string[] = [];
  if (dbMessages.length > 0) {
    const messagesByNode = new Map<string, { maxConfidence: number; lastStepNodeId: string }>();
    for (const msg of dbMessages) {
      if (msg.stepNodeId && msg.confidence !== null && msg.role === "assistant") {
        const existing = messagesByNode.get(msg.stepNodeId);
        if (!existing || msg.confidence > existing.maxConfidence) {
          messagesByNode.set(msg.stepNodeId, { maxConfidence: msg.confidence, lastStepNodeId: msg.stepNodeId });
        }
      }
    }
    for (const [nodeId, data] of messagesByNode) {
      if (data.maxConfidence >= 90 && nodeId !== currentNodeId) {
        completedNodeIds.push(nodeId);
      }
    }
  }

  const railSteps = buildStepRail(nodes, edges, currentNodeId, completedNodeIds);

  const stallCount = countStalls(dbMessages, currentNodeId, edges);
  const showBranchOverride = isAdmin && !isReadOnly && stallCount >= NULL_BRANCH_THRESHOLD;

  const outgoingBranches = toBranchOptions(edges, nodes, currentNodeId);

  const { messages, input, handleSubmit, isLoading, setInput, error, reload, append, setMessages } = useChat({
    api: `/api/chat/${sessionId}/stream`,
    initialMessages: toUiMessages(dbMessages),
    experimental_prepareRequestBody: ({ messages: msgs }) => ({
      messages: msgs.slice(-20),
    }),
    onFinish: () => {
      void utils.session.get.invalidate({ sessionId });
    },
    onError: () => {
      void utils.session.get.invalidate({ sessionId });
    },
  });

  useEffect(() => {
    void utils.session.get.invalidate({ sessionId });
  }, [sessionId, utils.session.get]);

  // Between turns, re-sync the streamed list from the persisted history. The
  // stream only ever carries the reply itself — gap follow-ups, cross-check
  // notes and next-step openers are persisted server-side — so without this the
  // next turn's streaming view renders an older history and messages appear to
  // vanish mid-turn. Skipped while a turn is in flight, and while the refetch
  // still lags the streamed list, so a finished turn is never clobbered by
  // stale data.
  useEffect(() => {
    if (isLoading) return;
    if (dbMessages.length < messages.length) return;
    const inSync =
      dbMessages.length === messages.length &&
      dbMessages.every((m, index) => m.id === messages[index]?.id);
    if (inSync) return;
    setMessages(toUiMessages(dbMessages));
  }, [isLoading, dbMessages, messages, setMessages]);

  // A freshly created session has no messages yet. Auto-send a generic kickoff
  // message as the user so the agent responds immediately, instead of leaving
  // the user staring at an empty thread. Read-only collaborators and inactive
  // or deleted flows are skipped, and the ref guards against double-sends.
  useEffect(() => {
    if (kickoffSentRef.current) return;
    if (!sessionData) return;
    if (isReadOnly) return;
    if (sessionData.session.status !== "active") return;
    if (sessionData.flow.deletedAt !== null) return;
    if (sessionData.messages.length > 0) return;
    if (messages.length > 0) return;
    if (isLoading) return;

    kickoffSentRef.current = true;

    const flowName = sessionData.flow.name;
    const firstStepName = currentNode?.name?.trim();
    const kickoffMessage = firstStepName
      ? `Hi! I'm ready to get started with the "${flowName}" workflow. Let's begin with the first step: ${firstStepName}.`
      : `Hi! I'm ready to get started with the "${flowName}" workflow. Please guide me through the first step.`;

    void append({ role: "user", content: kickoffMessage });
  }, [sessionData, isReadOnly, messages.length, isLoading, currentNode, append]);

  // Poll while a document is being generated so the spinner resolves
  // automatically. Only the last assistant message per step counts — see
  // hasPendingDocumentGeneration.
  const hasGeneratingDoc = useMemo(
    () => hasPendingDocumentGeneration(dbMessages, currentNodeId, rawNodes),
    [dbMessages, currentNodeId, rawNodes],
  );

  const sessionStatus = sessionData?.session.status ?? null;
  const isSessionActive = sessionStatus === "active";

  // One EventSource replaces the 2 s typing poll and 3 s session poll (scaling
  // wall #2). The server pushes message/turn/state events; each triggers a state
  // refetch (definitions are cached), and `typing` events feed the presence map.
  // EventSource reconnects automatically with Last-Event-ID for lossless replay.
  useEffect(() => {
    if (!isSessionActive) return;
    const source = new EventSource(`/api/sessions/${sessionId}/events`);
    const refetch = () => {
      void utils.session.get.invalidate({ sessionId });
      // The approval gate reads its row separately, and it is the one thing on
      // screen another person can change without touching the session: a
      // chained approval is confirmed by the *previous approver*, from their
      // own decision modal. Without this the gate keeps offering to choose an
      // approver for a request that has already been sent.
      void utils.approval.forNode.invalidate();
    };
    source.addEventListener("message.created", refetch);
    source.addEventListener("session.updated", refetch);
    source.addEventListener("turn.claimed", refetch);
    source.addEventListener("turn.released", refetch);
    source.addEventListener("typing", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { userId?: string };
        if (!data.userId || data.userId === myUserId) return;
        typingExpiryRef.current.set(data.userId, Date.now() + 4000);
        setTypingTick((tick) => tick + 1);
      } catch {
        // Ignore malformed events; the fallback poll keeps state fresh.
      }
    });
    return () => source.close();
  }, [sessionId, isSessionActive, myUserId, utils.session.get]);

  // Light tick so typing indicators fade out once events stop arriving.
  useEffect(() => {
    if (typingExpiryRef.current.size === 0 && !isSessionActive) return;
    const interval = setInterval(() => setTypingTick((tick) => tick + 1), 1500);
    return () => clearInterval(interval);
  }, [isSessionActive]);

  // Degraded fallback (scaling wall #2): a slow poll if the SSE stream is ever
  // interrupted, and a faster one only while a document is still generating so
  // the spinner resolves promptly. Pauses while the tab is hidden.
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const shouldPoll = hasGeneratingDoc || isSessionActive;
    const stop = () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
    if (!shouldPoll) {
      stop();
      return;
    }
    const intervalMs = hasGeneratingDoc ? 3000 : 20000;
    const start = () => {
      if (pollingRef.current) return;
      pollingRef.current = setInterval(() => {
        void utils.session.get.invalidate({ sessionId });
      }, intervalMs);
    };
    const handleVisibility = () => {
      stop();
      if (document.visibilityState !== "hidden") start();
    };
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [hasGeneratingDoc, isSessionActive, sessionId, utils.session.get]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    handleSubmit();
  };

  const handleRegenerateDocument = useCallback(async (messageId: string) => {
    setRegeneratingIds((prev) => new Set(prev).add(messageId));
    try {
      await fetch(`/api/documents/${messageId}`, { method: "POST" });
      void utils.session.get.invalidate({ sessionId });
      toast.success("Document regenerated");
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  }, [sessionId, utils.session.get]);

  if (sessionQuery.isLoading) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-[13px] text-[#666055]">Loading session…</p>
      </main>
    );
  }

  if (!sessionData) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-[14px] font-semibold text-[#1c1b19]">Session not found</p>
        <Link href="/chats" className="text-[13px] text-[#2f56d3] underline">
          Back to My Chats
        </Link>
      </main>
    );
  }

  const { session, flow } = sessionData;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const newChatUrl = `${origin}/chats?flow=${flow.id}&start=1`;
  const collaborateUrl = `${origin}/chats/${sessionId}?shared=true`;
  const isFlowDeleted = flow.deletedAt !== null;

  const firstTyperName = typingUsers[0]?.name?.trim();
  const typingLabel =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? firstTyperName
          ? `${firstTyperName} is typing`
          : "Someone is typing"
        : "Several people are typing";

  return (
    <main className="flex h-full flex-col overflow-hidden">
      <AppHeader
        breadcrumb={{ label: "My Chats", href: "/chats" }}
        title={session.title ?? flow.name}
        status={
          <Badge variant={statusVariant(session.status)} className="capitalize">
            {session.status}
          </Badge>
        }
        actions={
          <ChatActionsMenu
            sessionId={sessionId}
            sessionTitle={session.title}
            shareUrl={newChatUrl}
            collaborateUrl={collaborateUrl}
            onRename={(title) => renameMutation.mutate({ sessionId, title })}
            onClose={() => closeMutation.mutate({ sessionId })}
            isReadOnly={isReadOnly}
          />
        }
        steps={railSteps}
        currentNodeId={session.currentNodeId}
        completedNodeIds={completedNodeIds}
      />

      {isFlowDeleted && (
        <div className="flex justify-center border-b border-[#e6d0ab] bg-[#f6e9d8] px-4 py-2">
          <p className="text-[13px] text-[#8a5a1d]">
            This flow has been deleted. You can read this chat but can no longer send new messages.
          </p>
        </div>
      )}

      <MessageFeed
        dbMessages={dbMessages}
        streamingMessages={messages}
        nodes={nodes}
        isStreaming={isLoading}
        isComplete={session.status === "complete"}
        error={error ?? null}
        onRetry={() => void reload()}
        onRegenerateDocument={handleRegenerateDocument}
        canEditDocuments={session.status === "active" && !isReadOnly && !isFlowDeleted}
        isOnApprovalNode={isApprovalGate}
        onDocumentEdited={() => void utils.session.get.invalidate({ sessionId })}
        expertRole={flow.expertRole ?? null}
        senderNamesById={senderNamesById}
        currentUserId={myUserId}
        awaitingConfirmationNodeId={awaitingConfirmationNodeId}
        currentNodeId={currentNodeId}
        sessionId={sessionId}
        canSubmitFeedback={
          (meQuery.data?.isAdmin ?? false) ||
          (meQuery.data?.permissions ?? []).includes("knowledge:submit_feedback")
        }
        pendingDocumentGeneration={isConfirmingStep && isDocumentTemplateStep}
        pendingStepAdvance={isConfirmingStep && !isDocumentTemplateStep}
      />

      {showBranchOverride && (
        <div className="flex justify-center border-t border-[#e7e3db] bg-[#f6e9d8] px-4 py-3">
          <div className="flex items-center gap-3">
            <p className="text-[13px] text-[#8a5a1d]">Wayfinder could not determine the next step.</p>
            <Button size="sm" variant="secondary" onClick={() => setOverrideOpen(true)}>
              Pick a step manually
            </Button>
          </div>
        </div>
      )}

      {typingLabel && (
        <div className="flex shrink-0 items-center gap-2 border-t border-[#e7e3db] bg-white px-5 pt-2">
          <TypingIndicator />
          <span className="text-[12px] text-[#666055]">{typingLabel}</span>
        </div>
      )}

      {isAwaitingConfirmation && !isConfirmingStep && currentNode && session.status === "active" && !isReadOnly && (
        <ConfirmStepCard stepName={currentNode.name} onProceed={handleConfirmStep} />
      )}

      {/* The composer stack: the approval gate sits inside it, directly above
          the input and at the same width, so a pending approval reads as the
          next thing in the chat rather than a panel over it. While the gate is
          up the composer is not rendered at all — a disabled input still holds
          the place the operator's attention goes and still invites a click that
          does nothing. It returns when the session leaves the approval node,
          which is what withdrawing does. */}
      <div className="shrink-0" data-composer-stack>
        {isApprovalGate && currentNode && session.status === "active" && !isReadOnly && (
          <ApprovalGate
            sessionId={sessionId}
            flowId={session.flowId}
            flowName={flow.name}
            nodeId={currentNode.id}
            nodeName={currentNode.name}
            approverSource={
              (currentNode.config as { approverSource?: ApproverSource }).approverSource ??
              "first_level_supervisor"
            }
            instructions={(currentNode.config as { instructions?: string }).instructions ?? null}
            roleHint={(currentNode.config as { roleHint?: string }).roleHint ?? null}
            viewerUserId={myUserId}
            sessionOwnerUserId={session.userId}
            viewerIsAdmin={isAdmin}
            offSystemAllowed={
              (currentNode.config as { allowOffSystemApproval?: boolean })
                .allowOffSystemApproval !== false
            }
          />
        )}

        {!isReadOnly && !isApprovalGate && (
          <ChatComposer
            sessionId={sessionId}
            value={input}
            onChange={(value) => {
              setInput(value);
              if (session.status !== "active") return;
              const now = Date.now();
              if (now - lastTypingEmitRef.current < 2000) return;
              lastTypingEmitRef.current = now;
              emitTypingMutation.mutate({ sessionId });
            }}
            onSubmit={handleSend}
            disabled={isLoading || session.status !== "active" || isFlowDeleted}
          />
        )}
      </div>

      <BranchOverrideModal
        open={overrideOpen}
        branches={outgoingBranches}
        onSelect={(targetNodeId) =>
          overrideMutation.mutate({ sessionId, targetNodeId })
        }
        onClose={() => setOverrideOpen(false)}
        isPending={overrideMutation.isPending}
      />

      <ManualEstimateModal
        open={shouldPromptForEstimate({
          status: session.status,
          isOwner: myUserId !== null && session.userId === myUserId,
          alreadyEstimated: session.manualEstimateMinutes != null,
          dismissed: estimateDismissed,
        })}
        flowName={flow.name}
        isSaving={recordEstimateMutation.isPending}
        onSubmit={(minutes) => recordEstimateMutation.mutate({ sessionId, minutes })}
        onSkip={() => setEstimateDismissed(true)}
      />
    </main>
  );
}
