"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

type Decision = "approved" | "rejected" | "changes_requested";

function ApprovalRow({ approvalId, sessionId, createdAt }: {
  approvalId: string;
  sessionId: string;
  createdAt: Date;
}) {
  const utils = trpc.useUtils();
  const [comment, setComment] = useState("");
  // Only consulted when rejecting: route the session back to the originator for
  // revision, or close the request outright.
  const [rejectRouteBack, setRejectRouteBack] = useState(true);
  const decide = trpc.approval.decide.useMutation({
    onSuccess: async () => {
      await utils.approval.listPending.invalidate();
      toast.success("Decision recorded");
    },
    onError: (error) => toast.error(error.message ?? "Could not record the decision"),
  });

  const submit = (decision: Decision) =>
    decide.mutate({
      approvalId,
      decision,
      comment: comment.trim() || null,
      routeBack: decision === "rejected" ? rejectRouteBack : undefined,
    });

  return (
    <div
      data-approval-id={approvalId}
      data-approval-status="pending"
      className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-[#dedad2] bg-white p-[16px_18px]"
    >
      <div className="flex items-center gap-[14px]">
        <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#fef3e2] text-[#d97706]">
          <Stamp size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-[#1a1814]">Approval requested</p>
          <p className="mt-[3px] truncate text-[12.5px] text-[#918d87]">
            Raised {new Date(createdAt).toLocaleString()} ·{" "}
            <Link href={`/chats/${sessionId}`} className="font-medium text-[#3a5fd9]">
              Open session
            </Link>
          </p>
        </div>
      </div>

      <Textarea
        aria-label="Decision comment"
        rows={2}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Add a comment (required to request changes)…"
      />

      <fieldset className="flex flex-wrap items-center gap-4" aria-label="On reject">
        <legend className="sr-only">On reject</legend>
        <span className="text-[12.5px] font-medium text-[#918d87]">On reject:</span>
        <label className="flex items-center gap-1.5 text-[12.5px] text-[#1a1814]">
          <input
            type="radio"
            name={`reject-route-${approvalId}`}
            checked={rejectRouteBack}
            onChange={() => setRejectRouteBack(true)}
          />
          Route back to originator
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-[#1a1814]">
          <input
            type="radio"
            name={`reject-route-${approvalId}`}
            checked={!rejectRouteBack}
            onChange={() => setRejectRouteBack(false)}
          />
          Close request
        </label>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => submit("approved")} disabled={decide.isPending}>
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => submit("changes_requested")}
          disabled={decide.isPending || !comment.trim()}
        >
          Request changes
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => submit("rejected")}
          disabled={decide.isPending}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

export function ApprovalsContent() {
  const approvalsQuery = trpc.approval.listPending.useQuery(undefined, {
    refetchOnMount: "always",
  });
  const approvals = approvalsQuery.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#dedad2] bg-white px-5">
        <h1 className="text-[16px] font-bold text-[#1a1814]">Approvals</h1>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="container py-6">
          {approvalsQuery.isLoading ? (
            <p className="text-[13px] text-[#918d87]">Loading…</p>
          ) : approvals.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[#dedad2] bg-white p-8 text-center">
              <p className="text-[14px] font-semibold text-[#1a1814]">No approvals awaiting you</p>
              <p className="mt-1 text-[13px] text-[#918d87]">
                Requests routed to you for sign-off will appear here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {approvals.map((approval) => (
                <ApprovalRow
                  key={approval.id}
                  approvalId={approval.id}
                  sessionId={approval.sessionId}
                  createdAt={approval.createdAt}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
