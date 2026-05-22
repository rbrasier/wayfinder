"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { toast } from "sonner";
import type { FlowEdge, FlowNode } from "@rbrasier/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/chat/chat-composer";
import { BranchOverrideModal } from "@/components/chat/branch-override-modal";
import { MessageFeed } from "@/components/chat/message-feed";
import { ShareButton } from "@/components/chat/share-button";
import { StepProgressRail } from "@/components/chat/step-progress-rail";
import { trpc } from "@/trpc/client";

const NULL_BRANCH_THRESHOLD = 3;

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

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

export default function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = use(params);
  const searchParams = useSearchParams();
  const isShared = searchParams.get("shared") === "true";

  const utils = trpc.useUtils();
  const sessionQuery = trpc.session.get.useQuery({ sessionId });
  const meQuery = trpc.user.me.useQuery();
  const sessionData = sessionQuery.data;
  const isAdmin = meQuery.data?.isAdmin ?? false;

  const [_regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [overrideOpen, setOverrideOpen] = useState(false);

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

  const dbMessages = sessionData?.messages ?? [];
  const nodes: FlowNode[] = sessionData?.nodes ?? [];
  const edges: FlowEdge[] = sessionData?.edges ?? [];
  const currentNodeId = sessionData?.session.currentNodeId ?? null;

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

  const stallCount = countStalls(dbMessages, currentNodeId, edges);
  const showBranchOverride = isAdmin && !isShared && stallCount >= NULL_BRANCH_THRESHOLD;

  const outgoingBranches = edges
    .filter((e) => e.fromNodeId === currentNodeId)
    .map((e) => {
      const node = nodes.find((n) => n.id === e.toNodeId);
      return { nodeId: e.toNodeId, nodeName: node?.name ?? e.toNodeId };
    });

  const { messages, input, handleSubmit, isLoading, setInput } = useChat({
    api: `/api/chat/${sessionId}/stream`,
    initialMessages: dbMessages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      annotations: m.confidence !== null
        ? [{ type: "confidence", score: m.confidence }]
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
      <main className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-[13px] text-[#918d87]">Loading session…</p>
      </main>
    );
  }

  if (!sessionData) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-[14px] font-semibold text-[#1a1814]">Session not found</p>
        <Link href="/chats" className="text-[13px] text-[#3a5fd9] underline">
          Back to My Chats
        </Link>
      </main>
    );
  }

  const { session, flow } = sessionData;

  return (
    <main className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] min-w-0 shrink-0 items-center justify-between border-b border-[#dedad2] bg-white px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/chats" className="shrink-0 text-[13px] text-[#5a5650] hover:text-[#1a1814]">
            ← My Chats
          </Link>
          <span className="text-[13px] text-[#dedad2]">|</span>
          <span className="text-[18px]">{flow.icon ?? "💬"}</span>
          <h1 className="truncate text-[13px] font-semibold text-[#1a1814]">{flow.name}</h1>
          <Badge variant={statusVariant(session.status)} className="shrink-0 capitalize">
            {session.status}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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

      {showBranchOverride && (
        <div className="flex justify-center border-t border-[#dedad2] bg-[#fdf3e3] px-4 py-3">
          <div className="flex items-center gap-3">
            <p className="text-[13px] text-[#c17a1a]">Wayfinder could not determine the next step.</p>
            <Button size="sm" variant="secondary" onClick={() => setOverrideOpen(true)}>
              Pick a step manually
            </Button>
          </div>
        </div>
      )}

      <ChatComposer
        value={input}
        onChange={(v) => setInput(v)}
        onSubmit={handleSend}
        disabled={isLoading || session.status !== "active"}
        readOnly={isShared}
      />

      <BranchOverrideModal
        open={overrideOpen}
        branches={outgoingBranches}
        onSelect={(targetNodeId) =>
          overrideMutation.mutate({ sessionId, targetNodeId })
        }
        onClose={() => setOverrideOpen(false)}
        isPending={overrideMutation.isPending}
      />
    </main>
  );
}
