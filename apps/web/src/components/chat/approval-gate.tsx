"use client";

import type { ApproverSource } from "@rbrasier/domain";
import { trpc } from "@/trpc/client";
import { ApproverPicker } from "./approver-picker";

interface ApprovalGateProps {
  sessionId: string;
  flowId: string;
  flowName: string;
  nodeId: string;
  nodeName: string;
  approverSource: ApproverSource;
  instructions: string | null;
  // The policy-named approver role authored on the node, shown to the operator
  // so they know who the request is meant for before confirming.
  roleHint: string | null;
  // Who is looking and whose chat this is. Together with the row's requester
  // these decide which actions the sent card offers.
  viewerUserId: string | null;
  sessionOwnerUserId: string | null;
  viewerIsAdmin: boolean;
  // Read from the approval node's config (ADR-055 §4). Absent means allowed, so
  // a step authored before the setting existed still offers the action.
  offSystemAllowed?: boolean;
}

// Operator-facing gate shown when a session is parked on an approval node. The
// selection itself lives in `ApproverPicker`, shared with the decision modal in
// `/approvals`; this contributes only the chat panel's framing.
export function ApprovalGate({
  sessionId,
  flowId,
  flowName,
  nodeId,
  nodeName,
  approverSource,
  instructions,
  roleHint,
  viewerUserId,
  sessionOwnerUserId,
  viewerIsAdmin,
  offSystemAllowed = true,
}: ApprovalGateProps) {
  // When email cannot be delivered the operator must notify the approver by hand,
  // so the confirm action only records the approver and surfaces manual options.
  const emailStatusQuery = trpc.approval.emailStatus.useQuery();
  const emailConfigured = emailStatusQuery.data?.configured ?? true;

  // Constrained to the composer's own width and rendered in its stack, so the
  // gate reads as the next thing in the chat column rather than a band laid
  // across the conversation. The full-bleed `border-t` panel it replaces spanned
  // wider than any message, which is what made it look like an overlay.
  return (
    <div className="shrink-0 px-4 pb-[18px] pt-[14px] sm:px-6" data-approval-gate>
      <div className="mx-auto max-w-[760px] rounded-[14px] border border-[#e8d4b0] bg-[#fffaf2] px-4 py-3">
        <ApproverPicker
          sessionId={sessionId}
          flowId={flowId}
          flowName={flowName}
          nodeId={nodeId}
          nodeName={nodeName}
          approverSource={approverSource}
          instructions={instructions}
          roleHint={roleHint}
          emailConfigured={emailConfigured}
          inChat
          viewerUserId={viewerUserId}
          sessionOwnerUserId={sessionOwnerUserId}
          viewerIsAdmin={viewerIsAdmin}
          offSystemAllowed={offSystemAllowed}
        />
      </div>
    </div>
  );
}
