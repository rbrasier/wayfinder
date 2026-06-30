"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Mail, Stamp } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentCard } from "@/components/chat/document-card";
import { trpc } from "@/trpc/client";

type Decision = "approved" | "rejected" | "changes_requested";
type PendingApproval = inferRouterOutputs<AppRouter>["approval"]["listPending"][number];
type StepField = NonNullable<NonNullable<PendingApproval["previousStep"]>["fields"]>[number];

const DECISION_TITLE: Record<Decision, string> = {
  approved: "Approve request",
  rejected: "Reject request",
  changes_requested: "Request changes",
};

function StepFields({ fields }: { fields: StepField[] }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#dedad2] bg-white">
      <table className="w-full text-[12.5px]">
        <tbody>
          {fields.map((field) => (
            <tr key={field.key} className="border-b border-[#efede8] last:border-0">
              <td className="w-2/5 px-3 py-1.5 align-top font-medium text-[#6d6a65]">{field.label}</td>
              <td className="px-3 py-1.5 align-top whitespace-pre-wrap text-[#1a1814]">{field.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviousStep({ previousStep }: { previousStep: PendingApproval["previousStep"] }) {
  if (!previousStep) return null;
  const { document, fields, stepName } = previousStep;

  return (
    <div className="rounded-[12px] bg-[#f7f6f3] p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6d6a65]">
        {stepName}
      </p>
      {document ? (
        <DocumentCard
          messageId={document.messageId}
          document={document.document}
          documentGenerationConfidence={document.documentGenerationConfidence}
          canEdit={false}
        />
      ) : fields && fields.length > 0 ? (
        <StepFields fields={fields} />
      ) : (
        <p className="text-[12.5px] text-[#6d6a65]">No preview available for this step.</p>
      )}
    </div>
  );
}

function DecisionModal({
  approval,
  decision,
  emailConfigured,
  onClose,
}: {
  approval: PendingApproval;
  decision: Decision;
  emailConfigured: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [comment, setComment] = useState("");
  const commentRef = useRef<HTMLTextAreaElement>(null);
  // Set once a decision is recorded but email could not deliver it, so the
  // approver can notify the originator by hand before the row clears.
  const [manualNotify, setManualNotify] = useState(false);

  const sessionUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/chats/${approval.sessionId}`
      : `/chats/${approval.sessionId}`;

  const decide = trpc.approval.decide.useMutation({
    onSuccess: async () => {
      if (emailConfigured) {
        await utils.approval.listPending.invalidate();
        toast.success("Decision recorded");
        onClose();
        return;
      }
      // Keep the modal open so the manual-notify buttons stay mounted; the list
      // is only refreshed when the approver closes.
      setManualNotify(true);
    },
    onError: (error) => toast.error(error.message ?? "Could not record the decision"),
  });

  const submit = (routeBack?: boolean) =>
    decide.mutate({
      approvalId: approval.approval.id,
      decision,
      comment: comment.trim() || null,
      routeBack: decision === "rejected" ? routeBack : undefined,
    });

  const close = async () => {
    if (manualNotify) await utils.approval.listPending.invalidate();
    onClose();
  };

  const buildMailtoHref = (): string => {
    const subject = `Re: your '${approval.chatName}' request`;
    const summary =
      decision === "approved"
        ? "has been approved"
        : decision === "changes_requested"
          ? "needs changes"
          : "has been rejected";
    const body = [
      `Your request "${approval.chatName}" ${summary}.`,
      ...(comment.trim() ? ["", comment.trim()] : []),
      "",
      "View the session here:",
      sessionUrl,
    ].join("\n");
    return `mailto:${encodeURIComponent(approval.originatorEmail ?? "")}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(sessionUrl);
      toast.success("Session link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const commentRequired = decision === "changes_requested";

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : void close())}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          // Focus the comment field instead of the dialog's first focusable
          // element. Replaces autoFocus (jsx-a11y/no-autofocus) without ceding
          // focus management away from Radix's focus trap.
          if (commentRef.current) {
            event.preventDefault();
            commentRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{DECISION_TITLE[decision]}</DialogTitle>
          <DialogDescription>
            {manualNotify
              ? "Email isn't configured, so let the originator know manually."
              : `For "${approval.chatName}"${
                  approval.originatorName ? ` from ${approval.originatorName}` : ""
                }.`}
          </DialogDescription>
        </DialogHeader>

        {manualNotify ? (
          <DialogBody>
            <p className="text-[13px] text-[#5a5650]">
              The decision was recorded and is shown in the session. Notify{" "}
              <span className="font-medium">{approval.originatorName ?? "the originator"}</span> so
              they can pick the request back up.
            </p>
            <div className="flex flex-wrap gap-2">
              {approval.originatorEmail && (
                <Button asChild size="sm">
                  <a href={buildMailtoHref()}>
                    <Mail className="h-4 w-4" />
                    Email user
                  </a>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={copyLink}>
                <Copy className="h-4 w-4" />
                Copy link
              </Button>
            </div>
          </DialogBody>
        ) : (
          <DialogBody>
            <Textarea
              ref={commentRef}
              aria-label="Decision comment"
              rows={3}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={
                commentRequired
                  ? "Describe the changes needed (required)…"
                  : "Add a comment (optional)…"
              }
            />
          </DialogBody>
        )}

        <DialogFooter>
          {manualNotify ? (
            <Button size="sm" onClick={() => void close()}>
              Done
            </Button>
          ) : decision === "rejected" ? (
            <>
              <Button size="sm" variant="outline" onClick={() => submit(false)} disabled={decide.isPending}>
                Close request
              </Button>
              <Button size="sm" onClick={() => submit(true)} disabled={decide.isPending}>
                Route back to user
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => submit()}
              disabled={decide.isPending || (commentRequired && !comment.trim())}
            >
              {decision === "approved" ? "Confirm approval" : "Request changes"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalRow({
  approval,
  emailConfigured,
}: {
  approval: PendingApproval;
  emailConfigured: boolean;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);

  return (
    <div
      data-approval-id={approval.approval.id}
      data-approval-status="pending"
      className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-[#dedad2] bg-white p-[16px_18px]"
    >
      <div className="flex items-center gap-[14px]">
        <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#fef3e2] text-[#a65b05]">
          <Stamp size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-[#1a1814]">{approval.chatName}</p>
          <p className="mt-[3px] truncate text-[12.5px] text-[#6d6a65]">
            {approval.originatorName ? <>From {approval.originatorName} · </> : null}
            Raised {new Date(approval.approval.createdAt).toLocaleString()} ·{" "}
            <Link href={`/chats/${approval.sessionId}`} className="font-medium text-[#3a5fd9]">
              Open session
            </Link>
          </p>
        </div>
      </div>

      <PreviousStep previousStep={approval.previousStep} />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setDecision("approved")}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDecision("changes_requested")}>
          Request changes
        </Button>
        <Button size="sm" variant="danger" onClick={() => setDecision("rejected")}>
          Reject
        </Button>
      </div>

      {decision && (
        <DecisionModal
          approval={approval}
          decision={decision}
          emailConfigured={emailConfigured}
          onClose={() => setDecision(null)}
        />
      )}
    </div>
  );
}

export function ApprovalsContent() {
  const approvalsQuery = trpc.approval.listPending.useQuery(undefined, {
    refetchOnMount: "always",
  });
  const emailStatusQuery = trpc.approval.emailStatus.useQuery();
  const emailConfigured = emailStatusQuery.data?.configured ?? true;
  const approvals = approvalsQuery.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#dedad2] bg-white px-5">
        <h1 className="text-[16px] font-bold text-[#1a1814]">Approvals</h1>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="container py-6">
          {approvalsQuery.isLoading ? (
            <p className="text-[13px] text-[#6d6a65]">Loading…</p>
          ) : approvals.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[#dedad2] bg-white p-8 text-center">
              <p className="text-[14px] font-semibold text-[#1a1814]">No approvals awaiting you</p>
              <p className="mt-1 text-[13px] text-[#6d6a65]">
                Requests routed to you for sign-off will appear here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {approvals.map((approval) => (
                <ApprovalRow
                  key={approval.approval.id}
                  approval={approval}
                  emailConfigured={emailConfigured}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
