"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle, Plus } from "lucide-react";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { FieldConfigModal, FieldRow } from "./field-row";
import {
  emptyModel,
  linesToModels,
  modelToLine,
  withType,
  type FieldModel,
  type FieldRowType,
} from "./field-row-model";

interface StructuredFieldEditorProps {
  lines: string[];
  onChange: (lines: string[]) => void;
  // Opens the shared field-types explainer (the same dialog as document templates).
  onOpenHelp: () => void;
}

const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

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
    commit(models.map((model, i) => (i === index ? { ...model, ...patch } : model)));
  };

  const changeType = (index: number, type: FieldRowType) => {
    const model = models[index];
    if (!model) return;
    commit(models.map((entry, i) => (i === index ? withType(entry, type) : entry)));
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
          className="flex h-4 w-4 items-center justify-center rounded-full text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
          onClick={onOpenHelp}
        >
          <HelpCircle size={13} />
        </button>
      </div>
      <p className="text-[12px] text-[#666055]">
        Add each value the AI should capture. Pick a type, and use the cog to set whether it is
        required, limits, and any choices.
      </p>

      <div className="space-y-2">
        {models.map((model, index) => (
          <FieldRow
            key={index}
            model={model}
            index={index}
            onChange={(patch) => updateModel(index, patch)}
            onChangeType={(type) => changeType(index, type)}
            onRemove={() => removeRow(index)}
            onOpenConfig={() => setConfigIndex(index)}
          />
        ))}
      </div>

      <button
        type="button"
        className="mt-1 flex items-center gap-1 text-[12px] text-wf-primary transition-colors hover:text-wf-primary-hover"
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
