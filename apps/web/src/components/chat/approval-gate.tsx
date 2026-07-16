"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, Mail, Stamp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

interface ApprovalGateProps {
  sessionId: string;
  flowId: string;
  flowName: string;
  nodeId: string;
  instructions: string | null;
  // The policy-named approver role authored on the node, shown to the operator
  // so they know who the request is meant for before confirming.
  roleHint: string | null;
}

interface ChosenApprover {
  userId: string | null;
  email: string;
  label: string;
}

// Operator-facing gate shown when a session is parked on an approval node. It
// raises (or loads) the pending request, shows the suggested approver, and lets
// the operator confirm or pick "Someone else" before the request is sent.
export function ApprovalGate({ sessionId, flowId, flowName, nodeId, instructions, roleHint }: ApprovalGateProps) {
  const utils = trpc.useUtils();
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ChosenApprover | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus the approver search box when the operator reveals it (replaces
  // autoFocus, forbidden by jsx-a11y/no-autofocus). Gated on showSearch so it
  // fires only in response to the user toggling search open.
  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  // When email cannot be delivered the operator must notify the approver by hand,
  // so the confirm action only records the approver and surfaces manual options.
  const emailStatusQuery = trpc.approval.emailStatus.useQuery();
  const emailConfigured = emailStatusQuery.data?.configured ?? true;

  const suggest = trpc.approval.suggest.useMutation({
    onSuccess: (data) => {
      setApprovalId(data.approval.id);
      if (data.approval.approverUserId || data.approval.approverEmail) {
        setSent(true);
        const email = data.approval.approverEmail ?? data.suggestedApprover?.email ?? null;
        setSentTo(email ?? data.suggestedApprover?.name ?? "the approver");
        setSentToEmail(email);
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
      setSentToEmail(chosen?.email ?? null);
      await utils.session.get.invalidate({ sessionId });
      toast.success(emailConfigured ? "Approval request sent" : "Approver confirmed");
    },
    onError: (error) => toast.error(error.message ?? "Could not record the request"),
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

  const approvalUrl = typeof window !== "undefined" ? `${window.location.origin}/approvals` : "/approvals";

  const buildMailtoHref = (email: string): string => {
    const subject = `Approval needed: '${flowName}'`;
    const body = [
      `You've been asked to approve a step in the '${flowName}' workflow.`,
      ...(instructions ? ["", instructions] : []),
      "",
      "Review and record your decision here:",
      approvalUrl,
    ].join("\n");
    return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const copyApprovalLink = async () => {
    try {
      await navigator.clipboard.writeText(approvalUrl);
      toast.success("Approval link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  // Until the initial suggest resolves we cannot tell whether the request is
  // already sent or still needs an approver, so show a loading state rather than
  // flashing the empty confirm form (which makes a re-opened session feel as if
  // the approver must be re-entered).
  const requestResolved = suggest.isSuccess || suggest.isError;
  if (!requestResolved) {
    return (
      <div className="border-t border-[#dedad2] bg-[#fffaf2] px-5 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2 text-[13px] text-[#6d6a65]">
          <Loader2 className="h-4 w-4 animate-spin text-[#a65b05]" />
          Loading approval…
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="border-t border-[#dedad2] bg-[#fef3e2] px-5 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <div className="flex items-center gap-3">
            <Stamp className="h-5 w-5 text-[#a65b05]" />
            <p className="text-[13px] text-[#92400e]">
              {emailConfigured ? (
                <>
                  Awaiting approval — sent to <span className="font-medium">{sentTo}</span>.
                </>
              ) : (
                <>
                  Awaiting approval from <span className="font-medium">{sentTo}</span>. Email isn&apos;t
                  configured, so send the request manually.
                </>
              )}
            </p>
          </div>

          {!emailConfigured && (
            <div className="flex flex-wrap gap-2">
              {sentToEmail && (
                <Button asChild size="sm">
                  <a href={buildMailtoHref(sentToEmail)}>
                    <Mail className="h-4 w-4" />
                    Email approver
                  </a>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={copyApprovalLink}>
                <Copy className="h-4 w-4" />
                Copy approval link
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-[#dedad2] bg-[#fffaf2] px-5 py-4" data-approval-gate>
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <div className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-[#a65b05]" />
          <p className="text-[14px] font-semibold text-[#1a1814]">Confirm the approver</p>
        </div>
        {instructions && <p className="text-[13px] text-[#5a5650]">{instructions}</p>}

        {roleHint && (
          <p className="text-[13px] text-[#5a5650]">
            Suggested role: <span className="font-medium text-[#1a1814]">{roleHint}</span>
          </p>
        )}

        <div className="rounded-[10px] border border-[#e8d4b0] bg-white px-3 py-2">
          {chosen ? (
            <p className="text-[13px] text-[#1a1814]">
              Suggested: <span className="font-medium">{chosen.label}</span>
              {chosen.email && chosen.label !== chosen.email && (
                <span className="text-[#6d6a65]"> ({chosen.email})</span>
              )}
            </p>
          ) : (
            <p className="text-[13px] text-[#6d6a65]">
              {suggest.isPending ? "Resolving a suggestion…" : "No suggestion — choose someone."}
            </p>
          )}
        </div>

        {!emailConfigured && (
          <p className="text-[12.5px] text-[#92400e]">
            Email isn&apos;t configured. Confirm the approver, then send them the request manually.
          </p>
        )}

        {showSearch && (
          <div className="space-y-2 rounded-[10px] border border-[#dedad2] bg-white p-3">
            <Input
              ref={searchInputRef}
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
                  <span className="ml-2 shrink-0 text-[11px] uppercase text-[#6d6a65]">
                    {person.source}
                  </span>
                </button>
              ))}
              {searchQuery.data?.length === 0 && query.trim().length > 1 && (
                <p className="px-2 py-1 text-[12px] text-[#6d6a65]">No matches.</p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={send} disabled={!chosen || confirmAndSend.isPending}>
            {emailConfigured ? "Confirm & send" : "Confirm"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowSearch((open) => !open)}>
            Someone else
          </Button>
        </div>
      </div>
    </div>
  );
}
