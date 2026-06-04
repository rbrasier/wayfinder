"use client";

import type { ReactNode } from "react";
import type { FieldValueSource, PriorStepField, TemplateField } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";

const SELECT_CLASS =
  "flex h-9 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-1.5 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none";

export const encodeSource = (source: FieldValueSource): string => {
  if (source.kind === "ai") return "ai";
  if (source.kind === "literal") return "literal";
  return `step:${source.nodeId}:${source.fieldKey}`;
};

export const decodeSource = (raw: string, previous: FieldValueSource): FieldValueSource => {
  if (raw === "ai") return { kind: "ai" };
  if (raw === "literal") {
    return { kind: "literal", value: previous.kind === "literal" ? previous.value : "" };
  }
  const [, nodeId, fieldKey] = raw.split(":");
  return { kind: "step_field", nodeId: nodeId ?? "", fieldKey: fieldKey ?? "" };
};

interface FieldValueSelectorProps {
  value: FieldValueSource;
  onChange: (next: FieldValueSource) => void;
  priorStepFields: PriorStepField[];
  // Overrides how the "Specific value" case is edited. The scheduled `at`
  // timestamp uses this to swap the plain text box for a calendar/time picker.
  renderLiteral?: (value: string, onChange: (next: string) => void) => ReactNode;
  literalLabel?: string;
}

export function FieldValueSelector({
  value,
  onChange,
  priorStepFields,
  renderLiteral,
  literalLabel = "Specific value",
}: FieldValueSelectorProps) {
  return (
    <div className="space-y-1">
      <select
        className={SELECT_CLASS}
        value={encodeSource(value)}
        onChange={(e) => onChange(decodeSource(e.target.value, value))}
      >
        <option value="ai">AI decides or asks the user</option>
        {priorStepFields.length > 0 && (
          <optgroup label="From an earlier step">
            {priorStepFields.map((prior) => (
              <option key={`${prior.nodeId}:${prior.field.key}`} value={`step:${prior.nodeId}:${prior.field.key}`}>
                {prior.stepLabel} — {prior.field.label}
              </option>
            ))}
          </optgroup>
        )}
        <option value="literal">{literalLabel}</option>
      </select>
      {value.kind === "literal" &&
        (renderLiteral ? (
          renderLiteral(value.value, (next) => onChange({ kind: "literal", value: next }))
        ) : (
          <Input
            value={value.value}
            onChange={(e) => onChange({ kind: "literal", value: e.target.value })}
            placeholder="Enter a specific value"
          />
        ))}
    </div>
  );
}

interface FieldValueListProps {
  fields: TemplateField[];
  values: Record<string, FieldValueSource>;
  onChange: (key: string, next: FieldValueSource) => void;
  priorStepFields: PriorStepField[];
}

// Renders one card per field — the field label/type (read-only) plus the value
// selector. Used for both workflow-derived inputs and author-added fields.
export function FieldValueList({ fields, values, onChange, priorStepFields }: FieldValueListProps) {
  if (fields.length === 0) return null;
  return (
    <div className="space-y-2">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1 rounded-[9px] border border-[#ece9e3] bg-[#faf9f7] p-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[#1a1814]">{field.label}</span>
            <span className="rounded bg-[#efede8] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#918d87]">
              {field.type}
            </span>
          </div>
          <FieldValueSelector
            value={values[field.key] ?? { kind: "ai" }}
            onChange={(next) => onChange(field.key, next)}
            priorStepFields={priorStepFields}
          />
        </div>
      ))}
    </div>
  );
}

export function ReadOnlyFieldList({ fields, emptyText }: { fields: TemplateField[]; emptyText: string }) {
  if (fields.length === 0) return <p className="text-[12px] text-[#918d87]">{emptyText}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {fields.map((field) => (
        <span
          key={field.key}
          className="inline-flex items-center gap-1 rounded-md border border-[#dedad2] bg-[#f7f6f3] px-2 py-1 text-[12px] text-[#5a5650]"
        >
          {field.label}
          <span className="text-[10px] uppercase tracking-wide text-[#918d87]">{field.type}</span>
        </span>
      ))}
    </div>
  );
}
