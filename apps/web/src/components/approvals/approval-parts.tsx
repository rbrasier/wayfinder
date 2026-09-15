"use client";

import { useState } from "react";
import { Paperclip, PencilLine } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/router";
import { Button } from "@/components/ui/button";
import { approverStageLabel } from "@/components/chat/approver-label";
import { DocumentCard } from "@/components/chat/document-card";
import { DocumentEditDialog } from "@/components/chat/document-edit-dialog";
import { approvalOutcome, OUTCOME_CLASSES } from "./approval-outcome";

export type ApprovalContext = inferRouterOutputs<AppRouter>["approval"]["listPending"][number];
type StepField = NonNullable<NonNullable<ApprovalContext["previousStep"]>["fields"]>[number];

// The pieces an approval is described by, in one place because three surfaces
// now render them: the pending queue, the decision modal, and the detail page a
// historical decision opens. Three copies is how the queue and the modal came
// to disagree about what was being signed in the first place.

export function StepFields({ fields }: { fields: StepField[] }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#e7e3db] bg-white">
      <table className="w-full text-[12.5px]">
        <tbody>
          {fields.map((field) => (
            <tr key={field.key} className="border-b border-[#f5f3ee] last:border-0">
              <td className="w-2/5 px-3 py-1.5 align-top font-medium text-[#666055]">{field.label}</td>
              <td className="px-3 py-1.5 align-top whitespace-pre-wrap text-[#1c1b19]">{field.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// What the approver is being asked to sign off, resolved from the node's
// configured subject and locked into the record when they decide (ADR-040).
export function ApprovalSubject({
  description,
  decided,
}: {
  description: string | null;
  decided?: boolean;
}) {
  if (!description) return null;

  return (
    <p className="text-[13px] text-[#1c1b19]">
      <span className="font-semibold">
        {decided ? "You approved:" : "You are approving:"}
      </span>{" "}
      {description}
    </p>
  );
}

// What the originator wrote when they sent this request — their own words about
// why it is with this approver now, as opposed to the step's standing
// instructions or the resolved subject.
export function RequestMessage({
  message,
  originatorName,
}: {
  message: string | null;
  originatorName: string | null;
}) {
  if (!message) return null;

  return (
    <div
      className="rounded-[10px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2"
      data-approval-request-message
    >
      <p className="text-[12px] font-semibold text-[#666055]">
        {originatorName ? `${originatorName} wrote:` : "The requester wrote:"}
      </p>
      <p className="mt-[3px] whitespace-pre-wrap text-[13px] text-[#1c1b19]">{message}</p>
    </div>
  );
}

export function OutcomeChip({ approval }: { approval: ApprovalContext }) {
  const outcome = approvalOutcome(approval.approval.status);
  return (
    <span
      data-approval-outcome={approval.approval.status}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_CLASSES[outcome.tone]}`}
    >
      {outcome.label}
    </span>
  );
}

// Marks a decision the system was told about rather than witnessed (ADR-055).
// Shown beside the outcome rather than instead of it: it was still an approval,
// and how it arrived is a second fact about it.
export function OffSystemChip({ approval }: { approval: ApprovalContext }) {
  if (!approval.approval.offSystemApprovedOn) return null;

  return (
    <span
      data-approval-off-system-chip
      title={`Approved on ${approval.approval.offSystemApprovedOn}, recorded in Wayfinder afterwards.`}
      className="shrink-0 rounded-full bg-[#f0ebe1] px-2 py-0.5 text-[11px] font-semibold text-[#5c574c]"
    >
      Off system
    </span>
  );
}

// The date the approval happened and the file filed as proof, on the surfaces
// that show a decision in full. The link is a plain anchor rather than a fetch:
// the route streams the bytes as an attachment, and the browser is better at
// saving a file than any handler here would be.
export function OffSystemEvidence({ approval }: { approval: ApprovalContext }) {
  const approvedOn = approval.approval.offSystemApprovedOn;
  if (!approvedOn) return null;

  const filename = approval.approval.offSystemEvidenceFilename;
  return (
    <div className="space-y-1" data-approval-off-system-evidence>
      <p className="text-[13px] text-[#1c1b19]">
        Recorded off system — approved on <span className="font-medium">{approvedOn}</span>.
      </p>
      {filename && (
        <a
          href={`/api/approvals/${approval.approval.id}/evidence`}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1f6b4d] underline underline-offset-2"
          data-approval-evidence-link
        >
          <Paperclip className="h-3.5 w-3.5" />
          {filename}
        </a>
      )}
    </div>
  );
}

// Which signature this is. Always rendered, never conditional on a role hint —
// "first supervisor" and "second supervisor" are different jobs, and an approver
// deciding without knowing which one they are is deciding half-informed.
export function ApproverStage({ approval }: { approval: ApprovalContext }) {
  return (
    <p className="text-[13px] text-[#5c574c]" data-approver-stage>
      You are the{" "}
      <span className="font-medium text-[#1c1b19]">
        {approverStageLabel({
          approverSource: approval.approval.approverSource,
          roleHint: approval.roleHint,
        })}
      </span>{" "}
      on <span className="font-medium text-[#1c1b19]">{approval.approvalStepName}</span>.
    </p>
  );
}

export function PreviousStep({
  previousStep,
  canEdit = false,
}: {
  previousStep: ApprovalContext["previousStep"];
  // An approver may fix their own subject step before deciding, rather than
  // sending the whole thing back over a typo. The edit commits first and is
  // visible in the document they are looking at when they decide, so what they
  // sign is what they left behind (ADR-045 §5). Never offered once decided.
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (!previousStep) return null;
  const { document, fields, stepName } = previousStep;

  return (
    <div className="rounded-[12px] bg-[#faf9f7] p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#666055]">
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
        <p className="text-[12.5px] text-[#666055]">No preview available for this step.</p>
      )}

      {document && canEdit && (
        <>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setEditing(true)}>
            <PencilLine className="h-4 w-4" />
            Edit before deciding
          </Button>
          <DocumentEditDialog
            open={editing}
            messageId={document.messageId}
            title="Edit before deciding"
            onClose={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        </>
      )}
    </div>
  );
}
