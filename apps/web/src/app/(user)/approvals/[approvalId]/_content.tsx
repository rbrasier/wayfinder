"use client";

import Link from "next/link";
import { ArrowLeft, MessageSquare } from "lucide-react";
import type { SessionStatus } from "@rbrasier/domain";
import {
  ApprovalSubject,
  ApproverStage,
  OffSystemChip,
  OffSystemEvidence,
  OutcomeChip,
  PreviousStep,
} from "@/components/approvals/approval-parts";
import { isDecided } from "@/components/approvals/approval-outcome";
import { trpc } from "@/trpc/client";

// Where the work stands now, in the reader's words rather than the enum's.
const SESSION_STATE_COPY: Record<SessionStatus, string> = {
  active: "still in progress",
  complete: "completed",
  abandoned: "discarded by the originator",
  cancelled: "closed after a rejection",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-[#f5f3ee] py-2 last:border-0">
      <span className="w-40 shrink-0 text-[12.5px] font-medium text-[#666055]">{label}</span>
      <span className="min-w-0 flex-1 text-[13px] text-[#1c1b19]">{children}</span>
    </div>
  );
}

// One decision, on its own page. Approval-centric rather than chat-centric: it
// leads with what was signed and what was decided, and reports the session only
// as the answer to "where did this end up".
export function ApprovalDetailContent({ approvalId }: { approvalId: string }) {
  const approvalQuery = trpc.approval.get.useQuery({ approvalId });

  if (approvalQuery.isPending) {
    return <p className="container py-6 text-[13px] text-[#666055]">Loading…</p>;
  }

  if (approvalQuery.error || !approvalQuery.data) {
    return (
      <div className="container py-6">
        <p className="text-[14px] font-semibold text-[#1c1b19]">This approval isn&apos;t available</p>
        <p className="mt-1 text-[13px] text-[#666055]">
          {approvalQuery.error?.message ?? "It may have been removed."}
        </p>
        <Link href="/approvals" className="mt-3 inline-block text-[13px] font-medium text-[#2f56d3]">
          Back to approvals
        </Link>
      </div>
    );
  }

  const approval = approvalQuery.data;
  const { decidedAt, comment, status } = approval.approval;
  const decided = isDecided(status);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[#e7e3db] bg-white px-5">
        <Link
          href="/approvals"
          aria-label="Back to approvals"
          className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[#666055] hover:bg-[#f3ede2] hover:text-[#1c1b19]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold text-[#1c1b19]">
          {approval.approvalStepName}
        </h1>
        <OutcomeChip approval={approval} />
        <OffSystemChip approval={approval} />
      </header>

      <div className="flex-1 overflow-auto">
        <div className="container flex flex-col gap-4 py-6">
          <section className="rounded-[14px] border-[1.5px] border-[#e7e3db] bg-white p-[16px_18px]">
            <ApproverStage approval={approval} />
            <div className="mt-2">
              <ApprovalSubject description={approval.subjectDescription} decided={decided} />
            </div>
          </section>

          <section className="rounded-[14px] border-[1.5px] border-[#e7e3db] bg-white p-[16px_18px]">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#666055]">
              Decision
            </h2>
            <Row label="Outcome">
              <span className="flex items-center gap-1.5">
                <OutcomeChip approval={approval} />
                <OffSystemChip approval={approval} />
              </span>
            </Row>
            {approval.decidedByName && <Row label="Decided by">{approval.decidedByName}</Row>}
            {decidedAt && <Row label="Decided at">{new Date(decidedAt).toLocaleString()}</Row>}
            <Row label="Requested">{new Date(approval.approval.createdAt).toLocaleString()}</Row>
            {approval.originatorName && <Row label="Raised by">{approval.originatorName}</Row>}
            <Row label="Comment">
              {comment ? (
                <span className="whitespace-pre-wrap">{comment}</span>
              ) : (
                <span className="text-[#666055]">None given.</span>
              )}
            </Row>
            {approval.approval.offSystemApprovedOn && (
              <div className="mt-3 border-t border-[#f0ece4] pt-3">
                <OffSystemEvidence approval={approval} />
              </div>
            )}
          </section>

          {/* Read-only: the editing right lasts only while the approval is
              pending, and reaches only the step it is about (ADR-045). */}
          <section className="rounded-[14px] border-[1.5px] border-[#e7e3db] bg-white p-[16px_18px]">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#666055]">
              What was signed
            </h2>
            <PreviousStep previousStep={approval.previousStep} />
          </section>

          {/* The question a historical decision actually raises: what happened
              after I signed it. */}
          <section className="rounded-[14px] border-[1.5px] border-[#e7e3db] bg-white p-[16px_18px]">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#666055]">
              Where it went
            </h2>
            <p className="text-[13px] text-[#1c1b19]" data-session-state={approval.sessionState.status}>
              <span className="font-medium">{approval.chatName}</span> is{" "}
              {SESSION_STATE_COPY[approval.sessionState.status]}
              {approval.sessionState.currentStepName ? (
                <>
                  , currently on{" "}
                  <span className="font-medium">{approval.sessionState.currentStepName}</span>
                </>
              ) : null}
              .
            </p>
            <Link
              href={`/chats/${approval.sessionId}`}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#2f56d3]"
            >
              <MessageSquare className="h-4 w-4" />
              Open the session
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
