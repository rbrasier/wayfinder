"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import type { FlowNode } from "@rbrasier/domain";
import { Badge } from "@/components/ui/badge";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageFeed } from "@/components/chat/message-feed";
import { ShareButton } from "@/components/chat/share-button";
import { StepProgressRail } from "@/components/chat/step-progress-rail";
import { trpc } from "@/trpc/client";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

const statusVariant = (status: string) => {
  if (status === "active") return "default";
  if (status === "complete") return "secondary";
  return "outline";
};

export default function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = use(params);
  const searchParams = useSearchParams();
  const isShared = searchParams.get("shared") === "true";

  const utils = trpc.useUtils();
  const sessionQuery = trpc.session.get.useQuery({ sessionId });
  const sessionData = sessionQuery.data;
  const [_regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());

  const dbMessages = sessionData?.messages ?? [];
  const nodes: FlowNode[] = sessionData?.nodes ?? [];

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
      if (data.maxConfidence >= 90 && nodeId !== sessionData?.session.currentNodeId) {
        completedNodeIds.push(nodeId);
      }
    }
  }

  const { messages, input, handleSubmit, isLoading, setInput } = useChat({
    api: `/api/chat/${sessionId}/stream`,
    initialMessages: dbMessages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      annotations: m.confidence !== null
        ? [{ type: "confidence", score: m.confidence, readyToAdvance: false, missingInformation: [] }]
        : undefined,
    })),
    experimental_prepareRequestBody: ({ messages: msgs }) => ({
      messages: msgs.slice(-20),
    }),
    onFinish: () => {
      void utils.session.get.invalidate({ sessionId });
    },
  });

  useEffect(() => {
    void utils.session.get.invalidate({ sessionId });
  }, [sessionId, utils.session.get]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    handleSubmit();
  };

  const handleRegenerateDocument = useCallback(async (messageId: string) => {
    setRegeneratingIds((prev) => new Set(prev).add(messageId));
    try {
      await fetch(`/api/documents/${messageId}`, { method: "POST" });
      void utils.session.get.invalidate({ sessionId });
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
      <main className="flex h-screen flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-sm">Loading session…</p>
      </main>
    );
  }

  if (!sessionData) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-lg font-medium">Session not found</p>
        <Link href="/chats" className="text-sm text-indigo-600 underline">
          Back to My Chats
        </Link>
      </main>
    );
  }

  const { session, flow } = sessionData;

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b bg-white px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/chats" className="text-sm text-muted-foreground hover:text-foreground">
            ← My Chats
          </Link>
          <span className="text-muted-foreground">|</span>
          <span className="text-xl">{flow.icon ?? "💬"}</span>
          <h1 className="truncate font-semibold text-sm">{flow.name}</h1>
          <Badge variant={statusVariant(session.status)} className="shrink-0 text-xs capitalize">
            {session.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {!isShared && <ShareButton sessionId={sessionId} />}
        </div>
      </header>

      <StepProgressRail
        nodes={nodes}
        currentNodeId={session.currentNodeId}
        completedNodeIds={completedNodeIds}
      />

      <MessageFeed
        dbMessages={dbMessages}
        streamingMessages={messages}
        nodes={nodes}
        isStreaming={isLoading}
        onRegenerateDocument={!isShared ? handleRegenerateDocument : undefined}
      />

      <ChatComposer
        value={input}
        onChange={(v) => setInput(v)}
        onSubmit={handleSend}
        disabled={isLoading || session.status !== "active"}
        readOnly={isShared}
      />
    </main>
  );
}
