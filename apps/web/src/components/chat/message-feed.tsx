"use client";

import { useEffect, useRef } from "react";
import type { Message as UIMessage } from "@ai-sdk/react";
import type { FlowNode, SessionMessage } from "@rbrasier/domain";
import { ConfidenceBar } from "./confidence-bar";
import { resolveCrossCheckingState } from "./cross-checking-state";
import { resolveGeneratingDocumentState } from "./generating-document-state";
import { messageTextSegments } from "./message-segments";
import { DocumentCard } from "./document-card";
import { RecordCard } from "./record-card";
import { MessageInfoModal } from "./message-info-modal";
import {
  AdvancingBadge,
  CrossCheckingBadge,
  FlowCompletePill,
  GeneratingDocumentBadge,
  MilestonePill,
} from "./milestone-pill";
import { resolveMilestoneState } from "./milestone-state";
import { TypingIndicator } from "./typing-indicator";
import { formatScheduledResume, parseScheduledMessage } from "@/lib/scheduled-message";

interface ConfidenceAnnotation {
  type: "confidence";
  score: number;
}

const toConfidenceAnnotation = (a: unknown): ConfidenceAnnotation | null => {
  if (typeof a !== "object" || a === null) return null;
  const obj = a as Record<string, unknown>;
  if (obj["type"] !== "confidence" || typeof obj["score"] !== "number") return null;
  return obj as unknown as ConfidenceAnnotation;
};

interface MessageFeedProps {
  dbMessages: SessionMessage[];
  streamingMessages: UIMessage[];
  nodes: FlowNode[];
  isStreaming: boolean;
  isComplete?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onRegenerateDocument?: (messageId: string) => void;
  // Coarse gate: documents are only manually editable on an active session. The
  // node's allowManualEdit flag refines this per step, and the server enforces both.
  canEditDocuments?: boolean;
  onDocumentEdited?: () => void;
  expertRole?: string | null;
  userFirstInitial?: string;
  senderNamesById?: Record<string, string>;
  // The step held open awaiting operator confirmation. Its milestone pill is
  // suppressed because the step has not actually completed yet (ADR-026).
  awaitingConfirmationNodeId?: string | null;
  // The node the session is currently parked on. A high-confidence turn still on
  // this step has not advanced (e.g. the pre-generation gate held it), so it must
  // not render a milestone pill or a phantom "Generating document" badge.
  currentNodeId?: string | null;
  // When the viewer holds knowledge:submit_feedback, the info modal on each
  // assistant message exposes a "Fix this answer" affordance.
  sessionId?: string;
  canSubmitFeedback?: boolean;
  // The operator Proceed path runs document generation inside a mutation, with
  // no stream to carry the generating-document annotation — the caller raises
  // this instead so the same badge shows while that mutation runs.
  pendingDocumentGeneration?: boolean;
  // The same Proceed path for a step that produces no document (e.g. a fork that
  // recomputes its branch): shows a generic "Advancing…" badge so the operator
  // sees the step is progressing rather than a frozen screen.
  pendingStepAdvance?: boolean;
}

const getRoleInitials = (role: string | null | undefined, fallback: string): string => {
  if (!role) return fallback;
  const tokens = role.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return fallback;
  const initials = tokens
    .map((t) => t[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || fallback;
};

const formatRelativeTime = (date: Date): string => {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString();
};

export function MessageFeed({
  dbMessages,
  streamingMessages,
  nodes,
  isStreaming,
  isComplete,
  error,
  onRetry,
  onRegenerateDocument,
  canEditDocuments,
  onDocumentEdited,
  expertRole,
  userFirstInitial,
  senderNamesById,
  awaitingConfirmationNodeId,
  currentNodeId,
  sessionId,
  canSubmitFeedback,
  pendingDocumentGeneration,
  pendingStepAdvance,
}: MessageFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom < 80;
  };

  // Follow the feed while the viewer is at the bottom. Runs after every render
  // (no dependency array) because the feed grows without a message-count
  // change: streamed text, annotation badges, milestone pills, document cards
  // and the streamed→persisted view swap all change its height.
  useEffect(() => {
    if (!isPinnedToBottomRef.current) return;
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
  });

  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const showStreaming = isStreaming || streamingMessages.length > dbMessages.length;
  const botInitials = getRoleInitials(expertRole ?? null, "AI");
  const userInitials = userFirstInitial ?? "U";

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-5 overflow-y-auto bg-[#f7f6f3] px-5 py-6"
    >
      {!showStreaming &&
        dbMessages.map((msg, index) => {
          const prevMsg = dbMessages[index - 1];
          const isNewStep = msg.stepNodeId && prevMsg?.stepNodeId !== msg.stepNodeId && index > 0;
          const node = msg.stepNodeId ? nodeById[msg.stepNodeId] : null;

          const senderName =
            msg.role === "user" && msg.senderUserId ? senderNamesById?.[msg.senderUserId] ?? null : null;
          const messageUserInitials = senderName ? getRoleInitials(senderName, userInitials) : userInitials;

          const scheduled = msg.role === "system" ? parseScheduledMessage(msg.content) : null;
          const displayContent = scheduled
            ? formatScheduledResume(scheduled.stepName, scheduled.nextFireAt)
            : msg.content;

          const config = node?.config as Record<string, unknown> | undefined;
          const isDocNode = config?.["outputType"] === "generate_document";
          const isStructuredNode = config?.["outputType"] === "structured";
          const hasTemplate = Boolean(config?.["documentTemplatePath"]);
          const isNeverDone = Boolean(config?.["neverDone"]);

          const { isAdvancing: isAdvancingMsg, docState } = resolveMilestoneState({
            role: msg.role,
            confidence: msg.confidence,
            stepNodeId: msg.stepNodeId,
            documentStatus: msg.documentStatus,
            hasDocument: Boolean(msg.document),
            nextStepNodeId: dbMessages[index + 1]?.stepNodeId,
            currentNodeId: currentNodeId ?? null,
            awaitingConfirmationNodeId,
            isDocNode,
            hasTemplate,
            isSessionComplete: Boolean(isComplete),
          });

          return (
            <div key={msg.id}>
              {isNewStep && node && (
                <div className="my-1 text-center font-mono text-[10px] text-[#6d6a65]">
                  — {node.name} —
                </div>
              )}
              <div className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role !== "user" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#3a5fd9] text-[10px] font-bold text-white">
                    {botInitials}
                  </div>
                )}
                <div
                  className={`relative max-w-[68%] rounded-[14px] px-4 py-3 ${
                    msg.role === "user"
                      ? "rounded-br-[4px] bg-[#3a5fd9]"
                      : "rounded-bl-[4px] border border-[#dedad2] bg-white shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]"
                  }`}
                >
                  {senderName && (
                    <p className="mb-1 text-[10px] font-semibold text-white/70">{senderName}</p>
                  )}
                  <p
                    className={`whitespace-pre-wrap text-[13px] leading-[1.55] ${
                      msg.role === "user" ? "text-white/90" : "text-[#1a1814]"
                    }`}
                  >
                    {displayContent}
                  </p>
                  <p
                    className={`mt-1 text-right font-mono text-[10px] ${
                      msg.role === "user" ? "text-white/50" : "text-[#6d6a65]"
                    }`}
                  >
                    {formatRelativeTime(msg.createdAt)}
                  </p>
                  {msg.role === "assistant" && !isNeverDone && (
                    <ConfidenceBar score={msg.confidence} />
                  )}
                  {msg.role === "assistant" && msg.aiPayload && (
                    <MessageInfoModal
                      message={msg}
                      allMessages={dbMessages}
                      sessionId={sessionId}
                      canSubmitFeedback={canSubmitFeedback}
                    />
                  )}
                </div>
                {msg.role === "user" && (
                  <div
                    title={senderName ?? undefined}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#e6e3dc] text-[10px] font-bold text-[#1a1814]"
                  >
                    {messageUserInitials}
                  </div>
                )}
              </div>
              {isAdvancingMsg && node && !isNeverDone && (
                <>
                  <MilestonePill
                    nodeName={node.name}
                    confidence={msg.confidence ?? 0}
                    documentState={docState}
                    onRegenerate={
                      docState === "failed" && onRegenerateDocument
                        ? () => onRegenerateDocument(msg.id)
                        : undefined
                    }
                  />
                  {msg.document && (
                    <DocumentCard
                      messageId={msg.id}
                      document={msg.document}
                      documentGenerationConfidence={msg.aiPayload?.documentGenerationConfidence ?? null}
                      canEdit={Boolean(canEditDocuments) && config?.["allowManualEdit"] !== false}
                      onEdited={onDocumentEdited}
                      onRegenerate={
                        onRegenerateDocument ? () => onRegenerateDocument(msg.id) : undefined
                      }
                    />
                  )}
                  {isStructuredNode && (
                    <RecordCard
                      messageId={msg.id}
                      canEdit={Boolean(canEditDocuments) && config?.["allowManualEdit"] !== false}
                      onEdited={onDocumentEdited}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}

      {showStreaming && (
        <>
          {streamingMessages.map((msg) => {
            const confidenceAnnotation =
              msg.annotations?.map(toConfidenceAnnotation).find(Boolean) ?? null;
            const crossCheckingState = resolveCrossCheckingState(msg.annotations);
            const isCrossChecking =
              isStreaming && msg.role === "assistant" && crossCheckingState.active;
            const generatingDocumentState = resolveGeneratingDocumentState(msg.annotations);
            const isGeneratingDocument =
              isStreaming && msg.role === "assistant" && generatingDocumentState.active;
            const latestPersistedNodeId = [...dbMessages].reverse().find((m) => m.role === "assistant")?.stepNodeId ?? null;
            const streamingNode = latestPersistedNodeId ? nodeById[latestPersistedNodeId] : null;
            const streamingConfig = streamingNode?.config as Record<string, unknown> | undefined;
            const streamingIsNeverDone = Boolean(streamingConfig?.["neverDone"]);
            // One streamed response can carry several logical messages (the
            // reply, then a cross-check follow-up or pass note) split by
            // finish_step boundaries — each renders as its own bubble to match
            // the rows the server persists.
            const segments = messageTextSegments(msg);

            return (
              <div key={msg.id} className="flex flex-col gap-5">
              {segments.map((segment, segmentIndex) => (
                <div
                  key={segmentIndex}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role !== "user" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#3a5fd9] text-[10px] font-bold text-white">
                      {botInitials}
                    </div>
                  )}
                  <div
                    className={`max-w-[68%] rounded-[14px] px-4 py-3 ${
                      msg.role === "user"
                        ? "rounded-br-[4px] bg-[#3a5fd9]"
                        : "rounded-bl-[4px] border border-[#dedad2] bg-white shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]"
                    }`}
                  >
                    <p
                      className={`whitespace-pre-wrap text-[13px] leading-[1.55] ${
                        msg.role === "user" ? "text-white/90" : "text-[#1a1814]"
                      }`}
                    >
                      {segment}
                    </p>
                    {msg.role === "assistant" && segmentIndex === 0 && !streamingIsNeverDone && (
                      <ConfidenceBar
                        score={confidenceAnnotation?.score ?? null}
                        evaluating={isStreaming && !confidenceAnnotation}
                      />
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#e6e3dc] text-[10px] font-bold text-[#1a1814]">
                      {userInitials}
                    </div>
                  )}
                </div>
              ))}
              {isCrossChecking && <CrossCheckingBadge documents={crossCheckingState.documents} />}
              {isGeneratingDocument && <GeneratingDocumentBadge />}
              </div>
            );
          })}
          {isStreaming && streamingMessages.at(-1)?.role !== "assistant" && (
            <div className="flex gap-3 justify-start">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#3a5fd9] text-[10px] font-bold text-white">
                {botInitials}
              </div>
              <div className="rounded-[14px] rounded-bl-[4px] border border-[#dedad2] bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]">
                <TypingIndicator />
              </div>
            </div>
          )}
        </>
      )}

      {pendingDocumentGeneration && <GeneratingDocumentBadge />}

      {pendingStepAdvance && <AdvancingBadge />}

      {error && !isStreaming && (
        <div className="flex justify-start">
          <div className="flex items-center gap-3 rounded-[10px] border border-[#f3c5b8] bg-[#fdf0eb] px-3 py-2">
            <p className="text-[12px] text-[#a8462a]">
              The assistant couldn't reply — please try again.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-[6px] border border-[#a8462a] bg-white px-2 py-1 text-[11px] font-semibold text-[#a8462a] hover:bg-[#a8462a] hover:text-white"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {isComplete && !isStreaming && <FlowCompletePill />}

      {dbMessages.length === 0 && !isStreaming && !error && (
        <div className="flex flex-1 items-center justify-center text-center text-[13px] text-[#6d6a65]">
          <p>The conversation will begin once you send your first message.</p>
        </div>
      )}
    </div>
  );
}
