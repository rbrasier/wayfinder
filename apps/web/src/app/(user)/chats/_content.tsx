"use client";

import { useState } from "react";
import type { Flow } from "@wayfinder/domain";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { CardSkeletonGrid } from "@/components/skeleton/card-skeleton";
import { NewChatModal } from "@/components/chat/new-chat-modal";
import { SessionCard } from "@/components/chat/session-card";
import { AppHeader } from "@/components/layout/app-header";
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
      <AppHeader
        title="My Chats"
        actions={
          <Button size="sm" onClick={() => setNewChatOpen(true)}>
            New chat
          </Button>
        }
      />

      <div className="flex shrink-0 gap-1 border-b border-[#e7e3db] px-5">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-[10px] text-[13px] font-medium transition-colors ${
              tab === key
                ? "border-b-2 border-[#2f56d3] text-[#2f56d3]"
                : "text-[#666055] hover:text-[#5c574c]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="container py-6">
          {sessionsQuery.isPending ? (
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
