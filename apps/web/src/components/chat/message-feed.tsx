"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Message as UIMessage } from "@ai-sdk/react";
import type { FlowNode, SessionMessage } from "@wayfinder/domain";
import { ConfidenceBar } from "./confidence-bar";
import { resolveCrossCheckingState } from "./cross-checking-state";
import { resolveGeneratingDocumentState } from "./generating-document-state";
import { MarkdownText } from "./markdown-text";
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
import {
  decisionVerbPhrase,
  isApprovalGranted,
  parseApprovalDecisionMessage,
} from "@/lib/approval-decision-message";
import { parseApproverEditMessage } from "@/lib/approver-edit-message";
import { formatScheduledResume, parseScheduledMessage } from "@/lib/scheduled-message";
import { resolveApprovalDecisionDocument } from "./approval-decision-document";
import { resolveApproverEditDocument } from "./approver-edit-document";
import { showsDocumentCard, showsEditAffordance } from "./document-card-state";
import { participantInitials, participantTint } from "./participant-identity";
import { streamingTail } from "./streaming-tail";

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
  // The session is parked on an approval node, so a request is out for decision
  // and the author must not be editing what is under review. Hides the edit
  // affordance; the approver's own path from /approvals is unaffected.
  isOnApprovalNode?: boolean;
  onDocumentEdited?: () => void;
  expertRole?: string | null;
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
  // Who is reading. Messages stamped with any other sender render as theirs,
  // on the left, with their own mark.
  currentUserId?: string | null;
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

// Marks the boundary between flow steps in the transcript: a hairline, the step
// name as a mono eyebrow, another hairline.
function FeedDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-[2px]">
      <span className="h-px flex-1 bg-[#e7e3db]" />
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#736d5f]">
        {label}
      </span>
      <span className="h-px flex-1 bg-[#e7e3db]" />
    </div>
  );
}

function AgentMark({ initials }: { initials: string }) {
  return (
    <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] bg-[#2f56d3] text-[11px] font-semibold text-white">
      {initials}
    </div>
  );
}

// Someone else's circular mark. Deliberately not the agent's rounded square:
// the two were indistinguishable enough that an approver's edit read as the
// assistant's work.
function ParticipantMark({ name, seed }: { name: string | null; seed: string }) {
  const { fill, ink } = participantTint(seed);
  return (
    <div
      aria-hidden="true"
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: fill, color: ink }}
    >
      {participantInitials(name)}
    </div>
  );
}

// A message from anyone who is not the viewer — an approver's decision, another
// participant's turn, or a system notice about a person's action. Left-aligned
// with their own mark, so it never reads as the viewer's own message.
function OtherPersonMessage({
  name,
  seed,
  action,
  body,
  at,
  children,
}: {
  name: string | null;
  seed: string;
  // Follows the name in regular weight: "granted approval, with edits."
  action?: string;
  body?: string;
  at: Date;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-[14px]" data-participant-message>
      <ParticipantMark name={name} seed={seed} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-[1.55] text-[#1c1b19]">
          <span className="font-semibold">{name ?? "Someone"}</span>
          {action && <span> {action}</span>}
        </p>
        {body && (
          <p className="mt-[2px] whitespace-pre-wrap text-[14px] leading-[1.55] text-[#3d382f]">
            {`“${body}”`}
          </p>
        )}
        <p data-message-time className="mt-[4px] font-mono text-[10px] text-[#736d5f]">
          {formatRelativeTime(at)}
        </p>
        {children}
      </div>
    </div>
  );
}

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
  isOnApprovalNode,
  onDocumentEdited,
  expertRole,
  senderNamesById,
  awaitingConfirmationNodeId,
  currentNodeId,
  sessionId,
  canSubmitFeedback,
  currentUserId,
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
  // The persisted transcript always renders. Only what the server has not
  // persisted yet is appended from the stream — swapping one list for the other
  // is what made step dividers, timestamps, milestone pills, document cards and
  // approval bubbles disappear for the length of every turn.
  const unpersisted = streamingTail(streamingMessages, dbMessages.length);
  const botInitials = getRoleInitials(expertRole ?? null, "AI");

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      // The conversation reads as a single centred column on the canvas rather
      // than a full-bleed list — long lines are the main legibility cost at
      // desktop widths.
      className="mx-auto flex w-full max-w-[808px] flex-1 flex-col gap-5 overflow-y-auto px-6 pb-2 pt-7"
    >
      {dbMessages.map((msg, index) => {
          const prevMsg = dbMessages[index - 1];
          const isNewStep = msg.stepNodeId && prevMsg?.stepNodeId !== msg.stepNodeId && index > 0;
          const node = msg.stepNodeId ? nodeById[msg.stepNodeId] : null;

          // An approval decision is the approver's own message, and it carries
          // its own attribution: the approver is often not a session
          // participant, so `senderNamesById` cannot name them.
          const decision =
            msg.role === "user" ? parseApprovalDecisionMessage(msg.content) : null;
          const senderName =
            decision?.approverName ??
            (msg.role === "user" && msg.senderUserId
              ? senderNamesById?.[msg.senderUserId] ?? null
              : null);

          const scheduled = msg.role === "system" ? parseScheduledMessage(msg.content) : null;
          const displayContent = scheduled
            ? formatScheduledResume(scheduled.stepName, scheduled.nextFireAt)
            : msg.content;

          // An approver's edit is announced as a system line far below the card
          // it refers to, so the author was told their document had changed and
          // given no way to see what changed. The approver's own queue re-renders
          // the document beside the decision; this does the same for the thread.
          const approverEdit =
            msg.role === "system" ? parseApproverEditMessage(msg.content) : null;
          const approverEditDocument = approverEdit
            ? resolveApproverEditDocument(dbMessages, msg.stepNodeId)
            : null;

          // The document the approver signed, offered again under their note:
          // the only card for it sits on the message that generated it, which
          // by then is above the approval request and out of view.
          const signedDocument =
            decision && isApprovalGranted(decision.outcome)
              ? resolveApprovalDecisionDocument(dbMessages, index)
              : null;

          // A message belongs to someone else when it is stamped with a sender
          // who is not the viewer. An unstamped user message is the viewer's
          // own — that is every message in a single-participant chat, which
          // must keep rendering on the right.
          const isFromOtherPerson =
            msg.role === "user" &&
            Boolean(msg.senderUserId) &&
            Boolean(currentUserId) &&
            msg.senderUserId !== currentUserId;

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

          const showsConfidenceBar = msg.role === "assistant" && !isNeverDone;
          const showsInfoButton = msg.role === "assistant" && Boolean(msg.aiPayload);

          return (
            <div key={msg.id}>
              {isNewStep && node && <FeedDivider label={node.name} />}
              {decision ? (
                // An approver is rarely the viewer, and their decision carries
                // its own attribution — so it always renders as someone else's.
                <OtherPersonMessage
                  name={decision.approverName ?? decision.approverEmail ?? null}
                  seed={decision.approverEmail ?? decision.approverName ?? msg.id}
                  action={decisionVerbPhrase(decision.outcome)}
                  body={decision.body || undefined}
                  at={decision.decidedAt}
                />
              ) : approverEdit ? (
                // The notice is persisted as a system message, so it used to
                // render through the assistant branch and wear the AI's mark —
                // attributing a person's edit to the model.
                <OtherPersonMessage
                  name={approverEdit.editorName}
                  seed={approverEdit.editorName}
                  action={`edited ${approverEdit.changedLabels.join(", ")} before deciding.`}
                  at={msg.createdAt}
                />
              ) : isFromOtherPerson ? (
                <OtherPersonMessage
                  name={senderName}
                  seed={msg.senderUserId ?? msg.id}
                  body={displayContent}
                  at={msg.createdAt}
                />
              ) : msg.role === "user" ? (
                <div className="flex justify-end" data-chat-message="user">
                  <div
                    title={senderName ?? undefined}
                    className="max-w-[460px] rounded-[14px] rounded-br-[4px] bg-[#ebe8e0] px-4 py-3"
                  >
                    <p className="whitespace-pre-wrap text-[14px] leading-[1.5] text-[#1c1b19]">
                      {displayContent}
                    </p>
                    <p
                      data-message-time
                      className="mt-1 text-right font-mono text-[10px] text-[#666055]"
                    >
                      {formatRelativeTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-[14px]" data-chat-message="assistant">
                  <AgentMark initials={botInitials} />
                  <div className="relative min-w-0 flex-1">
                    <MarkdownText
                      content={displayContent}
                      className="text-[14px] leading-[1.6] text-[#26241f]"
                    />
                    <div className="mt-[6px] flex items-center gap-3">
                      <span data-message-time className="font-mono text-[10px] text-[#736d5f]">
                        {formatRelativeTime(msg.createdAt)}
                      </span>
                      {showsConfidenceBar && <ConfidenceBar score={msg.confidence} />}
                      {showsInfoButton && (
                        <MessageInfoModal
                          message={msg}
                          allMessages={dbMessages}
                          sessionId={sessionId}
                          canSubmitFeedback={canSubmitFeedback}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
              {/* Read-only: this is the copy the approver put their name to,
                  offered for download rather than for further editing. The
                  editable card on the generating message is unchanged. */}
              {signedDocument?.document && (
                <DocumentCard
                  messageId={signedDocument.id}
                  document={signedDocument.document}
                  documentGenerationConfidence={
                    signedDocument.aiPayload?.documentGenerationConfidence ?? null
                  }
                  canEdit={false}
                />
              )}
              {/* Read-only: the author is being shown what the approver did,
                  and the record is locked while an approval is pending. */}
              {approverEditDocument?.document && (
                <DocumentCard
                  messageId={approverEditDocument.id}
                  document={approverEditDocument.document}
                  documentGenerationConfidence={
                    approverEditDocument.aiPayload?.documentGenerationConfidence ?? null
                  }
                  canEdit={false}
                />
              )}
              {isAdvancingMsg && node && !isNeverDone && (
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
              )}
              {/* Outside the milestone branch on purpose. The pill asks whether
                  this turn completed a step; the card asks whether this message
                  carries a document — and that answer does not change because a
                  withdrawal brought the session back to the step. */}
              {msg.document && showsDocumentCard({ hasDocument: true, isAdvancing: isAdvancingMsg }) && (
                <DocumentCard
                  messageId={msg.id}
                  document={msg.document}
                  documentGenerationConfidence={msg.aiPayload?.documentGenerationConfidence ?? null}
                  canEdit={showsEditAffordance({
                    canEditDocuments: Boolean(canEditDocuments),
                    allowManualEdit: config?.["allowManualEdit"] !== false,
                    isOnApprovalNode: Boolean(isOnApprovalNode),
                  })}
                  onEdited={onDocumentEdited}
                  onRegenerate={
                    onRegenerateDocument ? () => onRegenerateDocument(msg.id) : undefined
                  }
                />
              )}
              {isAdvancingMsg && node && !isNeverDone && isStructuredNode && (
                <RecordCard
                  messageId={msg.id}
                  canEdit={showsEditAffordance({
                    canEditDocuments: Boolean(canEditDocuments),
                    allowManualEdit: config?.["allowManualEdit"] !== false,
                    isOnApprovalNode: Boolean(isOnApprovalNode),
                  })}
                  onEdited={onDocumentEdited}
                />
              )}
            </div>
          );
        })}

      {unpersisted.length > 0 && (
        <>
          {unpersisted.map((msg) => {
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
              {segments.map((segment, segmentIndex) =>
                msg.role === "user" ? (
                  <div key={segmentIndex} className="flex justify-end" data-chat-message="user">
                    <div className="max-w-[460px] rounded-[14px] rounded-br-[4px] bg-[#ebe8e0] px-4 py-3">
                      <p className="whitespace-pre-wrap text-[14px] leading-[1.5] text-[#1c1b19]">
                        {segment}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div key={segmentIndex} className="flex gap-[14px]" data-chat-message="assistant">
                    <AgentMark initials={botInitials} />
                    <div className="min-w-0 flex-1">
                      <MarkdownText
                        content={segment}
                        className="text-[14px] leading-[1.6] text-[#26241f]"
                      />
                      {segmentIndex === 0 && !streamingIsNeverDone && (
                        <ConfidenceBar
                          score={confidenceAnnotation?.score ?? null}
                          evaluating={isStreaming && !confidenceAnnotation}
                        />
                      )}
                    </div>
                  </div>
                ),
              )}
              {isCrossChecking && <CrossCheckingBadge documents={crossCheckingState.documents} />}
              {isGeneratingDocument && <GeneratingDocumentBadge />}
              </div>
            );
          })}
        </>
      )}

      {/* Outside the delta block: at the instant a turn starts the client list
          has not grown yet, and a typing indicator that blinks out on the first
          frame reads as a dropped message. */}
      {isStreaming && streamingMessages.at(-1)?.role !== "assistant" && (
        <div className="flex gap-[14px]">
          <AgentMark initials={botInitials} />
          <div className="flex items-center">
            <TypingIndicator />
          </div>
        </div>
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
        <div className="flex flex-1 items-center justify-center text-center text-[13px] text-[#666055]">
          <p>The conversation will begin once you send your first message.</p>
        </div>
      )}
    </div>
  );
}
