import { describeRecurrenceRule, parseRecurrenceRule } from "@rbrasier/domain";

// A human summary for the canvas subtitle of legacy recurrence schedules; falls
// back when the stored spec is not a recurrence rule (e.g. a legacy cron
// string). Recurrence authoring has been withdrawn, but existing recurrence
// rows must still render.
export const recurrenceSummary = (spec: string): string => {
  const rule = parseRecurrenceRule(spec);
  if (rule.error) return "Custom schedule";
  return describeRecurrenceRule(rule.data);
};
