"use client";

import { AlertTriangle, Check, Download, Info, RotateCcw } from "lucide-react";
import { evidenceNeedsConfirmation } from "@wayfinder/domain";
import { Button } from "@/components/ui/button";
import { FieldRow } from "./field-row";
import { TEMPLATE_TYPE_OPTIONS, type FieldModel, type FieldRowType } from "./field-row-model";
import { rowTypeLabel, type EditableRow, type RowValidation } from "./template-annotation-model";
import { evidenceLabel, replacedLabel } from "./template-draft-model";

export interface UnplacedValue {
  label: string;
  sourceValue: string;
  reason: "not-in-document" | "could-not-place";
}

// What the draft found, before the editable grid: the same two-column summary
// the tagged-template path shows.
export function DraftedFieldsSummary({ rows, exampleCount }: { rows: EditableRow[]; exampleCount: number }) {
  const fields = rows.filter((row) => row.line.trim().length > 0);

  return (
    <div className="space-y-2">
      <p className="text-[14px] font-medium text-[#1c1b19]">
        {fields.length === 1 ? "1 data field drafted" : `${fields.length} data fields drafted`}
      </p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-[9px] border border-[#ebe8e0] bg-[#faf9f7] p-3 sm:grid-cols-2">
        {fields.map((row) => (
          <div key={row.id} className="flex items-baseline gap-1.5 text-[12px]">
            <span className="text-wf-primary">•</span>
            <span className="truncate text-[#1c1b19]">{row.model.label || row.line}</span>
            <span className="shrink-0 text-[#666055]">({rowTypeLabel(row)})</span>
          </div>
        ))}
      </div>
      {exampleCount === 1 && (
        <p className="flex items-start gap-1 text-[12px] text-[#8a6d1f]">
          <Info size={13} className="mt-0.5 shrink-0" />
          Drafted from one example, so nothing could be compared. Add more examples to improve accuracy.
        </p>
      )}
    </div>
  );
}

export function DraftReviewRow({
  row,
  index,
  validation,
  onChangeModel,
  onChangeType,
  onRemove,
  onOpenConfig,
  onAcceptCorrection,
  onConfirm,
}: {
  row: EditableRow;
  index: number;
  validation: RowValidation;
  onChangeModel: (patch: Partial<FieldModel>) => void;
  onChangeType: (type: FieldRowType) => void;
  onRemove: () => void;
  onOpenConfig: () => void;
  onAcceptCorrection: (line: string) => void;
  onConfirm: () => void;
}) {
  const draft = row.draft;
  const removed = row.line.trim().length === 0;
  const awaitingConfirmation = Boolean(draft && !draft.confirmed && !removed);

  return (
    <div
      className={`space-y-1.5 rounded-[9px] border p-2.5 ${
        validation.blocking.length > 0 || awaitingConfirmation ? "border-[#e6d9b8] bg-[#fdfbf5]" : "border-[#ebe8e0]"
      }`}
    >
      <FieldRow
        model={row.model}
        index={index}
        onChange={onChangeModel}
        onChangeType={onChangeType}
        onRemove={onRemove}
        onOpenConfig={onOpenConfig}
        typeOptions={TEMPLATE_TYPE_OPTIONS}
        labelPlaceholder="e.g. Supplier Name"
      />

      {draft && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#666055]">
          <span className="font-medium text-[#5c574c]">{removed ? "Left as it is" : replacedLabel(draft)}</span>
          <span
            className={`rounded-full px-2 py-0.5 ${
              evidenceNeedsConfirmation(draft.evidence) ? "bg-[#fbf6e8] text-[#8a6d1f]" : "bg-[#eef3ee] text-[#1f6b4d]"
            }`}
          >
            {evidenceLabel(draft.evidence)}
          </span>
        </div>
      )}

      {draft?.context && (
        <p className="truncate text-[11px] text-[#6d6a65]" title={draft.context}>
          In the document: {draft.context}
        </p>
      )}

      {validation.blocking.map((message) => (
        <p key={message} className="flex items-start gap-1 text-[11px] text-[#a8324c]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {message}
        </p>
      ))}

      {validation.warnings.map((warning) => (
        <div key={warning.message} className="flex items-start gap-1 text-[11px] text-[#8a6d1f]">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>{warning.message}</span>
          <button
            type="button"
            className="shrink-0 font-medium text-wf-primary hover:text-wf-primary-hover"
            onClick={() => onAcceptCorrection(warning.correctedLine)}
          >
            Fix
          </button>
        </div>
      ))}

      {awaitingConfirmation && (
        <div className="flex items-center gap-2 text-[11px] text-[#8a6d1f]">
          <span>The checking pass added this field. Check it is right before saving.</span>
          <Button type="button" variant="secondary" className="h-6 px-2 text-[11px]" onClick={onConfirm}>
            <Check size={12} className="mr-1" /> Looks right
          </Button>
        </div>
      )}
    </div>
  );
}

export function NotPlacedList({ values }: { values: UnplacedValue[] }) {
  if (values.length === 0) return null;

  return (
    <div className="space-y-1 rounded-[9px] border border-[#f0c9d4] bg-[#fdfafb] p-3">
      <p className="text-[12px] font-medium text-[#a8324c]">Not placed</p>
      <p className="text-[11px] text-[#666055]">
        These were suggested but could not be found in your document exactly as written, so nothing was changed for
        them. Add them yourself in Word if you need them.
      </p>
      <ul className="space-y-0.5">
        {values.map((value) => (
          <li key={`${value.label} ${value.sourceValue}`} className="text-[12px] text-[#1c1b19]">
            {value.label} <span className="text-[#666055]">— “{value.sourceValue}”</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SameInEveryExampleList({
  rows,
  onRestore,
}: {
  rows: EditableRow[];
  onRestore: (id: string) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-1 rounded-[9px] border border-[#ebe8e0] bg-[#faf9f7] p-3">
      <p className="text-[12px] font-medium text-[#1c1b19]">Same in every example</p>
      <p className="text-[11px] text-[#666055]">
        This text reads the same in all your examples, so it was left as fixed wording. Restore any that should still
        be a field.
      </p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2 text-[12px] text-[#1c1b19]">
            <span className="min-w-0 flex-1 truncate">
              {row.model.label} <span className="text-[#666055]">— “{row.draft?.replacedValue}”</span>
            </span>
            <Button type="button" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => onRestore(row.id)}>
              <RotateCcw size={12} className="mr-1" /> Restore
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AddMoreFieldsBlock({ onDownload }: { onDownload: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[9px] border border-dashed border-[#e7e3db] p-3 text-[12px] text-[#5c574c]">
      <span className="flex-1">Need to add more fields? Download the draft, add them in Word, then upload it again.</span>
      <Button type="button" variant="secondary" onClick={onDownload}>
        <Download size={13} className="mr-1" /> Download draft
      </Button>
    </div>
  );
}
