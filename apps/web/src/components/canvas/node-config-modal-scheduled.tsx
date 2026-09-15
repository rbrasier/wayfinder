"use client";

import type { PriorStepField } from "@wayfinder/domain";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScheduleSentenceBuilder } from "./schedule-sentence-builder";
import type {
  ScheduleModifier,
  ScheduleUnit,
  ScheduleWhen,
} from "./scheduled-node-config";
import type { NodeConfigValues } from "./node-config-modal";

const SCHEDULE_SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2 text-[13px] text-[#1c1b19] focus:border-[#1f6b4d] focus:bg-white focus:outline-none";

export interface NodeConfigModalScheduledProps {
  values: NodeConfigValues;
  set: <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) => void;
  priorStepFields: PriorStepField[];
}

export function NodeConfigModalScheduled({
  values,
  set,
  priorStepFields,
}: NodeConfigModalScheduledProps) {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="schedule-when">When should this run?</Label>
        <select
          id="schedule-when"
          className={SCHEDULE_SELECT_CLASS}
          value={values.scheduleWhen}
          onChange={(e) => set("scheduleWhen", e.target.value as ScheduleWhen)}
        >
          <option value="ai">AI Decides (or asks the user)</option>
          <option value="specific">Pick a date and time</option>
          <option value="describe">Type anything</option>
        </select>
      </div>

      {values.scheduleWhen === "ai" && (
        <p className="text-[12px] text-[#666055]">
          The AI chooses the fire time from the session context, or asks the user.
        </p>
      )}

      {values.scheduleWhen === "specific" && (
        <div className="space-y-1" role="group" aria-labelledby="ncm-fire-step">
          <FieldGroupLabel id="ncm-fire-step">Fire this step</FieldGroupLabel>
          <ScheduleSentenceBuilder
            number={values.scheduleNumber}
            unit={values.scheduleUnit}
            modifier={values.scheduleModifier}
            anchorChoice={values.scheduleAnchorChoice}
            priorStepFields={priorStepFields}
            onNumberChange={(value) => set("scheduleNumber", value)}
            onUnitChange={(value: ScheduleUnit) => set("scheduleUnit", value)}
            onModifierChange={(value: ScheduleModifier) => set("scheduleModifier", value)}
            onAnchorChange={(value) => set("scheduleAnchorChoice", value)}
          />
        </div>
      )}

      {values.scheduleWhen === "describe" && (
        <div className="space-y-1">
          <Label htmlFor="schedule-describe">Describe when to run</Label>
          <Textarea
            id="schedule-describe"
            rows={3}
            value={values.scheduleDescribeText}
            onChange={(e) => set("scheduleDescribeText", e.target.value)}
            placeholder="e.g. two business days after the invoice is approved"
          />
          <p className="text-[12px] text-[#666055]">
            The AI works out the exact date and time from the session at runtime.
          </p>
        </div>
      )}
    </>
  );
}
