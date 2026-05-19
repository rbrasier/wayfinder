"use client";

import { useState } from "react";
import type { Flow } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { NewChatModal } from "@/components/chat/new-chat-modal";
import { SessionCard } from "@/components/chat/session-card";
import { trpc } from "@/trpc/client";

type Tab = "active" | "complete" | "all";

export default function ChatsPage() {
  const [tab, setTab] = useState<Tab>("active");
  const [newChatOpen, setNewChatOpen] = useState(false);

  const sessionsQuery = trpc.session.list.useQuery();
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
    <main className="container py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Chats</h1>
        <Button onClick={() => setNewChatOpen(true)}>New Chat</Button>
      </div>

      <div className="mb-6 flex gap-1 border-b">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {sessionsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-24 text-center text-muted-foreground">
          <p className="text-lg font-medium">No sessions yet</p>
          <p className="text-sm">Start a new chat to begin a guided workflow session.</p>
          <Button onClick={() => setNewChatOpen(true)}>New Chat</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              flow={flowById[session.flowId]}
            />
          ))}
        </div>
      )}

      <NewChatModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        publishedFlows={publishedFlowsQuery.data ?? []}
      />
    </main>
  );
}
