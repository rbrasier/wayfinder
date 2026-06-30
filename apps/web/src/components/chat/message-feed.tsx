"use client";

import { useEffect, useRef, useState } from "react";
import type { Message as UIMessage } from "@ai-sdk/react";
import type { FlowNode, SessionMessage } from "@rbrasier/domain";
import { ConfidenceBar } from "./confidence-bar";
import { DocumentCard } from "./document-card";
import { FixAnswerModal } from "./fix-answer-modal";
import { MessageInfoModal } from "./message-info-modal";
import { CrossCheckingBadge, FlowCompletePill, MilestonePill } from "./milestone-pill";
import { TypingIndicator } from "./typing-indicator";

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

const isCrossCheckingAnnotation = (a: unknown): boolean =>
  typeof a === "object" && a !== null && (a as Record<string, unknown>)["type"] === "cross-checking";

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
  // When the viewer holds knowledge:submit_feedback, persisted assistant
  // messages gain a "Fix this answer" affordance that opens the correction modal.
  sessionId?: string;
  canSubmitFeedback?: boolean;
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
  sessionId,
  canSubmitFeedback,
}: MessageFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [fixing, setFixing] = useState<{ id: string; content: string } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dbMessages.length, streamingMessages.length]);

  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const showStreaming = isStreaming || streamingMessages.length > dbMessages.length;
  const botInitials = getRoleInitials(expertRole ?? null, "AI");
  const userInitials = userFirstInitial ?? "U";

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto bg-[#f7f6f3] px-5 py-6">
      {!showStreaming &&
        dbMessages.map((msg, index) => {
          const prevMsg = dbMessages[index - 1];
          const isNewStep = msg.stepNodeId && prevMsg?.stepNodeId !== msg.stepNodeId && index > 0;
          const node = msg.stepNodeId ? nodeById[msg.stepNodeId] : null;

          const senderName =
            msg.role === "user" && msg.senderUserId ? senderNamesById?.[msg.senderUserId] ?? null : null;
          const messageUserInitials = senderName ? getRoleInitials(senderName, userInitials) : userInitials;

          const isAdvancingMsg =
            msg.role === "assistant" &&
            msg.confidence !== null &&
            msg.confidence >= 90 &&
            dbMessages[index + 1]?.stepNodeId !== msg.stepNodeId &&
            // A step awaiting confirmation has reached threshold but not advanced;
            // it gets the pinned ConfirmStepCard, not the auto-advance milestone.
            msg.stepNodeId !== awaitingConfirmationNodeId;

          const config = node?.config as Record<string, unknown> | undefined;
          const isDocNode = config?.["outputType"] === "generate_document";
          const hasTemplate = Boolean(config?.["documentTemplatePath"]);
          const isNeverDone = Boolean(config?.["neverDone"]);

          type DocState = "generating" | "no_template" | "failed" | "done" | null;
          const docState: DocState =
            isAdvancingMsg && isDocNode
              ? !hasTemplate
                ? "no_template"
                : msg.documentStatus === "failed"
                ? "failed"
                : msg.document || msg.documentStatus === "complete"
                ? "done"
                : "generating"
              : null;

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
                    {msg.content}
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
                    <MessageInfoModal message={msg} allMessages={dbMessages} />
                  )}
                  {msg.role === "assistant" && canSubmitFeedback && sessionId && (
                    <button
                      type="button"
                      onClick={() => setFixing({ id: msg.id, content: msg.content })}
                      className="mt-1 text-[10px] font-medium text-[#6d6a65] underline-offset-2 hover:text-[#3a5fd9] hover:underline"
                    >
                      Fix this answer
                    </button>
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
            const isCrossChecking =
              isStreaming &&
              msg.role === "assistant" &&
              Boolean(msg.annotations?.some(isCrossCheckingAnnotation));
            const latestPersistedNodeId = [...dbMessages].reverse().find((m) => m.role === "assistant")?.stepNodeId ?? null;
            const streamingNode = latestPersistedNodeId ? nodeById[latestPersistedNodeId] : null;
            const streamingConfig = streamingNode?.config as Record<string, unknown> | undefined;
            const streamingIsNeverDone = Boolean(streamingConfig?.["neverDone"]);

            return (
              <div key={msg.id}>
              <div className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
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
                    {msg.content}
                  </p>
                  {msg.role === "assistant" && !streamingIsNeverDone && (
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
              {isCrossChecking && <CrossCheckingBadge />}
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

      <div ref={bottomRef} />

      {sessionId && fixing && (
        <FixAnswerModal
          open
          onClose={() => setFixing(null)}
          sessionId={sessionId}
          messageId={fixing.id}
          flaggedAnswer={fixing.content}
        />
      )}
    </div>
  );
}
