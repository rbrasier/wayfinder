"use client";

import { useEffect, useState } from "react";
import { Stamp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

interface ApprovalGateProps {
  sessionId: string;
  flowId: string;
  nodeId: string;
  instructions: string | null;
}

interface ChosenApprover {
  userId: string | null;
  email: string;
  label: string;
}

// Operator-facing gate shown when a session is parked on an approval node. It
// raises (or loads) the pending request, shows the suggested approver, and lets
// the operator confirm or pick "Someone else" before the request is sent.
export function ApprovalGate({ sessionId, flowId, nodeId, instructions }: ApprovalGateProps) {
  const utils = trpc.useUtils();
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ChosenApprover | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");

  const suggest = trpc.approval.suggest.useMutation({
    onSuccess: (data) => {
      setApprovalId(data.approval.id);
      if (data.approval.approverUserId || data.approval.approverEmail) {
        setSent(true);
        setSentTo(data.approval.approverEmail ?? data.suggestedApprover?.email ?? "the approver");
        return;
      }
      if (data.suggestedApprover) {
        setChosen({
          userId: data.suggestedApprover.userId,
          email: data.suggestedApprover.email,
          label: data.suggestedApprover.name ?? data.suggestedApprover.email,
        });
      }
    },
  });

  // Raise/load the pending request once when the gate mounts for this node.
  const suggestMutate = suggest.mutate;
  useEffect(() => {
    suggestMutate({ sessionId, flowId, nodeId });
  }, [sessionId, flowId, nodeId, suggestMutate]);

  const searchQuery = trpc.people.search.useQuery(
    { query, limit: 8 },
    { enabled: showSearch && query.trim().length > 1 },
  );

  const suggestedUserId = suggest.data?.suggestedApprover?.userId ?? null;

  const confirmAndSend = trpc.approval.confirmAndSend.useMutation({
    onSuccess: async () => {
      setSent(true);
      setSentTo(chosen?.label ?? "the approver");
      await utils.session.get.invalidate({ sessionId });
      toast.success("Approval request sent");
    },
    onError: (error) => toast.error(error.message ?? "Could not send the request"),
  });

  const send = () => {
    if (!approvalId || !chosen) return;
    const isOverride = chosen.userId === null || chosen.userId !== suggestedUserId;
    confirmAndSend.mutate({
      approvalId,
      approverUserId: chosen.userId,
      approverEmail: chosen.userId ? null : chosen.email,
      isOverride,
    });
  };

  if (sent) {
    return (
      <div className="border-t border-[#dedad2] bg-[#fef3e2] px-5 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Stamp className="h-5 w-5 text-[#d97706]" />
          <p className="text-[13px] text-[#92400e]">
            Awaiting approval — sent to <span className="font-medium">{sentTo}</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-[#dedad2] bg-[#fffaf2] px-5 py-4" data-approval-gate>
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <div className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-[#d97706]" />
          <p className="text-[14px] font-semibold text-[#1a1814]">Confirm the approver</p>
        </div>
        {instructions && <p className="text-[13px] text-[#5a5650]">{instructions}</p>}

        <div className="rounded-[10px] border border-[#e8d4b0] bg-white px-3 py-2">
          {chosen ? (
            <p className="text-[13px] text-[#1a1814]">
              Suggested: <span className="font-medium">{chosen.label}</span>
              {chosen.email && chosen.label !== chosen.email && (
                <span className="text-[#918d87]"> ({chosen.email})</span>
              )}
            </p>
          ) : (
            <p className="text-[13px] text-[#918d87]">
              {suggest.isPending ? "Resolving a suggestion…" : "No suggestion — choose someone."}
            </p>
          )}
        </div>

        {showSearch && (
          <div className="space-y-2 rounded-[10px] border border-[#dedad2] bg-white p-3">
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Entra, HR, or type any email…"
            />
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {(searchQuery.data ?? []).map((person) => (
                <button
                  key={`${person.source}:${person.email}`}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-[#1a1814] hover:bg-[#f7f6f3]"
                  onClick={() => {
                    setChosen({
                      userId: person.userId,
                      email: person.email,
                      label: person.displayName ?? person.email,
                    });
                    setShowSearch(false);
                  }}
                >
                  <span className="truncate">{person.displayName ?? person.email}</span>
                  <span className="ml-2 shrink-0 text-[11px] uppercase text-[#918d87]">
                    {person.source}
                  </span>
                </button>
              ))}
              {searchQuery.data?.length === 0 && query.trim().length > 1 && (
                <p className="px-2 py-1 text-[12px] text-[#918d87]">No matches.</p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={send} disabled={!chosen || confirmAndSend.isPending}>
            Confirm &amp; send
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowSearch((open) => !open)}>
            Someone else
          </Button>
        </div>
      </div>
    </div>
  );
}
