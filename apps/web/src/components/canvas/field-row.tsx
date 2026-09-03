"use client";

import { Settings2, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  hasNonDefaultConfig,
  STRUCTURED_TYPE_OPTIONS,
  type FieldModel,
  type FieldRowType,
  type FieldRowTypeOption,
} from "./field-row-model";

interface FieldRowProps {
  model: FieldModel;
  index: number;
  onChange: (patch: Partial<FieldModel>) => void;
  onChangeType: (type: FieldRowType) => void;
  onRemove: () => void;
  onOpenConfig: () => void;
  typeOptions?: FieldRowTypeOption[];
  labelPlaceholder?: string;
}

// One field's inline controls — name, type, config cog, remove. Shared verbatim
// between the structured conversation editor and the template annotation editor
// so the two never drift; the cog's accent colouring therefore applies to both
// by construction rather than by being implemented twice.
export function FieldRow({
  model,
  index,
  onChange,
  onChangeType,
  onRemove,
  onOpenConfig,
  typeOptions = STRUCTURED_TYPE_OPTIONS,
  labelPlaceholder = "e.g. Preferred Vendor",
}: FieldRowProps) {
  const configured = hasNonDefaultConfig(model);

  return (
    <div className="flex items-center gap-2">
      <Input
        value={model.label}
        onChange={(event) => onChange({ label: event.target.value })}
        placeholder={labelPlaceholder}
        className="flex-1"
        aria-label={`Field ${index + 1} label`}
      />
      <select
        aria-label={`Field ${index + 1} type`}
        value={model.type}
        onChange={(event) => onChangeType(event.target.value as FieldRowType)}
        className="h-10 shrink-0 rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-2 text-[13px] text-[#1c1b19] focus:border-[#2f56d3] focus:bg-white focus:outline-none"
      >
        {typeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={`Configure field ${index + 1}`}
        data-configured={configured ? "true" : "false"}
        title={configured ? "Options set" : "Field settings"}
        className={`shrink-0 rounded-md p-1.5 transition-colors ${
          configured
            ? "text-[#2f56d3] hover:bg-[#eaeefb] hover:text-[#1f3ea8]"
            : "text-[#666055] hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
        }`}
        onClick={onOpenConfig}
      >
        <Settings2 size={15} />
      </button>
      <button
        type="button"
        aria-label={`Remove field ${index + 1}`}
        className="shrink-0 rounded-md p-1.5 text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#a8324c]"
        onClick={onRemove}
      >
        <X size={14} />
      </button>
    </div>
  );
}

const numberOrUndefined = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
};

// The per-field "cog" mini modal: required/optional plus the constraints that
// make sense for the field's type.
export function FieldConfigModal({
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
  const isSignature = model.type === "signature";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Field settings{model.label.trim() ? ` — ${model.label.trim()}` : ""}
          </DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          {/* A signature carries no author-supplied value, so there is nothing
              for a length, bound or required toggle to constrain — and
              parseTemplateField rejects a signature that carries any of them. */}
          {isSignature && (
            <p className="text-[12px] leading-[1.55] text-[#5c574c]">
              This slot is filled by the approval step that signs it — the approver&apos;s name,
              decision, date and comment are written in when they decide. Nobody is asked for it
              during the conversation, and it has no settings.
            </p>
          )}

          {!isSignature && (
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="field-required">Required</Label>
                <p className="text-[12px] text-[#666055]">
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
                  !model.optional ? "bg-[#1f6b4d]" : "bg-[#dedad2]"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    !model.optional ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          )}

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

          {model.type === "narrative" && (
            <div className="space-y-1">
              <Label htmlFor="field-instruction">What this field is for</Label>
              <textarea
                id="field-instruction"
                rows={3}
                value={model.instruction ?? ""}
                onChange={(event) => onChange({ instruction: event.target.value })}
                placeholder="e.g. The background to this procurement — what prompted it, what has been tried, and why it matters now"
                className="w-full rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2 text-[13px] text-[#1c1b19] focus:border-[#2f56d3] focus:bg-white focus:outline-none"
              />
              <p className="text-[12px] text-[#666055]">
                The AI uses this to explain to the person what the field needs, ask for anything
                missing, and write up their answer. Say what it should cover, not how to phrase it.
              </p>
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
                  onChange({
                    options: event.target.value.split("\n").map((line) => line.replace(/,/g, " ")),
                  })
                }
                placeholder={"Approved\nRejected\nPending"}
                className="w-full rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2 text-[13px] text-[#1c1b19] focus:border-[#2f56d3] focus:bg-white focus:outline-none"
              />
              <p className="text-[12px] text-[#666055]">
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
