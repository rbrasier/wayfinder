"use client";

import { useEffect, useRef } from "react";
import type { Message as UIMessage } from "@ai-sdk/react";
import type { FlowNode, SessionMessage } from "@rbrasier/domain";
import { ConfidenceBar } from "./confidence-bar";
import { DocumentCard } from "./document-card";
import { MilestonePill } from "./milestone-pill";

interface ConfidenceAnnotation {
  type: "confidence";
  score: number;
  readyToAdvance: boolean;
  missingInformation: string[];
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
  onRegenerateDocument?: (messageId: string) => void;
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
  onRegenerateDocument,
}: MessageFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dbMessages.length, streamingMessages.length]);

  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const showStreaming = isStreaming || streamingMessages.length > dbMessages.length;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {!showStreaming &&
        dbMessages.map((msg, index) => {
          const prevMsg = dbMessages[index - 1];
          const isNewStep = msg.stepNodeId && prevMsg?.stepNodeId !== msg.stepNodeId && index > 0;
          const node = msg.stepNodeId ? nodeById[msg.stepNodeId] : null;

          const isAdvancingMsg =
            msg.role === "assistant" &&
            msg.confidence !== null &&
            msg.confidence >= 90 &&
            dbMessages[index + 1]?.stepNodeId !== msg.stepNodeId;

          const config = node?.config as Record<string, unknown> | undefined;
          const isDocNode = config?.["outputType"] === "generate_document";
          const hasTemplate = Boolean(config?.["documentTemplatePath"]);

          type DocState = "generating" | "no_template" | "failed" | "done" | null;
          const docState: DocState = isAdvancingMsg && isDocNode
            ? msg.document
              ? "done"
              : hasTemplate
              ? "generating"
              : "no_template"
            : null;

          return (
            <div key={msg.id}>
              {isNewStep && node && (
                <div className="my-2 text-center text-xs text-muted-foreground">
                  — {node.name} —
                </div>
              )}
              <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "border bg-white text-gray-900 shadow-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  <p
                    className={`mt-1 text-right text-[10px] ${
                      msg.role === "user" ? "text-indigo-200" : "text-gray-400"
                    }`}
                  >
                    {formatRelativeTime(msg.createdAt)}
                  </p>
                  {msg.role === "assistant" && (
                    <ConfidenceBar score={msg.confidence} />
                  )}
                </div>
              </div>
              {isAdvancingMsg && node && (
                <>
                  <MilestonePill
                    nodeName={node.name}
                    confidence={msg.confidence ?? 0}
                    documentState={docState}
                    onRegenerate={
                      docState === "generating" && onRegenerateDocument
                        ? () => onRegenerateDocument(msg.id)
                        : undefined
                    }
                  />
                  {msg.document && (
                    <DocumentCard
                      messageId={msg.id}
                      document={msg.document}
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

      {showStreaming &&
        streamingMessages.map((msg) => {
          const confidenceAnnotation = msg.annotations?.map(toConfidenceAnnotation).find(Boolean) ?? null;

          return (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "border bg-white text-gray-900 shadow-sm"
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed">
                  {msg.content || (isStreaming && msg.role === "assistant" ? "…" : "")}
                </p>
                {msg.role === "assistant" && (
                  <ConfidenceBar
                    score={confidenceAnnotation?.score ?? null}
                    evaluating={isStreaming && !confidenceAnnotation}
                  />
                )}
              </div>
            </div>
          );
        })}

      {dbMessages.length === 0 && !isStreaming && (
        <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
          <p>The conversation will begin once you send your first message.</p>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
