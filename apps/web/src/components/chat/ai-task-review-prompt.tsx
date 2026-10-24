"use client";

import { toast } from "sonner";
import { ApprovalSubject, PreviousStep } from "@/components/approvals/approval-parts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/trpc/client";

// An AI task's low-confidence result, handed back to the person in the chat when
// the review is theirs (ADR-065 §3). It is the same approval the Approvals page
// decides — fields editable before accepting — shown where they already are, so
// they are never left watching a "waiting for you" line.
export function AiTaskReviewPrompt({
  approvalId,
  stepName,
  onDecided,
}: {
  approvalId: string;
  stepName: string;
  onDecided: () => void;
}) {
  const reviewQuery = trpc.approval.get.useQuery({ approvalId });
  const decide = trpc.approval.decide.useMutation({
    onSuccess: (_data, { decision }) => {
      toast.success(decision === "approved" ? "Accepted — the flow carries on" : "Sent back");
      onDecided();
    },
    onError: (error) => toast.error(error.message ?? "Could not record the decision"),
  });

  const review = reviewQuery.data;
  return (
    <section
      data-testid="ai-task-review-prompt"
      aria-labelledby="ai-task-review-heading"
      className="my-3 space-y-3 rounded-[12px] border border-[#e7e3db] bg-white p-4"
    >
      <div className="space-y-1">
        <h3 id="ai-task-review-heading" className="text-[14px] font-semibold text-[#1c1b19]">
          {stepName} needs your review
        </h3>
        <p className="text-[12.5px] text-[#5c574c]">
          The AI was not confident enough to carry on by itself. Check its result, fix any field
          if you need to, then accept it to continue.
        </p>
      </div>
      {!review ? (
        <div className="flex items-center gap-2 text-[12.5px] text-[#666055]">
          <Spinner className="h-3.5 w-3.5 text-wf-primary" />
          Loading the result…
        </div>
      ) : (
        <>
          {review.approval.requestMessage ? (
            <p className="rounded-[9px] bg-[#faf9f7] px-3 py-2 text-[12.5px] text-[#5c574c]">
              <span className="font-medium text-[#1c1b19]">Why it was unsure: </span>
              {review.approval.requestMessage}
            </p>
          ) : null}
          <ApprovalSubject description={review.subjectDescription} />
          <PreviousStep previousStep={review.previousStep} canEdit />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ approvalId, decision: "rejected", routeBack: true })}
            >
              Reject
            </Button>
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ approvalId, decision: "approved" })}
            >
              {decide.isPending ? "Saving…" : "Accept and continue"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
