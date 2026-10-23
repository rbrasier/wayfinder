"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { deriveFieldKey, validateTriggerInputs, type TriggerInput, type TriggerInputType } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

const TYPES: TriggerInputType[] = ["text", "number", "date", "boolean", "json"];
const SELECT_CLASS =
  "h-9 rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-2 text-[13px] text-[#1c1b19] focus:border-wf-primary focus:outline-hidden";

// The inputs a watch or webhook hands this flow (ADR-064 §1). Steps pick them
// as "Trigger inputs" wherever they choose a value.
export function TriggerInputsEditor({ flowId, saved }: { flowId: string; saved: TriggerInput[] }) {
  const utils = trpc.useUtils();
  const [rows, setRows] = useState<TriggerInput[]>(saved);
  useEffect(() => setRows(saved), [saved]);
  const save = trpc.automation.setTriggerInputs.useMutation({
    onSuccess: async () => {
      toast.success("Trigger inputs saved. Publish the flow for new runs to use them.");
      await utils.automation.flowTriggers.invalidate({ flowId });
    },
    onError: (error) => toast.error(error.message),
  });
  const problems = validateTriggerInputs(rows);
  const update = (index: number, patch: Partial<TriggerInput>) =>
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-[13px] text-[#736d5f]">This flow expects no inputs.</p>}
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1.2fr_1fr_auto_auto_auto] items-center gap-2">
          <Input
            aria-label="Input label"
            value={row.label}
            placeholder="Hearing ID"
            onChange={(event) => {
              const label = event.target.value;
              const keyFollowsLabel = row.key === "" || row.key === deriveFieldKey(row.label);
              update(index, { label, ...(keyFollowsLabel ? { key: deriveFieldKey(label) } : {}) });
            }}
          />
          <Input
            aria-label="Input key"
            value={row.key}
            placeholder="hearing_id"
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <select
            aria-label="Input type"
            className={SELECT_CLASS}
            value={row.type}
            onChange={(event) => update(index, { type: event.target.value as TriggerInputType })}
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[12px] text-[#1c1b19]">
            <input
              type="checkbox"
              checked={row.required}
              onChange={(event) => update(index, { required: event.target.checked })}
            />
            Required
          </label>
          <button
            type="button"
            aria-label={`Remove ${row.label || "input"}`}
            className="text-[#736d5f] hover:text-[#1c1b19]"
            onClick={() => setRows((current) => current.filter((_, position) => position !== index))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {problems.length > 0 && rows.length > 0 && (
        <ul className="list-disc pl-5 text-[12px] text-[#b42318]">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRows((current) => [...current, { key: "", label: "", type: "text", required: false }])}
        >
          Add input
        </Button>
        <Button size="sm" disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate({ flowId, inputs: rows })}>
          {save.isPending ? "Saving…" : "Save inputs"}
        </Button>
      </div>
    </div>
  );
}
