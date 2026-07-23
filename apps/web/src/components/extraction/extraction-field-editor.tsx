"use client";

import { Lock, Plus, Settings2, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import {
  EXTRACTION_TYPE_OPTIONS,
  emptyExtractionField,
  type ExtractionFieldModel,
  type ExtractionFieldType,
} from "./extraction-editor-model";

interface ExtractionFieldEditorProps {
  fields: ExtractionFieldModel[];
  onChange: (fields: ExtractionFieldModel[]) => void;
  // Template mode: labels and types come from the uploaded template and are not
  // editable here — only per-field instructions and settings are. The add/remove
  // affordances are hidden so the field set stays in step with the template.
  derived?: boolean;
}

export function ExtractionFieldEditor({ fields, onChange, derived = false }: ExtractionFieldEditorProps) {
  const [configIndex, setConfigIndex] = useState<number | null>(null);

  const update = (index: number, patch: Partial<ExtractionFieldModel>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));

  const changeType = (index: number, type: ExtractionFieldType) => {
    const field = fields[index];
    if (!field) return;
    // Drop constraints that no longer apply so a switched field never carries a
    // stray (max) or (options) into its serialised line.
    update(index, {
      type,
      options: type === "select" || type === "multiselect" ? field.options : [],
      maxLength: undefined,
      min: undefined,
      max: undefined,
    });
  };

  const addRow = () => onChange([...fields, emptyExtractionField()]);

  const removeRow = (index: number) => {
    const next = fields.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [emptyExtractionField()]);
  };

  const activeField = configIndex !== null ? fields[configIndex] : null;

  return (
    <div className="space-y-1">
      <FieldGroupLabel id="extraction-fields-label">Fields to extract</FieldGroupLabel>
      <p className="text-[12px] text-[#6d6a65]">
        {derived
          ? "These come from your template. Pick a type and use the cog to add an instruction telling the AI what to pull for each one."
          : "Add each value the AI should pull. Pick a type, and use the cog to set whether it is required, limits, choices, and the extraction instruction."}
      </p>

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                value={field.label}
                onChange={(event) => update(index, { label: event.target.value })}
                placeholder="e.g. Supplier Name"
                aria-label={`Field ${index + 1} label`}
                readOnly={field.locked}
                className={field.locked ? "cursor-default bg-[#f2f0ec] pr-8 text-[#5a5650]" : undefined}
              />
              {field.locked && (
                <Lock
                  aria-hidden="true"
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#a29d93]"
                />
              )}
            </div>
            <select
              aria-label={`Field ${index + 1} type`}
              value={field.type}
              disabled={field.locked}
              onChange={(event) => changeType(index, event.target.value as ExtractionFieldType)}
              className="h-10 shrink-0 rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none disabled:cursor-default disabled:text-[#8a857c]"
            >
              {EXTRACTION_TYPE_OPTIONS.map((option) => (
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
            {!derived && (
              <button
                type="button"
                aria-label={`Remove field ${index + 1}`}
                className="shrink-0 rounded-md p-1.5 text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#c2385a]"
                onClick={() => removeRow(index)}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {!derived && (
        <button
          type="button"
          className="mt-1 flex items-center gap-1 text-[12px] text-[#3a5fd9] transition-colors hover:text-[#2e4bb0]"
          onClick={addRow}
        >
          <Plus size={13} /> Add field
        </button>
      )}

      {activeField && configIndex !== null && (
        <FieldSettingsModal
          field={activeField}
          onChange={(patch) => update(configIndex, patch)}
          onClose={() => setConfigIndex(null)}
        />
      )}
    </div>
  );
}

// The per-field cog modal: the extraction instruction plus required/optional and
// the constraints that make sense for the field's type — the same modal-driven
// approach as structured-conversation fields.
function FieldSettingsModal({
  field,
  onChange,
  onClose,
}: {
  field: ExtractionFieldModel;
  onChange: (patch: Partial<ExtractionFieldModel>) => void;
  onClose: () => void;
}) {
  const isNumeric = field.type === "number" || field.type === "currency";
  const hasOptions = field.type === "select" || field.type === "multiselect";

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
          <DialogTitle>Field settings{field.label.trim() ? ` — ${field.label.trim()}` : ""}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1">
            <Label htmlFor="field-instruction">Instruction</Label>
            <Textarea
              id="field-instruction"
              rows={3}
              value={field.instruction}
              onChange={(event) => onChange({ instruction: event.target.value })}
              placeholder="What should the AI pull for this field?"
            />
            <p className="text-[12px] text-[#6d6a65]">
              Left blank, the field name is used as the instruction.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="field-required">Required</Label>
              <p className="text-[12px] text-[#6d6a65]">
                When on, this value must be captured for the record to be complete.
              </p>
            </div>
            <button
              id="field-required"
              type="button"
              role="switch"
              aria-checked={!field.optional}
              onClick={() => onChange({ optional: !field.optional })}
              className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                !field.optional ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  !field.optional ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {field.type === "text" && (
            <div className="space-y-1">
              <Label htmlFor="field-maxlen">Maximum length (characters)</Label>
              <Input
                id="field-maxlen"
                type="number"
                min={1}
                value={field.maxLength ?? ""}
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
                  value={field.min ?? ""}
                  onChange={(event) => onChange({ min: numberOrUndefined(event.target.value) })}
                  placeholder="None"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="field-max">Maximum</Label>
                <Input
                  id="field-max"
                  type="number"
                  value={field.max ?? ""}
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
                value={field.options.join("\n")}
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
