"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { toast } from "sonner";
import type { FlowEdge, FlowNode } from "@rbrasier/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatActionsMenu } from "@/components/chat/chat-actions-menu";
import { ChatComposer } from "@/components/chat/chat-composer";
import { BranchOverrideModal } from "@/components/chat/branch-override-modal";
import { MessageFeed } from "@/components/chat/message-feed";
import { StepProgressRail } from "@/components/chat/step-progress-rail";
import { topoSortNodes } from "@/lib/flow-utils";
import { trpc } from "@/trpc/client";

const NULL_BRANCH_THRESHOLD = 3;

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
  const searchParams = useSearchParams();
  const isShared = searchParams.get("shared") === "true";

  const utils = trpc.useUtils();
  const sessionQuery = trpc.session.get.useQuery({ sessionId });
  const meQuery = trpc.user.me.useQuery();
  const sessionData = sessionQuery.data;
  const isAdmin = meQuery.data?.isAdmin ?? false;

  const [_regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [overrideOpen, setOverrideOpen] = useState(false);

  const renameMutation = trpc.session.rename.useMutation({
    onSuccess: () => {
      void utils.session.get.invalidate({ sessionId });
      toast.success("Chat renamed");
    },
    onError: (error) => toast.error(error.message),
  });

  const closeMutation = trpc.session.close.useMutation({
    onSuccess: () => {
      toast.success("Chat closed");
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

  const dbMessages = sessionData?.messages ?? [];
  const rawNodes: FlowNode[] = sessionData?.nodes ?? [];
  const edges: FlowEdge[] = sessionData?.edges ?? [];
  const currentNodeId = sessionData?.session.currentNodeId ?? null;

  const nodes = useMemo(() => {
    const edgesAsEdgeLike = edges.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId }));
    return topoSortNodes(rawNodes, edgesAsEdgeLike);
  }, [rawNodes, edges]);

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

  const { messages, input, handleSubmit, isLoading, setInput, error, reload } = useChat({
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
    onError: () => {
      void utils.session.get.invalidate({ sessionId });
    },
  });

  useEffect(() => {
    void utils.session.get.invalidate({ sessionId });
  }, [sessionId, utils.session.get]);

  // Poll while a document is being generated so the spinner resolves automatically.
  // "pending" means generation is in flight; null treated as pending so legacy rows
  // (created before document_status existed) still trigger polling until they
  // resolve one way or the other.
  const hasGeneratingDoc = useMemo(() => {
    return dbMessages.some((msg) => {
      if (msg.role !== "assistant" || (msg.confidence ?? 0) < 90) return false;
      if (msg.stepNodeId === currentNodeId) return false;
      const node = rawNodes.find((n) => n.id === msg.stepNodeId);
      const config = node?.config as Record<string, unknown> | undefined;
      if (config?.["outputType"] !== "generate_document") return false;
      if (!config?.["documentTemplatePath"]) return false;
      if (msg.documentStatus === "complete" || msg.documentStatus === "failed") return false;
      return !msg.document;
    });
  }, [dbMessages, currentNodeId, rawNodes]);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!hasGeneratingDoc) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    pollingRef.current = setInterval(() => {
      void utils.session.get.invalidate({ sessionId });
    }, 3000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [hasGeneratingDoc, sessionId, utils.session.get]);

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
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const newChatUrl = `${origin}/chats?flow=${flow.id}&start=1`;
  const collaborateUrl = `${origin}/chats/${sessionId}?shared=true`;
  const me = meQuery.data;
  const userFirstInitial = me?.name?.trim()?.[0]?.toUpperCase() ?? "U";
  const isFlowDeleted = flow.deletedAt !== null;

  return (
    <main className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] min-w-0 shrink-0 items-center justify-between border-b border-[#dedad2] bg-white px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/chats" className="shrink-0 text-[13px] text-[#5a5650] hover:text-[#1a1814]">
            ← My Chats
          </Link>
          <span className="text-[13px] text-[#dedad2]">|</span>
          <span className="text-[18px]">{flow.icon ?? "💬"}</span>
          <h1 className="truncate text-[13px] font-semibold text-[#1a1814]">
            {session.title ?? flow.name}
          </h1>
          <Badge variant={statusVariant(session.status)} className="shrink-0 capitalize">
            {session.status}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ChatActionsMenu
            sessionTitle={session.title}
            shareUrl={newChatUrl}
            collaborateUrl={collaborateUrl}
            onRename={(title) => renameMutation.mutate({ sessionId, title })}
            onClose={() => closeMutation.mutate({ sessionId })}
            isReadOnly={isShared}
          />
        </div>
      </header>

      <StepProgressRail
        nodes={nodes}
        currentNodeId={session.currentNodeId}
        completedNodeIds={completedNodeIds}
      />

      {isFlowDeleted && (
        <div className="flex justify-center border-b border-[#f5d0a9] bg-[#fdf3e3] px-4 py-2">
          <p className="text-[13px] text-[#c17a1a]">
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
        onRetry={!isShared ? () => void reload() : undefined}
        onRegenerateDocument={!isShared ? handleRegenerateDocument : undefined}
        expertRole={flow.expertRole ?? null}
        userFirstInitial={userFirstInitial}
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
        disabled={isLoading || session.status !== "active" || isFlowDeleted}
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
