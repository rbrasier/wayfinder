"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface McpConfirmCardProps {
  stepName: string;
  toolName: string;
  // The planned tool arguments. String values render as text inputs; everything
  // else renders as a JSON field parsed on Proceed.
  args: Record<string, unknown>;
  onProceed: (editedArgs: Record<string, unknown>) => void;
  isPending?: boolean;
}

// Serialises a planned value into an editable string. Strings pass through so the
// operator edits plain text; structured values are shown as JSON.
const toEditable = (value: unknown): { text: string; isJson: boolean } =>
  typeof value === "string"
    ? { text: value, isJson: false }
    : { text: JSON.stringify(value, null, 2), isJson: true };

// The human-in-the-loop confirmation for a write MCP action (ADR-032, Phase B).
// Shows the AI-selected tool and its arguments, lets the operator edit every value,
// and only runs the tool — with exactly what is shown — once they click Proceed.
export function McpConfirmCard({
  stepName,
  toolName,
  args,
  onProceed,
  isPending = false,
}: McpConfirmCardProps) {
  const entries = Object.entries(args);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reseed the editable fields whenever a new action is parked.
  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) seeded[key] = toEditable(value).text;
    setValues(seeded);
    setErrors({});
  }, [args]);

  const handleProceed = () => {
    const edited: Record<string, unknown> = {};
    const nextErrors: Record<string, string> = {};
    for (const [key, value] of entries) {
      const raw = values[key] ?? "";
      if (typeof value === "string") {
        edited[key] = raw;
        continue;
      }
      try {
        edited[key] = JSON.parse(raw);
      } catch {
        nextErrors[key] = "Not valid JSON.";
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    onProceed(edited);
  };

  return (
    <div className="flex shrink-0 justify-center border-t border-[#dedad2] bg-[#f7f6f3] px-4 py-3">
      <div className="w-full max-w-lg rounded-[10px] border border-[#dedad2] bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[#eaf6f0] text-[#1c7d45]">
            <Play className="h-[15px] w-[15px] stroke-[1.8]" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[#1a1814]">
              Run {toolName}?
            </p>
            <p className="truncate text-[11px] text-[#6d6a65]">
              {stepName} — review and edit the details, then Proceed.
            </p>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="mb-2 text-[12px] text-[#6d6a65]">This tool takes no arguments.</p>
        ) : (
          <div className="mb-3 space-y-2">
            {entries.map(([key, value]) => {
              const { isJson } = toEditable(value);
              const fieldId = `mcp-arg-${key}`;
              return (
                <div key={key} className="space-y-1">
                  <label htmlFor={fieldId} className="block text-[12px] font-medium text-[#5a5650]">
                    {key}
                  </label>
                  {isJson ? (
                    <Textarea
                      id={fieldId}
                      rows={3}
                      className="font-mono text-[12px]"
                      value={values[key] ?? ""}
                      onChange={(event) =>
                        setValues((prev) => ({ ...prev, [key]: event.target.value }))
                      }
                    />
                  ) : (
                    <Input
                      id={fieldId}
                      value={values[key] ?? ""}
                      onChange={(event) =>
                        setValues((prev) => ({ ...prev, [key]: event.target.value }))
                      }
                    />
                  )}
                  {errors[key] && <p className="text-[11px] text-[#c2385a]">{errors[key]}</p>}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end">
          <Button size="sm" onClick={handleProceed} disabled={isPending}>
            {isPending ? "Running…" : "Proceed"}
          </Button>
        </div>
      </div>
    </div>
  );
}
