"use client";

import { useState } from "react";
import type { Flow } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { CardSkeletonGrid } from "@/components/skeleton/card-skeleton";
import { NewChatModal } from "@/components/chat/new-chat-modal";
import { SessionCard } from "@/components/chat/session-card";
import { trpc } from "@/trpc/client";

type Tab = "active" | "complete" | "all";

export function ChatsContent() {
  const [tab, setTab] = useState<Tab>("active");
  const [newChatOpen, setNewChatOpen] = useState(false);

  const sessionsQuery = trpc.session.list.useQuery(undefined, { refetchOnMount: "always" });
  const publishedFlowsQuery = trpc.session.listPublishedFlows.useQuery();

  const flowById = Object.fromEntries(
    (publishedFlowsQuery.data ?? []).map((f: Flow) => [f.id, f]),
  );

  const sessions = sessionsQuery.data ?? [];

  const filtered = sessions.filter((s) => {
    if (tab === "active") return s.status === "active";
    if (tab === "complete") return s.status === "complete";
    return true;
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "complete", label: "Completed" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#dedad2] bg-white pl-5 pr-[52px]">
        <h1 className="text-[16px] font-bold tracking-[-0.3px] text-[#1a1814]">My Chats</h1>
        <Button onClick={() => setNewChatOpen(true)}>New Chat</Button>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-[#dedad2] px-5">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-[10px] text-[13px] font-medium transition-colors ${
              tab === key
                ? "border-b-2 border-[#3a5fd9] text-[#3a5fd9]"
                : "text-[#6d6a65] hover:text-[#5a5650]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="container py-6">
          {sessionsQuery.isLoading ? (
            <CardSkeletonGrid count={3} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="💬"
              heading="No chats yet"
              body="Start a new chat to begin a guided workflow session."
              ctaLabel="New Chat"
              onCta={() => setNewChatOpen(true)}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  flow={flowById[session.flowId]}
                  stepInfo={session.stepInfo ?? null}
                  lastMessage={session.lastMessage ?? null}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <NewChatModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        publishedFlows={publishedFlowsQuery.data ?? []}
      />
    </div>
  );
}
