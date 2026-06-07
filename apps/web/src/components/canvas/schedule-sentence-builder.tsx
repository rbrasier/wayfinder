"use client";

import type { PriorStepField } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";
import { groupPriorStepFields } from "./field-value-selector";
import type { ScheduleModifier, ScheduleUnit } from "./scheduled-node-config";

const SELECT_CLASS =
  "flex h-9 rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-2.5 py-1.5 text-[13px] text-[#1a1814] focus:border-[#1f8a4c] focus:bg-white focus:outline-none";

const UNITS: { value: ScheduleUnit; label: string }[] = [
  { value: "m", label: "minutes" },
  { value: "h", label: "hours" },
  { value: "d", label: "days" },
  { value: "w", label: "weeks" },
];

const MODIFIERS: { value: ScheduleModifier; label: string }[] = [
  { value: "after", label: "after" },
  { value: "before", label: "before" },
  { value: "on", label: "on" },
];

interface ScheduleSentenceBuilderProps {
  number: string;
  unit: ScheduleUnit;
  modifier: ScheduleModifier;
  anchorChoice: string;
  priorStepFields: PriorStepField[];
  onNumberChange: (value: string) => void;
  onUnitChange: (value: ScheduleUnit) => void;
  onModifierChange: (value: ScheduleModifier) => void;
  onAnchorChange: (value: string) => void;
}

// The `[Number] [Unit ▼] [Modifier ▼] [Anchor ▼]` mad-lib row. Choosing the
// "on" modifier fires exactly at the anchor, so the number and unit are hidden.
export function ScheduleSentenceBuilder({
  number,
  unit,
  modifier,
  anchorChoice,
  priorStepFields,
  onNumberChange,
  onUnitChange,
  onModifierChange,
  onAnchorChange,
}: ScheduleSentenceBuilderProps) {
  const showAmount = modifier !== "on";
  const groups = groupPriorStepFields(priorStepFields);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showAmount && (
        <>
          <Input
            aria-label="Amount"
            type="number"
            min="1"
            className="h-9 w-16"
            value={number}
            onChange={(event) => onNumberChange(event.target.value)}
          />
          <select
            aria-label="Unit"
            className={SELECT_CLASS}
            value={unit}
            onChange={(event) => onUnitChange(event.target.value as ScheduleUnit)}
          >
            {UNITS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      )}
      <select
        aria-label="Modifier"
        className={SELECT_CLASS}
        value={modifier}
        onChange={(event) => onModifierChange(event.target.value as ScheduleModifier)}
      >
        {MODIFIERS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Anchor"
        className={SELECT_CLASS}
        value={anchorChoice}
        onChange={(event) => onAnchorChange(event.target.value)}
      >
        <option value="node_reached">This step reached</option>
        <option value="flow_started">Flow started</option>
        {groups.map((group) => (
          <optgroup key={group.stepNumber} label={`${group.stepNumber}. ${group.stepName}`}>
            {group.fields.map((prior) => (
              <option key={`${prior.nodeId}:${prior.field.key}`} value={`step:${prior.nodeId}:${prior.field.key}`}>
                {group.stepNumber} {group.stepName} — {prior.field.label} ({prior.field.type})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
