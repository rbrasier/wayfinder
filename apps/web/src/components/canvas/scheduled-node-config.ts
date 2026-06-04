import {
  parseRecurrenceRule,
  serializeRecurrenceRule,
  type FieldValueSource,
} from "@rbrasier/domain";
import type { NodeConfigValues, ScheduleAnchor, ScheduleKind } from "./node-config-modal";
import { browserTimezone, buildRecurrenceRule } from "./scheduled-config";

// Maps the modal's flat scheduling fields to the persisted ScheduledNodeConfig
// jsonb, and back. Shared by the user and admin flow editors so both serialise
// recurrence identically.

export const scheduledConfigFromValues = (values: NodeConfigValues): Record<string, unknown> => {
  if (values.scheduleKind === "recurrence") {
    const rule = buildRecurrenceRule({
      frequency: values.recurrenceFrequency,
      interval: Number(values.recurrenceInterval) || 1,
      weekdays: values.recurrenceWeekdays,
      monthDay: Number(values.recurrenceMonthDay) || 1,
      hour: values.recurrenceHour,
      minute: values.recurrenceMinute,
      timezone: values.recurrenceTimezone || browserTimezone(),
    });
    return {
      kind: "recurrence",
      spec: serializeRecurrenceRule(rule),
      recurring: true,
      maxOccurrences: values.scheduleMaxOccurrences ? Number(values.scheduleMaxOccurrences) : null,
    };
  }

  if (values.scheduleKind === "at") {
    const source = values.scheduleSpecSource;
    return {
      kind: "at",
      spec: source.kind === "literal" ? source.value : "",
      specSource: source,
      recurring: false,
      maxOccurrences: null,
    };
  }

  return {
    kind: "relative",
    spec: values.scheduleSpec,
    recurring: false,
    maxOccurrences: null,
    anchor: values.scheduleAnchor,
    metadataKey: values.scheduleAnchor === "step_metadata" ? values.scheduleMetadataKey : null,
  };
};

export const scheduledValuesFromConfig = (
  config: Record<string, unknown>,
): Partial<NodeConfigValues> => {
  const storedKind = config.kind as string | undefined;
  // A new node has no stored kind yet — start it on the simplest "run after a
  // delay" (relative) option. Only an existing non-plain-language kind (legacy
  // `cron`, or an already-stored `recurrence`) opens in the recurrence builder.
  const kind: ScheduleKind =
    storedKind === "relative" || storedKind === "at"
      ? storedKind
      : storedKind
        ? "recurrence"
        : "relative";

  const base: Partial<NodeConfigValues> = {
    scheduleKind: kind,
    scheduleSpec: kind === "relative" ? String(config.spec ?? "") : "",
    scheduleSpecSource:
      (config.specSource as FieldValueSource | undefined) ??
      (storedKind === "at" && config.spec
        ? { kind: "literal", value: String(config.spec) }
        : { kind: "ai" }),
    scheduleRecurring: Boolean(config.recurring),
    scheduleMaxOccurrences: config.maxOccurrences != null ? String(config.maxOccurrences) : "",
    scheduleAnchor: (config.anchor as ScheduleAnchor | undefined) ?? "node_reached",
    scheduleMetadataKey: (config.metadataKey as string | null) ?? "",
  };

  if (kind !== "recurrence") return base;

  const parsed = storedKind === "recurrence" ? parseRecurrenceRule(String(config.spec ?? "")) : undefined;
  const rule = parsed && !parsed.error ? parsed.data : undefined;
  return {
    ...base,
    recurrenceFrequency: rule?.frequency ?? "weekly",
    recurrenceInterval: String(rule?.interval ?? 1),
    recurrenceWeekdays: rule?.weekdays ?? [],
    recurrenceMonthDay: String(rule?.monthDay ?? 1),
    recurrenceHour: rule?.hour ?? 9,
    recurrenceMinute: rule?.minute ?? 0,
    recurrenceTimezone: rule?.timezone ?? "",
  };
};
