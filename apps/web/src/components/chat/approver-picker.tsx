"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Info, Loader2, Mail, Stamp, Undo2, UserPen, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import type { ApproverSource } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";
import { approverStageLabel } from "./approver-label";
import {
  gateMode,
  picksApproverManually,
  sentApproverLabel,
  setupNotice,
  type SetupNotice,
} from "./approval-gate-state";
import { sentApprovalActions } from "./sent-approval-actions";
import { OffSystemApprovalDialog } from "./off-system-approval-dialog";

export interface ApproverPickerProps {
  sessionId: string;
  flowId: string;
  flowName: string;
  // The approval node the request is being raised against.
  nodeId: string;
  nodeName: string;
  approverSource: ApproverSource;
  instructions: string | null;
  roleHint: string | null;
  // Whether email can actually deliver the request; drives the manual fallback.
  emailConfigured: boolean;
  // Raised once the request has been sent, so a host that owns the surrounding
  // chrome (the decision modal) can close or refresh.
  onSent?: () => void;
  // Set only by the chat gate. Managing a sent request — chasing it, moving it,
  // pulling it — belongs where the person watching the work is, not in the
  // approver's decision modal, where the mounting user is the approver and the
  // request is not theirs to manage.
  inChat?: boolean;
  // Who is looking, and whose chat this is. Together with the row's requester
  // these decide which of the sent-state actions are offered.
  viewerUserId?: string | null;
  sessionOwnerUserId?: string | null;
  viewerIsAdmin?: boolean;
  // Whether this approval step accepts an approval recorded off system
  // (ADR-055 §4). Absent means allowed, matching the runtime default.
  offSystemAllowed?: boolean;
}

interface ChosenApprover {
  userId: string | null;
  email: string;
  label: string;
}

// Choosing and confirming an approver, in one place. The chat gate and the
// decision modal both mount this rather than each growing their own: they ask
// the same question, and the modal's answer — who signs next — is what a chained
// approval needs to keep moving without bouncing back to the originator.
//
// ADR-018's guarantees are unchanged wherever it is mounted: the resolver only
// ever suggests, "Someone else" is always offered, and the suggestion and any
// override are both recorded.
export function ApproverPicker({
  sessionId,
  flowId,
  flowName,
  nodeId,
  nodeName,
  approverSource,
  instructions,
  roleHint,
  emailConfigured,
  onSent,
  inChat = false,
  viewerUserId = null,
  sessionOwnerUserId = null,
  viewerIsAdmin = false,
  offSystemAllowed = true,
}: ApproverPickerProps) {
  const utils = trpc.useUtils();
  const [chosen, setChosen] = useState<ChosenApprover | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [query, setQuery] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState(false);
  const [nominatingOffSystem, setNominatingOffSystem] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  // Set while the operator is changing who a sent request is with. Reuses the
  // same search UI as the initial pick, so there is one way to choose a person.
  const [updatingApprover, setUpdatingApprover] = useState(false);
  // Set once from the first read, so typing in the message box does not fight
  // the refetch that keeps the rest of the card current.
  const messageSeededRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus the approver search box when the operator reveals it (replaces
  // autoFocus, forbidden by jsx-a11y/no-autofocus). Gated on showSearch so it
  // fires only in response to the user toggling search open.
  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  // The row as it stands *now*. A query rather than the `suggest` mutation,
  // because a mutation's result can never be refetched — which is what left
  // this card offering to choose an approver for a request the previous
  // approver had already sent. It is invalidated by the chat's EventSource on
  // `session.updated`, which every approval mutation now publishes.
  const rowQuery = trpc.approval.forNode.useQuery({ sessionId, nodeId });
  const row = rowQuery.data ?? null;

  // Raises the row when the node has never had one. Creating stays a write;
  // reading no longer is.
  const suggest = trpc.approval.suggest.useMutation({
    onSuccess: async () => {
      await utils.approval.forNode.invalidate({ sessionId, nodeId });
    },
  });

  const suggestMutate = suggest.mutate;
  const suggestPending = suggest.isPending;
  useEffect(() => {
    if (!rowQuery.isSuccess || rowQuery.data || suggestPending) return;
    suggestMutate({ sessionId, flowId, nodeId });
  }, [
    rowQuery.isSuccess,
    rowQuery.data,
    suggestPending,
    sessionId,
    flowId,
    nodeId,
    suggestMutate,
  ]);

  const mode = gateMode({
    row: row?.approval ?? null,
    assignedApprover: row?.assignedApprover ?? null,
  });
  const approvalId = row?.approval.id ?? null;
  const requestedByUserId = row?.approval.requestedByUserId ?? null;
  const sentTo = sentApproverLabel(row?.assignedApprover ?? null);
  const sentToEmail = row?.assignedApprover?.email ?? null;

  // Seed the message box from the row once, then leave it to the operator.
  useEffect(() => {
    if (messageSeededRef.current || !row) return;
    messageSeededRef.current = true;
    setRequestMessage(row.approval.requestMessage ?? "");
  }, [row]);

  // Open the search by itself when there is nothing to confirm, rather than
  // parking the operator behind a "Someone else" button.
  const suggestedApprover = row?.suggestedApprover ?? null;
  const seededChoiceRef = useRef(false);
  useEffect(() => {
    if (seededChoiceRef.current || mode !== "choose") return;
    seededChoiceRef.current = true;
    setShowSearch(picksApproverManually(Boolean(suggestedApprover)));
    if (suggestedApprover) {
      setChosen({
        userId: suggestedApprover.userId,
        email: suggestedApprover.email,
        label: suggestedApprover.name ?? suggestedApprover.email,
      });
    }
  }, [mode, suggestedApprover]);

  const searchQuery = trpc.people.search.useQuery(
    { query, limit: 8 },
    { enabled: showSearch && query.trim().length > 1 },
  );

  const suggestedUserId = suggestedApprover?.userId ?? null;

  const confirmAndSend = trpc.approval.confirmAndSend.useMutation({
    onSuccess: async () => {
      setChosen(null);
      await Promise.all([
        utils.approval.forNode.invalidate({ sessionId, nodeId }),
        utils.session.get.invalidate({ sessionId }),
      ]);
      toast.success(emailConfigured ? "Approval request sent" : "Approver confirmed");
      onSent?.();
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
      requestMessage: requestMessage.trim() || null,
    });
  };

  // Changing who an open request is with. Unlike a withdrawal this leaves the
  // session exactly where it is — only the addressee moves.
  const reassign = trpc.approval.reassign.useMutation({
    onSuccess: async () => {
      setUpdatingApprover(false);
      setShowSearch(false);
      setQuery("");
      setChosen(null);
      await Promise.all([
        utils.approval.forNode.invalidate({ sessionId, nodeId }),
        utils.session.get.invalidate({ sessionId }),
      ]);
      toast.success("Approver updated");
    },
    onError: (error) => toast.error(error.message ?? "Could not change the approver"),
  });

  const applyReassignment = () => {
    if (!approvalId || !chosen) return;
    reassign.mutate({
      approvalId,
      approverUserId: chosen.userId,
      approverEmail: chosen.userId ? null : chosen.email,
      isOverride: true,
      requestMessage: requestMessage.trim() || null,
    });
  };

  const actions = sentApprovalActions({
    viewerUserId,
    sessionOwnerUserId,
    requestedByUserId,
    isAdmin: viewerIsAdmin,
    inChat,
    offSystemAllowed,
  });

  // Taking the request back. The session returns to the nearest prior chat step,
  // so the whole page has to re-read: `session.get` drives the gate, the
  // composer's disabled state and the step rail alike.
  // Recording an approval that happened elsewhere. Same refresh as a decision:
  // the session has moved on, so the gate, the composer and the step rail all
  // have to re-read.
  const closeOffSystem = () => setNominatingOffSystem(false);
  const refreshAfterOffSystem = async () => {
    await Promise.all([
      utils.approval.forNode.invalidate({ sessionId, nodeId }),
      utils.session.get.invalidate({ sessionId }),
    ]);
    onSent?.();
  };

  const withdraw = trpc.approval.withdraw.useMutation({
    onSuccess: async (result) => {
      setConfirmingWithdrawal(false);
      setWithdrawalReason("");
      await Promise.all([
        utils.approval.forNode.invalidate({ sessionId, nodeId }),
        utils.session.get.invalidate({ sessionId }),
      ]);
      toast.success(
        result.held
          ? "Approval withdrawn — no earlier chat step to return to, so the chat is held here"
          : "Approval withdrawn",
      );
    },
    onError: (error) => toast.error(error.message ?? "Could not withdraw the request"),
  });

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

  // Sits to the right of the panel heading: an icon, a line, and the detail
  // only when asked for. What is not configured is worth saying once, quietly —
  // it is never the operator's task, and it must not read as an error.
  const noticeButton = (notice: SetupNotice) => (
    <button
      type="button"
      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-[#666055] hover:bg-[#f3ede2] hover:text-[#1c1b19]"
      aria-expanded={showNotice}
      onClick={() => setShowNotice((open) => !open)}
      data-approval-setup-notice
    >
      <Info className="h-3.5 w-3.5" />
      {notice.label}
    </button>
  );

  const noticeDetail = (notice: SetupNotice) =>
    showNotice && (
      <div className="space-y-2 rounded-[10px] border border-[#e8d4b0] bg-white px-3 py-2">
        {notice.paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-[12.5px] text-[#5c574c]">
            {paragraph}
          </p>
        ))}
      </div>
    );

  // Always rendered, never conditional on a roleHint: which signature this is —
  // first supervisor, second supervisor, or a policy-named role — is the first
  // thing both the operator and the approver need to know.
  const stageLine = (
    <p className="text-[13px] text-[#5c574c]" data-approver-stage>
      Approver: <span className="font-medium text-[#1c1b19]">{approverStageLabel({ approverSource, roleHint })}</span>
      <span className="text-[#666055]"> · {nodeName}</span>
    </p>
  );

  // One way to choose a person, mounted both for the initial pick and for
  // changing who a sent request is with.
  const approverSearchPanel = (
        <div className="space-y-2 rounded-[10px] border border-[#e7e3db] bg-white p-3">
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people, Entra, HR, or type any email…"
          />
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {(searchQuery.data ?? []).map((person) => (
              <button
                key={`${person.source}:${person.email}`}
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-[#1c1b19] hover:bg-[#faf9f7]"
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
                <span className="ml-2 shrink-0 text-[11px] uppercase text-[#666055]">
                  {person.source}
                </span>
              </button>
            ))}
            {searchQuery.data?.length === 0 && query.trim().length > 1 && (
              <p className="px-2 py-1 text-[12px] text-[#666055]">No matches.</p>
            )}
          </div>
        </div>
  );

  // Until the initial suggest resolves we cannot tell whether the request is
  // already sent or still needs an approver, so show a loading state rather than
  // flashing the empty confirm form (which makes a re-opened session feel as if
  // the approver must be re-entered).
  if (mode === "loading") {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#666055]">
        <Loader2 className="h-4 w-4 animate-spin text-[#a65b05]" />
        Loading approval…
      </div>
    );
  }

  if (mode === "sent") {
    const notice = setupNotice({ emailConfigured, hasSuggestion: true });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Stamp className="h-5 w-5 text-[#a65b05]" />
            <p className="text-[13px] text-[#92400e]">
              {emailConfigured ? (
                <>
                  Awaiting approval — sent to <span className="font-medium">{sentTo}</span>.
                </>
              ) : (
                <>
                  Awaiting approval from <span className="font-medium">{sentTo}</span>.
                </>
              )}
            </p>
          </div>
          {notice && noticeButton(notice)}
        </div>

        {stageLine}

        {notice && noticeDetail(notice)}

        {(actions.canEmail || actions.canUpdateApprover || actions.canWithdraw) &&
          !confirmingWithdrawal &&
          !updatingApprover && (
            <div className="flex flex-wrap gap-2">
              {/* Always offered now, not only when email is unconfigured: a
                  request stalling is a separate problem from email being
                  unconfigured, and chasing the approver answers both. */}
              {actions.canEmail && sentToEmail && (
                <Button asChild size="sm" variant="outline" data-approval-email>
                  <a href={buildMailtoHref(sentToEmail)}>
                    <Mail className="h-4 w-4" />
                    Email approver
                  </a>
                </Button>
              )}
              {!emailConfigured && (
                <Button size="sm" variant="outline" onClick={copyApprovalLink}>
                  <Copy className="h-4 w-4" />
                  Copy approval link
                </Button>
              )}
              {actions.canUpdateApprover && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setUpdatingApprover(true);
                    setShowSearch(true);
                  }}
                  data-approval-update-approver
                >
                  <UserPen className="h-4 w-4" />
                  Update approver
                </Button>
              )}
              {/* Two steps, not one: withdrawing moves the chat back a step and
                  tells the approver it happened, which is too much to trigger on
                  a stray click next to "Copy approval link". */}
              {actions.canNominateOffSystem && approvalId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNominatingOffSystem(true)}
                  data-approval-off-system
                >
                  <FileCheck2 className="h-4 w-4" />
                  Approved off system
                </Button>
              )}
              {actions.canWithdraw && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingWithdrawal(true)}
                  data-approval-withdraw
                >
                  <Undo2 className="h-4 w-4" />
                  Withdraw
                </Button>
              )}
            </div>
          )}

        {actions.canUpdateApprover && updatingApprover && (
          <div
            className="space-y-2 rounded-[10px] border border-[#e8d4b0] bg-white px-3 py-2"
            data-approval-update-panel
          >
            <p className="text-[13px] text-[#1c1b19]">
              Currently with <span className="font-medium">{sentTo}</span>. Choose who it should
              go to instead — the chat stays where it is.
            </p>

            {showSearch && approverSearchPanel}

            {chosen && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] text-[#1c1b19]" data-approval-update-chosen>
                  Moving to <span className="font-medium">{chosen.label}</span>
                  {chosen.email && chosen.label !== chosen.email && (
                    <span className="text-[#666055]"> ({chosen.email})</span>
                  )}
                </p>
                {!showSearch && (
                  <Button size="sm" variant="ghost" onClick={() => setShowSearch(true)}>
                    Choose someone else
                  </Button>
                )}
              </div>
            )}

            {/* Pre-filled with the note already on the request, so one naming
                the previous approver can be revised rather than forwarded. */}
            <Textarea
              value={requestMessage}
              onChange={(event) => setRequestMessage(event.target.value)}
              placeholder="Add a message for the new approver (optional)"
              maxLength={2000}
              className="min-h-[56px]"
              aria-label="Message for the new approver"
            />

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={applyReassignment}
                disabled={!chosen || reassign.isPending}
                data-approval-update-confirm
              >
                {reassign.isPending ? "Updating…" : "Update approver"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setUpdatingApprover(false);
                  setShowSearch(false);
                  setChosen(null);
                  setQuery("");
                }}
                disabled={reassign.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {actions.canWithdraw && confirmingWithdrawal && (
          <div
            className="space-y-2 rounded-[10px] border border-[#e8d4b0] bg-white px-3 py-2"
            data-approval-withdraw-confirm
          >
            <p className="text-[13px] text-[#1c1b19]">
              Withdraw this request? {sentTo ?? "The approver"} will be told it was taken back,
              and the chat returns to the last step you can edit.
            </p>
            <Textarea
              value={withdrawalReason}
              onChange={(event) => setWithdrawalReason(event.target.value)}
              placeholder="Why are you withdrawing? (optional)"
              maxLength={2000}
              className="min-h-[56px]"
              aria-label="Reason for withdrawing"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  approvalId &&
                  withdraw.mutate({
                    approvalId,
                    reason: withdrawalReason.trim() || null,
                  })
                }
                disabled={!approvalId || withdraw.isPending}
                data-approval-withdraw-confirm-button
              >
                {withdraw.isPending ? "Withdrawing…" : "Withdraw request"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmingWithdrawal(false)}
                disabled={withdraw.isPending}
              >
                Keep waiting
              </Button>
            </div>
          </div>
        )}

        {approvalId && (
          <OffSystemApprovalDialog
            open={nominatingOffSystem}
            approvalId={approvalId}
            approverLabel={sentTo ?? sentToEmail ?? "the assigned approver"}
            onClose={closeOffSystem}
            onRecorded={refreshAfterOffSystem}
          />
        )}
      </div>
    );
  }

  const notice = setupNotice({ emailConfigured, hasSuggestion: chosen !== null });

  return (
    <div className="flex flex-col gap-3" data-approver-picker>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-[#a65b05]" />
          <p className="text-[14px] font-semibold text-[#1c1b19]">
            {chosen ? "Confirm the approver" : "Choose the approver"}
          </p>
        </div>
        {notice && noticeButton(notice)}
      </div>

      {notice && noticeDetail(notice)}

      {/* The subject the approver will see and the record will lock, shown
          here first so the operator can catch a wrong one before it is sent. */}
      {suggest.data?.subject?.description && (
        <p className="text-[13px] text-[#1c1b19]" data-approval-subject>
          <span className="font-semibold">You are requesting approval of:</span>{" "}
          {suggest.data.subject.description}
        </p>
      )}

      {instructions && <p className="text-[13px] text-[#5c574c]">{instructions}</p>}

      {stageLine}

      {chosen && (
        <div className="rounded-[10px] border border-[#e8d4b0] bg-white px-3 py-2">
          <p className="text-[13px] text-[#1c1b19]">
            Suggested: <span className="font-medium">{chosen.label}</span>
            {chosen.email && chosen.label !== chosen.email && (
              <span className="text-[#666055]"> ({chosen.email})</span>
            )}
          </p>
        </div>
      )}

      {showSearch && approverSearchPanel}

      {/* The approver gets the subject and the step's standing instructions
          either way; this is the one place the operator can say why *this*
          request is going to *them*, now. */}
      <Textarea
        value={requestMessage}
        onChange={(event) => setRequestMessage(event.target.value)}
        placeholder="Add a message for the approver (optional)"
        maxLength={2000}
        className="min-h-[56px]"
        aria-label="Message for the approver"
        data-approval-request-message
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={send} disabled={!chosen || confirmAndSend.isPending}>
          {emailConfigured ? "Confirm & send" : "Confirm"}
        </Button>
        {/* Only an offer to change a suggestion. With the picker already open
            there is nothing for it to do. */}
        {!showSearch && (
          <Button size="sm" variant="outline" onClick={() => setShowSearch(true)}>
            Someone else
          </Button>
        )}
      </div>
    </div>
  );
}
