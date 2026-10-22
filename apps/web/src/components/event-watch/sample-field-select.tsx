"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SELECT_CLASS } from "./watch-connection-fields";
import { isManualFieldValue, type SampleFieldOption } from "./watch-model";

const MANUAL = "__manual__";

interface SampleFieldSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (path: string) => void;
  options: SampleFieldOption[];
  // Shown on the empty choice, e.g. "Choose the field".
  emptyLabel: string;
  manualPlaceholder?: string;
}

// A field chosen from the sample response, auto-node style, with typing the
// path by hand as the escape hatch near the top of the list (ADR-063 §2).
export function SampleFieldSelect({
  id,
  label,
  value,
  onChange,
  options,
  emptyLabel,
  manualPlaceholder,
}: SampleFieldSelectProps) {
  const [manualChosen, setManualChosen] = useState(false);
  const manual = isManualFieldValue(value, options, manualChosen);
  const hasEmptyOption = !options.some((option) => option.path === "");

  const choose = (choice: string) => {
    if (choice === MANUAL) {
      setManualChosen(true);
      return;
    }
    setManualChosen(false);
    onChange(choice);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={SELECT_CLASS} value={manual ? MANUAL : value} onChange={(event) => choose(event.target.value)}>
        {hasEmptyOption && <option value="">{options.length === 0 ? "Test the connection to list fields" : emptyLabel}</option>}
        <option value={MANUAL}>Select manually…</option>
        {options.map((option) => (
          <option key={option.path || "(whole)"} value={option.path}>
            {option.label}
          </option>
        ))}
      </select>
      {manual && (
        <Input
          id={`${id}-manual`}
          aria-label={`${label} (typed path)`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={manualPlaceholder ?? "e.g. data.hearings[0].status"}
        />
      )}
    </div>
  );
}
