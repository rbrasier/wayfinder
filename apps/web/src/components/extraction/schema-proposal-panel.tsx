"use client";

import type { ExtractionFieldDraft, SchemaProposal, SchemaProposalFinding } from "@rbrasier/domain";
import {
  confirmState,
  fieldChanges,
  orderedFindings,
  revisionEntries,
  type FieldChange,
} from "./schema-proposal-model";

const CHANGE_STYLE: Record<FieldChange, { label: string; className: string }> = {
  added: { label: "New", className: "border-[#bfe3c6] bg-[#f0f9f1] text-[#276b34]" },
  changed: { label: "Changed", className: "border-[#e6d9b0] bg-[#fbf7ea] text-[#7a6320]" },
  removed: { label: "Removed", className: "border-[#e9c8c4] bg-[#fdf2f1] text-[#8c3a32]" },
  unchanged: { label: "Unchanged", className: "border-[#e7e3db] bg-white text-[#6d6a63]" },
};

function ChangeTag({ change }: { change: FieldChange }) {
  const style = CHANGE_STYLE[change];
  return (
    <span
      className={`shrink-0 rounded-[4px] border px-[4px] py-[1px] text-[10px] font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  );
}

function Findings({ findings }: { findings: SchemaProposalFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-[6px]">
      {orderedFindings(findings).map((finding, index) => (
        <li
          key={`${finding.severity}-${finding.fieldLabel ?? "set"}-${index}`}
          className={`rounded-[8px] border px-[10px] py-[8px] text-[12px] ${
            finding.severity === "blocking"
              ? "border-[#e9c8c4] bg-[#fdf2f1] text-[#8c3a32]"
              : "border-[#e6d9b0] bg-[#fbf7ea] text-[#7a6320]"
          }`}
        >
          {finding.fieldLabel ? <strong>{finding.fieldLabel}: </strong> : null}
          {finding.message}
        </li>
      ))}
    </ul>
  );
}

export interface SchemaProposalPanelProps {
  proposal: SchemaProposal;
  fields: ExtractionFieldDraft[];
  findings: SchemaProposalFinding[];
  busy: boolean;
  onConfirm: () => void;
}

// The proposal surface: what the schema currently says, how it changed in the
// last turn, what is wrong with it, and how it got here. Every decision it makes
// lives in `schema-proposal-model.ts` and is unit-tested there.
export function SchemaProposalPanel({
  proposal,
  fields,
  findings,
  busy,
  onConfirm,
}: SchemaProposalPanelProps) {
  const previous = proposal.revisions[proposal.revisions.length - 2]?.fields ?? [];
  const rows = fieldChanges(fields, previous);
  const confirm = confirmState(proposal.status, findings, busy);

  return (
    <section className="flex flex-col gap-[12px] rounded-[10px] border border-[#e7e3db] bg-white p-[16px]">
      <h3 className="text-[14px] font-semibold">Proposed fields</h3>

      <ul className="flex flex-col gap-[6px]">
        {rows.map((row) => (
          <li
            key={`${row.change}-${row.label}`}
            className="flex items-start gap-[8px] rounded-[8px] border border-[#e7e3db] px-[10px] py-[8px]"
          >
            <ChangeTag change={row.change} />
            <span className="flex flex-col gap-[2px]">
              <span className="text-[13px] font-medium">{row.annotation}</span>
              <span className="text-[12px] text-[#6d6a63]">{row.instruction}</span>
            </span>
          </li>
        ))}
      </ul>

      <Findings findings={findings} />

      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirm.disabled}
          className="rounded-[8px] bg-[#1f1d1a] px-[12px] py-[7px] text-[13px] font-medium text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Confirm these fields"}
        </button>
        {/* Beside the control, never in a page-level error line: a disabled
            button with no stated reason is the failure mode this avoids. */}
        {confirm.reason ? (
          <span className="text-[12px] text-[#6d6a63]">{confirm.reason}</span>
        ) : null}
      </div>

      <details className="text-[12px] text-[#6d6a63]">
        <summary className="cursor-pointer">How this schema got here</summary>
        <ol className="mt-[8px] flex flex-col gap-[6px]">
          {revisionEntries(proposal.revisions).map((entry) => (
            <li key={entry.index}>
              <strong>{entry.index}.</strong> {entry.request}
              {entry.note ? ` — ${entry.note}` : ""}
              {entry.isCurrent ? " (current)" : ""}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
