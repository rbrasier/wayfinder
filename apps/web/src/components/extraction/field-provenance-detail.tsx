"use client";

import { confidenceBand, fieldConfidence, type ConfidenceBand } from "@rbrasier/domain";
import {
  confidenceMetricLabel,
  derivationSummary,
  fieldProvenanceStyle,
  sourceRefSummary,
} from "./field-provenance-display";
import type { ResultDocument, ResultFieldValue } from "./result-grid-model";

const BAND_LABEL: Record<ConfidenceBand, string> = {
  red: "Low",
  amber: "Medium",
  green: "High",
};

// The provenance marker beside a value — what the operator scans to decide where
// to spend review effort, before reading any number.
export function ProvenanceTag({ field }: { field: ResultFieldValue }) {
  const style = fieldProvenanceStyle(field);
  return (
    <span
      title={style.description}
      className={`shrink-0 rounded-[4px] border px-[4px] py-[1px] text-[10px] font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  );
}

// The rationale behind one value: how it was reached, how confident the model is
// on the scale that provenance implies, and where it came from.
export function FieldRationale({
  field,
  documents,
}: {
  field: ResultFieldValue;
  documents: ResultDocument[];
}) {
  const read = fieldConfidence(field);
  const style = fieldProvenanceStyle(field);
  const derivation = derivationSummary(field);
  const source = sourceRefSummary(
    field,
    new Map(documents.map((document) => [document.id, document.filename])),
  );

  return (
    <div className="flex flex-col gap-[8px] text-[13px]">
      <p>
        <span className="font-semibold">{style.label}</span> — {style.description}
      </p>
      <p>
        <span className="font-semibold">
          {BAND_LABEL[confidenceBand(read.value)]} {confidenceMetricLabel(field).toLowerCase()}
        </span>{" "}
        ({Math.round(read.value * 100)}%)
      </p>
      <p className="text-[#5c574c]">{field.rationale || "No rationale provided."}</p>
      {derivation ? (
        <p className="text-[12px] text-[#5c574c]">
          <span className="font-semibold">Calculated as:</span> {derivation}
        </p>
      ) : null}
      {source ? (
        <p className="text-[12px] text-[#5c574c]">
          <span className="font-semibold">Source:</span> {source}
        </p>
      ) : null}
      <p className="text-[11px] text-[#736d5f]">
        {read.kind === "selection"
          ? "Selection confidence is how sure the model is it picked the right value from the source, not whether the source itself is right."
          : "Confidence is a self-assessed triage signal, not a guarantee — always verify amber and red values."}
      </p>
    </div>
  );
}
