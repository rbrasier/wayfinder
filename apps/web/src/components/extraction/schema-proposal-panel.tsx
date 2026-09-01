"use client";

import { useState } from "react";
import type { ExtractionFieldDraft, SchemaProposal, SchemaProposalFinding } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { proposalFieldSummaries } from "./extraction-editor-model";
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
      className={`shrink-0 rounded-[4px] border px-[5px] py-[1px] text-[10px] font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  );
}

function Findings({ findings }: { findings: SchemaProposalFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {orderedFindings(findings).map((finding, index) => (
        <li
          key={`${finding.severity}-${finding.fieldLabel ?? "set"}-${index}`}
          className={`rounded-[9px] border px-3 py-2 text-[12px] ${
            finding.severity === "blocking"
              ? "border-[#f3ccd6] bg-[#f9e8eb] text-[#a8324c]"
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
  outputInstruction: string;
  findings: SchemaProposalFinding[];
  busy: boolean;
  refining: boolean;
  onRefine: (instruction: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

// The review step: what the AI drafted, what is wrong with it, and the two ways
// out — back to redraft, or continue into the field editor with it. Every
// decision it makes lives in `schema-proposal-model.ts` and is unit-tested there.
export function SchemaProposalPanel({
  proposal,
  fields,
  outputInstruction,
  findings,
  busy,
  refining,
  onRefine,
  onBack,
  onContinue,
}: SchemaProposalPanelProps) {
  const [instruction, setInstruction] = useState("");

  const summaries = proposalFieldSummaries(fields);
  const previous = proposal.revisions[proposal.revisions.length - 2]?.fields ?? [];
  // On the opening draft every field is new, so the tag says nothing. It earns
  // its place only once there is a previous revision to have changed from.
  const showChanges = proposal.revisions.length > 1;
  const changeByLabel = new Map(
    fieldChanges(fields, previous).map((row) => [row.label, row.change] as const),
  );
  const continueState = confirmState(proposal.status, findings, busy);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <FieldGroupLabel>Fields drafted</FieldGroupLabel>
        <ul className="space-y-1.5">
          {summaries.map((summary) => (
            <li
              key={summary.label}
              className="flex items-start gap-2 rounded-[9px] border border-[#e7e3db] bg-white px-3 py-2"
            >
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-medium text-[#1c1b19]">{summary.label}</span>
                  {summary.optional && (
                    <span className="text-[11px] text-[#736d5f]">Optional</span>
                  )}
                  {showChanges && <ChangeTag change={changeByLabel.get(summary.label) ?? "unchanged"} />}
                </span>
                <span className="block text-[12px] text-[#666055]">{summary.instruction}</span>
              </span>
              <span className="shrink-0 rounded-[6px] border border-[#e7e3db] bg-[#faf9f7] px-2 py-0.5 text-[11px] font-medium text-[#5c574c]">
                {summary.typeLabel}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {outputInstruction && (
        <div className="space-y-1.5">
          <FieldGroupLabel>Output instructions drafted</FieldGroupLabel>
          <p className="rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2 text-[12px] text-[#5c574c]">
            {outputInstruction}
          </p>
        </div>
      )}

      <Findings findings={findings} />

      {proposal.status === "draft" && (
        <div className="flex items-center gap-2">
          <Input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="What should change? e.g. add the warranty period"
            aria-label="What should change about this draft?"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || instruction.trim().length === 0}
            onClick={() => {
              onRefine(instruction.trim());
              setInstruction("");
            }}
          >
            {refining ? "Redrafting…" : "Redraft"}
          </Button>
        </div>
      )}

      <details className="text-[12px] text-[#666055]">
        <summary className="cursor-pointer">How this draft got here</summary>
        <ol className="mt-2 space-y-1.5">
          {revisionEntries(proposal.revisions).map((entry) => (
            <li key={entry.index}>
              <strong>{entry.index}.</strong> {entry.request}
              {entry.note ? ` — ${entry.note}` : ""}
              {entry.isCurrent ? " (current)" : ""}
            </li>
          ))}
        </ol>
      </details>

      <div className="flex items-center justify-end gap-2">
        {/* Beside the control, never in a page-level error line: a disabled
            button with no stated reason is the failure mode this avoids. */}
        {continueState.reason && (
          <span className="mr-auto text-[12px] text-[#666055]">{continueState.reason}</span>
        )}
        <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button type="button" onClick={onContinue} disabled={continueState.disabled}>
          {busy ? "Working…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
