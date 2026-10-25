"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, Mail } from "lucide-react";
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
import { ApproverPicker } from "@/components/chat/approver-picker";
import { trpc } from "@/trpc/client";
import {
  ApprovalSubject,
  ApproverStage,
  PreviousStep,
  RequestMessage,
  type ApprovalContext,
} from "./approval-parts";

const SCROLLING_BODY = "min-h-0 flex-1 overflow-y-auto";

type Decision = "approved" | "rejected" | "changes_requested";
type DecideOutput = inferRouterOutputs<AppRouter>["approval"]["decide"];
type NextApproval = DecideOutput["nextApproval"];
type NotifyTarget = DecideOutput["notifyTargets"][number];

const DECISION_TITLE: Record<Decision, string> = {
  approved: "Approve request",
  rejected: "Reject request",
  changes_requested: "Request changes",
};

const DECISION_SUMMARY: Record<Decision, string> = {
  approved: "has been approved",
  rejected: "has been rejected",
  changes_requested: "needs changes",
};

// What to call the people being named, given why they were chosen. "Notify the
// next approver" and "notify the participants" are different instructions, and
// a modal that says neither is what named the wrong person to begin with.
const NOTIFY_LEAD: Record<NotifyTarget["reason"], string> = {
  next_approver: "This now needs their sign-off",
  participant: "They are working on this session",
  originator: "They raised this session",
};

const targetLabel = (target: NotifyTarget): string =>
  target.name ?? target.email ?? "the next person";

export function DecisionModal({
  approval,
  decision,
  emailConfigured,
  onClose,
}: {
  approval: ApprovalContext;
  decision: Decision;
  emailConfigured: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [comment, setComment] = useState("");
  const commentRef = useRef<HTMLTextAreaElement>(null);
  // Set once a decision is recorded but email could not deliver it, so the
  // approver can pass it on by hand before the row clears.
  const [manualNotify, setManualNotify] = useState(false);
  const [notifyTargets, setNotifyTargets] = useState<NotifyTarget[]>([]);
  // Set when the decision advanced the session onto another approval step. The
  // approver nominates who signs next without leaving the page — a chained
  // approval otherwise sits idle until the originator reopens the session.
  const [nextApproval, setNextApproval] = useState<NextApproval>(null);

  const sessionUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/chats/${approval.sessionId}`
      : `/chats/${approval.sessionId}`;

  const decide = trpc.approval.decide.useMutation({
    onSuccess: async (data) => {
      setNotifyTargets(data.notifyTargets);
      // Handing the next approval straight back to the approver takes priority
      // over closing: they are the one person currently looking at this
      // request, and nobody else can move it forward until it is routed.
      if (data.nextApproval) {
        toast.success("Decision recorded");
        setNextApproval(data.nextApproval);
        return;
      }
      if (emailConfigured) {
        await utils.approval.listPending.invalidate();
        await utils.approval.list.invalidate();
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
    if (manualNotify || nextApproval) {
      await utils.approval.listPending.invalidate();
      await utils.approval.list.invalidate();
    }
    onClose();
  };

  const buildMailtoHref = (email: string): string => {
    const subject = `Re: your '${approval.chatName}' request`;
    const body = [
      `Your request "${approval.chatName}" ${DECISION_SUMMARY[decision]}.`,
      ...(comment.trim() ? ["", comment.trim()] : []),
      "",
      "View the session here:",
      sessionUrl,
    ].join("\n");
    return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
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

  const notifyBody = (
    <DialogBody className={SCROLLING_BODY}>
      {notifyTargets.length === 0 ? (
        <p className="text-[13px] text-[#5c574c]">
          The decision was recorded and is shown in the session. There is no one else to notify —
          share the link if someone needs to see it.
        </p>
      ) : (
        <>
          <p className="text-[13px] text-[#5c574c]">
            The decision was recorded and is shown in the session. Let{" "}
            <span className="font-medium">{notifyTargets.map(targetLabel).join(", ")}</span> know so
            the request can be picked up.
          </p>
          <ul className="space-y-2" data-notify-targets>
            {notifyTargets.map((target) => (
              <li
                key={target.userId ?? target.email ?? targetLabel(target)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#e7e3db] bg-white px-3 py-2"
              >
                <span className="min-w-0 text-[12.5px] text-[#1c1b19]">
                  <span className="font-medium">{targetLabel(target)}</span>
                  <span className="text-[#666055]"> · {NOTIFY_LEAD[target.reason]}</span>
                </span>
                {target.email && (
                  <Button asChild size="sm">
                    <a href={buildMailtoHref(target.email)}>
                      <Mail className="h-4 w-4" />
                      Email
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={copyLink}>
          <Copy className="h-4 w-4" />
          Copy link
        </Button>
      </div>
    </DialogBody>
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : void close())}>
      {/* Capped to the screen with only the body scrolling, so a long subject
          or document never pushes the decision buttons out of reach. */}
      <DialogContent
        className="flex max-h-[90vh] flex-col"
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
          <DialogTitle>
            {nextApproval ? "Choose the next approver" : DECISION_TITLE[decision]}
          </DialogTitle>
          <DialogDescription>
            {nextApproval
              ? `Your decision is recorded. "${approval.chatName}" now needs ${nextApproval.nodeName}.`
              : manualNotify
                ? "Email isn't configured, so pass the decision on manually."
                : `For "${approval.chatName}"${
                    approval.originatorName ? ` from ${approval.originatorName}` : ""
                  }.`}
          </DialogDescription>
        </DialogHeader>

        {nextApproval ? (
          <DialogBody className={SCROLLING_BODY}>
            <ApproverPicker
              sessionId={approval.sessionId}
              flowId={approval.approval.flowId}
              flowName={approval.chatName}
              nodeId={nextApproval.nodeId}
              nodeName={nextApproval.nodeName}
              approverSource={nextApproval.approverSource}
              instructions={nextApproval.instructions}
              roleHint={nextApproval.roleHint}
              emailConfigured={emailConfigured}
            />
          </DialogBody>
        ) : manualNotify ? (
          notifyBody
        ) : (
          <DialogBody className={SCROLLING_BODY}>
            {/* The same three things the chat gate shows before a request is
                sent: which signature this is, what is being signed, and the
                artefact itself. Deciding from a bare comment box meant scrolling
                back to the row behind the modal to recall any of it. */}
            <ApproverStage approval={approval} />
            <ApprovalSubject description={approval.subjectDescription} />

            <RequestMessage
              message={approval.approval.requestMessage}
              originatorName={approval.originatorName}
            />
            {/* Editable here: their approval is still pending, and fixing a
                typo beats sending the whole thing back (ADR-045 §5). */}
            <PreviousStep previousStep={approval.previousStep} canEdit />
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
          {nextApproval || manualNotify ? (
            <Button
              size="sm"
              variant={nextApproval ? "outline" : undefined}
              onClick={() => void close()}
            >
              Done
            </Button>
          ) : decision === "rejected" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => submit(false)}
                disabled={decide.isPending}
              >
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
