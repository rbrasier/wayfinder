"use client";

import type { ReactNode } from "react";
import type { FieldValueSource, PriorStepField, TemplateField } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";

const SELECT_CLASS =
  "flex h-9 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-1.5 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none";

export const encodeSource = (source: FieldValueSource): string => {
  if (source.kind === "ai") return "ai";
  if (source.kind === "none") return "none";
  if (source.kind === "literal") return "literal";
  return `step:${source.nodeId}:${source.fieldKey}`;
};

export const decodeSource = (raw: string, previous: FieldValueSource): FieldValueSource => {
  if (raw === "ai") return { kind: "ai" };
  if (raw === "none") return { kind: "none" };
  if (raw === "literal") {
    return { kind: "literal", value: previous.kind === "literal" ? previous.value : "" };
  }
  const [, nodeId, fieldKey] = raw.split(":");
  return { kind: "step_field", nodeId: nodeId ?? "", fieldKey: fieldKey ?? "" };
};

interface StepGroup {
  stepNumber: number;
  stepName: string;
  fields: PriorStepField[];
}

// Group prior-step fields by their source step so the dropdown can render one
// non-selectable header per step (category B). Steps are ordered by number.
export const groupPriorStepFields = (priorStepFields: PriorStepField[]): StepGroup[] => {
  const groups = new Map<number, StepGroup>();
  for (const prior of priorStepFields) {
    const existing = groups.get(prior.stepNumber);
    if (existing) {
      existing.fields.push(prior);
      continue;
    }
    groups.set(prior.stepNumber, {
      stepNumber: prior.stepNumber,
      stepName: prior.stepName,
      fields: [prior],
    });
  }
  return [...groups.values()].sort((a, b) => a.stepNumber - b.stepNumber);
};

interface FieldValueSelectorProps {
  value: FieldValueSource;
  onChange: (next: FieldValueSource) => void;
  priorStepFields: PriorStepField[];
  // Overrides how the "Type anything" (literal) case is edited.
  renderLiteral?: (value: string, onChange: (next: string) => void) => ReactNode;
  literalLabel?: string;
}

export function FieldValueSelector({
  value,
  onChange,
  priorStepFields,
  renderLiteral,
  literalLabel = "Type anything",
}: FieldValueSelectorProps) {
  const groups = groupPriorStepFields(priorStepFields);
  return (
    <div className="space-y-1">
      <select
        className={SELECT_CLASS}
        value={encodeSource(value)}
        onChange={(event) => onChange(decodeSource(event.target.value, value))}
      >
        <option value="ai">AI decides (or asks the user if uncertain)</option>
        {groups.map((group) => (
          <optgroup key={group.stepNumber} label={`${group.stepNumber}. ${group.stepName}`}>
            {group.fields.map((prior) => (
              <option key={`${prior.nodeId}:${prior.field.key}`} value={`step:${prior.nodeId}:${prior.field.key}`}>
                {group.stepNumber} {group.stepName} — {prior.field.label} ({prior.field.type})
              </option>
            ))}
          </optgroup>
        ))}
        <option value="literal">{literalLabel}</option>
        <option value="none">No value</option>
      </select>
      {value.kind === "literal" &&
        (renderLiteral ? (
          renderLiteral(value.value, (next) => onChange({ kind: "literal", value: next }))
        ) : (
          <Input
            value={value.value}
            onChange={(event) => onChange({ kind: "literal", value: event.target.value })}
            placeholder="Type anything"
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
  // Keys that may be removed (author-added custom fields). Workflow-derived
  // fields are non-removable and omit the remove control.
  removableKeys?: string[];
  onRemove?: (key: string) => void;
}

// Renders one row per field — the field label/type (read-only) plus the value
// selector. Used for both workflow-derived inputs and author-added fields.
export function FieldValueList({
  fields,
  values,
  onChange,
  priorStepFields,
  removableKeys,
  onRemove,
}: FieldValueListProps) {
  if (fields.length === 0) return null;
  const removable = new Set(removableKeys ?? []);
  return (
    <div className="space-y-2">
      {fields.map((field) => (
        <div
          key={field.key}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2 rounded-[9px] border border-[#ece9e3] bg-[#faf9f7] p-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-[#1a1814]">{field.label}</span>
            <span className="shrink-0 rounded bg-[#efede8] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#6d6a65]">
              {field.type}
            </span>
          </div>
          <FieldValueSelector
            value={values[field.key] ?? { kind: "ai" }}
            onChange={(next) => onChange(field.key, next)}
            priorStepFields={priorStepFields}
          />
          {removable.has(field.key) && onRemove ? (
            <button
              type="button"
              aria-label={`Remove ${field.label}`}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[#c2385a] transition-colors hover:bg-[#fdf3f5]"
              onClick={() => onRemove(field.key)}
            >
              ×
            </button>
          ) : (
            <span className="w-7" />
          )}
        </div>
      ))}
    </div>
  );
}

export function ReadOnlyFieldList({ fields, emptyText }: { fields: TemplateField[]; emptyText: string }) {
  if (fields.length === 0) return <p className="text-[12px] text-[#6d6a65]">{emptyText}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {fields.map((field) => (
        <span
          key={field.key}
          className="inline-flex items-center gap-1 rounded-md border border-[#dedad2] bg-[#f7f6f3] px-2 py-1 text-[12px] text-[#5a5650]"
        >
          {field.label}
          <span className="text-[10px] uppercase tracking-wide text-[#6d6a65]">{field.type}</span>
        </span>
      ))}
    </div>
  );
}
