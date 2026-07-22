"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle, Plus, Settings2, X } from "lucide-react";
import {
  deriveFieldKey,
  parseTemplateField,
  templateFieldToLine,
  type TemplateField,
} from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The subset of field types a structured conversation can capture. `select` /
// `multiselect` are the UI names for an options / multi-options field.
type StructuredType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "email"
  | "yesno"
  | "select"
  | "multiselect";

const TYPE_OPTIONS: { value: StructuredType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "yesno", label: "Yes / No" },
  { value: "select", label: "Single-select" },
  { value: "multiselect", label: "Multi-select" },
];

interface FieldModel {
  label: string;
  type: StructuredType;
  optional: boolean;
  maxLength?: number;
  max?: number;
  min?: number;
  options: string[];
}

const emptyModel = (): FieldModel => ({ label: "", type: "text", optional: false, options: [] });

// Parses a stored `Label (annotations)` line into the editor model. A blank or
// unparseable line degrades to a plain text field carrying whatever text is
// there, so the row still renders and re-serialises cleanly on the next edit.
const lineToModel = (line: string): FieldModel => {
  if (!line.trim()) return emptyModel();
  const parsed = parseTemplateField(line);
  if (parsed.error) return { ...emptyModel(), label: line.trim() };
  const field = parsed.data;
  const type: StructuredType = field.options
    ? field.multiple
      ? "multiselect"
      : "select"
    : field.type === "number" ||
        field.type === "currency" ||
        field.type === "date" ||
        field.type === "email" ||
        field.type === "yesno"
      ? field.type
      : "text";
  return {
    label: field.label,
    type,
    optional: field.optional,
    options: field.options ?? [],
    ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
  };
};

// Serialises the model back to a canonical line via the domain serialiser. An
// empty label yields an empty line so the parent's parser skips it rather than
// flagging a "missing field name" error mid-typing.
const modelToLine = (model: FieldModel): string => {
  if (!model.label.trim()) return "";
  const hasOptions = model.type === "select" || model.type === "multiselect";
  // Narrow to a TemplateFieldType: options-backed fields serialise as `text`
  // carrying an (options) / (multi-options) annotation.
  const scalarType =
    model.type === "select" || model.type === "multiselect" ? "text" : model.type;
  const field: TemplateField = {
    key: deriveFieldKey(model.label),
    label: model.label.trim(),
    type: scalarType,
    optional: model.optional,
    raw: "",
    ...(hasOptions ? { options: model.options.filter((option) => option.trim().length > 0) } : {}),
    ...(model.type === "multiselect" ? { multiple: true } : {}),
    ...(model.maxLength !== undefined ? { maxLength: model.maxLength } : {}),
    ...(model.max !== undefined ? { max: model.max } : {}),
    ...(model.min !== undefined ? { min: model.min } : {}),
  };
  return templateFieldToLine(field);
};

interface StructuredFieldEditorProps {
  lines: string[];
  onChange: (lines: string[]) => void;
  // Opens the shared field-types explainer (the same dialog as document templates).
  onOpenHelp: () => void;
}

const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const linesToModels = (lines: string[]): FieldModel[] =>
  (lines.length > 0 ? lines : [""]).map(lineToModel);

export function StructuredFieldEditor({ lines, onChange, onOpenHelp }: StructuredFieldEditorProps) {
  // The field type is held in local state, not re-derived from `lines` on every
  // render. An options field with no choices yet serialises to a plain label
  // (its type annotation only appears once choices exist), so re-deriving from
  // the round-tripped line would silently reset Single/Multi-select back to Text.
  const [models, setModels] = useState<FieldModel[]>(() => linesToModels(lines));
  const lastEmittedRef = useRef<string[]>(lines);
  const [configIndex, setConfigIndex] = useState<number | null>(null);

  // Re-seed only when `lines` changes for a reason other than our own commit —
  // e.g. a different step's field set is loaded into the same editor instance.
  useEffect(() => {
    if (arraysEqual(lines, lastEmittedRef.current)) return;
    lastEmittedRef.current = lines;
    setModels(linesToModels(lines));
  }, [lines]);

  const commit = (next: FieldModel[]) => {
    setModels(next);
    const nextLines = next.map(modelToLine);
    lastEmittedRef.current = nextLines;
    onChange(nextLines);
  };

  const updateModel = (index: number, patch: Partial<FieldModel>) => {
    const next = models.map((model, i) => (i === index ? { ...model, ...patch } : model));
    commit(next);
  };

  const changeType = (index: number, type: StructuredType) => {
    // Drop constraints that no longer apply to the new type so a switched field
    // never carries a stray (max) or (options) into the serialised line.
    const model = models[index];
    if (!model) return;
    const cleared: FieldModel = {
      label: model.label,
      type,
      optional: model.optional,
      options: type === "select" || type === "multiselect" ? model.options : [],
    };
    updateModel(index, cleared);
  };

  const addRow = () => commit([...models, emptyModel()]);

  const removeRow = (index: number) => {
    const next = models.filter((_, i) => i !== index);
    commit(next.length > 0 ? next : [emptyModel()]);
  };

  const activeModel = configIndex !== null ? models[configIndex] : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <FieldGroupLabel id="structured-fields-label">Fields to capture</FieldGroupLabel>
        <button
          type="button"
          aria-label="How field types work"
          className="flex h-4 w-4 items-center justify-center rounded-full text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
          onClick={onOpenHelp}
        >
          <HelpCircle size={13} />
        </button>
      </div>
      <p className="text-[12px] text-[#6d6a65]">
        Add each value the AI should capture. Pick a type, and use the cog to set whether it is
        required, limits, and any choices.
      </p>

      <div className="space-y-2">
        {models.map((model, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={model.label}
              onChange={(event) => updateModel(index, { label: event.target.value })}
              placeholder="e.g. Preferred Vendor"
              className="flex-1"
              aria-label={`Field ${index + 1} label`}
            />
            <select
              aria-label={`Field ${index + 1} type`}
              value={model.type}
              onChange={(event) => changeType(index, event.target.value as StructuredType)}
              className="h-10 shrink-0 rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none"
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Configure field ${index + 1}`}
              className="shrink-0 rounded-md p-1.5 text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
              onClick={() => setConfigIndex(index)}
            >
              <Settings2 size={15} />
            </button>
            <button
              type="button"
              aria-label={`Remove field ${index + 1}`}
              className="shrink-0 rounded-md p-1.5 text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#c2385a]"
              onClick={() => removeRow(index)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="mt-1 flex items-center gap-1 text-[12px] text-[#3a5fd9] transition-colors hover:text-[#2e4bb0]"
        onClick={addRow}
      >
        <Plus size={13} /> Add field
      </button>

      {activeModel && configIndex !== null && (
        <FieldConfigModal
          model={activeModel}
          onChange={(patch) => updateModel(configIndex, patch)}
          onClose={() => setConfigIndex(null)}
        />
      )}
    </div>
  );
}

// The per-field "cog" mini modal: required/optional plus the constraints that
// make sense for the field's type.
function FieldConfigModal({
  model,
  onChange,
  onClose,
}: {
  model: FieldModel;
  onChange: (patch: Partial<FieldModel>) => void;
  onClose: () => void;
}) {
  const isNumeric = model.type === "number" || model.type === "currency";
  const hasOptions = model.type === "select" || model.type === "multiselect";

  const numberOrUndefined = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Field settings{model.label.trim() ? ` — ${model.label.trim()}` : ""}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="field-required">Required</Label>
              <p className="text-[12px] text-[#6d6a65]">
                When on, this value must be captured before the step can complete.
              </p>
            </div>
            <button
              id="field-required"
              type="button"
              role="switch"
              aria-checked={!model.optional}
              onClick={() => onChange({ optional: !model.optional })}
              className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                !model.optional ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  !model.optional ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {model.type === "text" && (
            <div className="space-y-1">
              <Label htmlFor="field-maxlen">Maximum length (characters)</Label>
              <Input
                id="field-maxlen"
                type="number"
                min={1}
                value={model.maxLength ?? ""}
                onChange={(event) => onChange({ maxLength: numberOrUndefined(event.target.value) })}
                placeholder="No limit"
              />
            </div>
          )}

          {isNumeric && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="field-min">Minimum</Label>
                <Input
                  id="field-min"
                  type="number"
                  value={model.min ?? ""}
                  onChange={(event) => onChange({ min: numberOrUndefined(event.target.value) })}
                  placeholder="None"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="field-max">Maximum</Label>
                <Input
                  id="field-max"
                  type="number"
                  value={model.max ?? ""}
                  onChange={(event) => onChange({ max: numberOrUndefined(event.target.value) })}
                  placeholder="None"
                />
              </div>
            </div>
          )}

          {hasOptions && (
            <div className="space-y-1">
              <Label htmlFor="field-options">Choices (one per line)</Label>
              <textarea
                id="field-options"
                rows={4}
                value={model.options.join("\n")}
                onChange={(event) =>
                  onChange({ options: event.target.value.split("\n").map((line) => line.replace(/,/g, " ")) })
                }
                placeholder={"Approved\nRejected\nPending"}
                className="w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none"
              />
              <p className="text-[12px] text-[#6d6a65]">
                Commas are not allowed inside a choice — put each choice on its own line.
              </p>
            </div>
          )}

          {model.type === "multiselect" && (
            <div className="space-y-1">
              <Label htmlFor="field-maxselect">Maximum number of choices selectable</Label>
              <Input
                id="field-maxselect"
                type="number"
                min={1}
                value={model.max ?? ""}
                onChange={(event) => onChange({ max: numberOrUndefined(event.target.value) })}
                placeholder="No limit"
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
