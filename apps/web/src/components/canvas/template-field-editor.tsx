"use client";

import { Plus, X } from "lucide-react";
import { parseTemplateField, type TemplateField } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ParsedFieldLines {
  fields: TemplateField[];
  valid: boolean;
}

// Parses each non-empty line as a `Label (annotations)` tag using the same
// parser as .docx templates, so malformed annotations surface the identical
// validation error. Blank lines are ignored.
export function parseFieldLines(lines: string[]): ParsedFieldLines {
  const fields: TemplateField[] = [];
  let valid = true;
  for (const line of lines) {
    if (!line.trim()) continue;
    const parsed = parseTemplateField(line);
    if (parsed.error) {
      valid = false;
      continue;
    }
    fields.push(parsed.data);
  }
  return { fields, valid };
}

const lineError = (line: string): string | null => {
  if (!line.trim()) return null;
  const parsed = parseTemplateField(line);
  return parsed.error ? parsed.error.message : null;
};

interface TemplateFieldEditorProps {
  label: string;
  helpText: string;
  lines: string[];
  onChange: (lines: string[]) => void;
}

export function TemplateFieldEditor({ label, helpText, lines, onChange }: TemplateFieldEditorProps) {
  const rows = lines.length > 0 ? lines : [""];

  const setLine = (index: number, value: string) => {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  };

  const addRow = () => onChange([...rows, ""]);

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [""]);
  };

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <p className="text-[12px] text-[#6d6a65]">{helpText}</p>
      <div className="space-y-2">
        {rows.map((line, index) => {
          const error = lineError(line);
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  value={line}
                  onChange={(e) => setLine(index, e.target.value)}
                  placeholder="e.g. Preferred Vendor (text)"
                  aria-invalid={error ? true : undefined}
                  className={error ? "border-[#c2385a]" : undefined}
                />
                <button
                  type="button"
                  aria-label="Remove field"
                  className="shrink-0 rounded-md p-1.5 text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#c2385a]"
                  onClick={() => removeRow(index)}
                >
                  <X size={14} />
                </button>
              </div>
              {error && <p className="text-[12px] text-[#c2385a]">{error}</p>}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="mt-1 flex items-center gap-1 text-[12px] text-[#3a5fd9] transition-colors hover:text-[#2e4bb0]"
        onClick={addRow}
      >
        <Plus size={13} /> Add field
      </button>
    </div>
  );
}
