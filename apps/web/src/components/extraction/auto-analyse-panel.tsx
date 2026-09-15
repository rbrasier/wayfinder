"use client";

import { MAX_ANALYSE_DOCUMENTS } from "@wayfinder/domain";
import { InlineStepper } from "./editor-cards-controls";
import { resolveAnalysisState } from "./extraction-editor-model";

interface AnalysisSummary {
  runId: string;
  status: string;
  totalCount: number;
  doneCount: number;
  unreadableCount: number;
}

// The six states the phase doc specifies. "Partial with no fields" and "failed"
// are kept apart deliberately: one means the documents could not be read, the
// other that the drafting itself went wrong, and an author can act on the first.
export function AnalysisState({
  analysis,
  starting,
  onRetry,
}: {
  analysis: AnalysisSummary;
  starting: boolean;
  onRetry: () => void;
}) {
  const drafted = analysis.doneCount;
  const documentWord = (count: number) => (count === 1 ? "document" : "documents");

  const state = resolveAnalysisState(analysis, starting);

  if (state === "running") {
    return (
      <p className="text-[12px] text-[#736d5f]" role="status">
        Analysing {analysis.totalCount} {documentWord(analysis.totalCount)}…
      </p>
    );
  }

  if (state === "drafted") {
    return (
      <p className="text-[12px] text-[#5c574c]" role="status">
        Drafted fields from {drafted} {documentWord(drafted)}. Edit them in the output card.
      </p>
    );
  }

  if (state === "drafted_with_exceptions") {
    return (
      <p className="text-[12px] text-[#5c574c]" role="status">
        Drafted fields from {drafted} {documentWord(drafted)}. {analysis.unreadableCount}{" "}
        {documentWord(analysis.unreadableCount)} could not be read.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[12px] text-[#a8324c]" role="status">
      <span>
        {state === "unreadable"
          ? "Could not read these documents, so no fields were drafted."
          : "Could not draft fields from these documents."}
      </span>
      <button
        type="button"
        onClick={onRetry}
        disabled={starting}
        className="rounded px-1.5 py-0.5 font-medium text-[#3a5fd9] transition-colors hover:bg-[#f5f3ee] disabled:opacity-50"
      >
        Try again
      </button>
    </div>
  );
}

// The toggle and its read-count stepper. Deliberately quiet: the stepper sits at
// label weight beside the switch rather than presenting as a form field, so it
// is available to the authors who want it without competing with the upload area
// for everyone else (phase §7).
export function AnalyseControls({
  autoAnalyse,
  onAutoAnalyseChange,
  sampleSize,
  onSampleSizeChange,
}: {
  autoAnalyse: boolean;
  onAutoAnalyseChange: (value: boolean) => void;
  sampleSize: number;
  onSampleSizeChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <InlineStepper
        id="analyse-sample-size"
        value={sampleSize}
        min={1}
        max={MAX_ANALYSE_DOCUMENTS}
        onChange={onSampleSizeChange}
        formatLabel={(count) => `reads ${count} ${count === 1 ? "doc" : "docs"}`}
        title="How many uploaded documents the AI reads when drafting fields. More documents means a wider field set, at higher cost."
      />
      <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[#5c574c]">
        <input
          type="checkbox"
          checked={autoAnalyse}
          onChange={(event) => onAutoAnalyseChange(event.target.checked)}
          className="h-3.5 w-3.5 accent-[#3a5fd9]"
        />
        Auto analyse
      </label>
    </div>
  );
}
