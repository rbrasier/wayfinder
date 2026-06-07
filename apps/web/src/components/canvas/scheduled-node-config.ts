import type { FieldValueSource, ScheduleAnchor } from "@rbrasier/domain";
import type { NodeConfigValues } from "./node-config-modal";

// Maps the modal's scheduling fields to the persisted ScheduledNodeConfig jsonb,
// and back. The author chooses one of three "when" modes; "specific" drives the
// mad-lib sentence builder. Recurrence authoring has been withdrawn — legacy
// recurrence/cron rows open in the builder with sensible defaults.

export type ScheduleWhen = "ai" | "specific" | "describe";
export type ScheduleUnit = "m" | "h" | "d" | "w";
export type ScheduleModifier = "after" | "before" | "on";

// The mad-lib anchor dropdown collapses anchor + anchorSource into a single
// string: a fixed anchor, or a prior-step field encoded as `step:<node>:<key>`.
export const encodeAnchorChoice = (
  anchor: ScheduleAnchor | undefined,
  anchorSource: FieldValueSource | undefined,
): string => {
  if (anchor === "step_field" && anchorSource?.kind === "step_field") {
    return `step:${anchorSource.nodeId}:${anchorSource.fieldKey}`;
  }
  if (anchor === "flow_started") return "flow_started";
  return "node_reached";
};

export const decodeAnchorChoice = (
  choice: string,
): { anchor: ScheduleAnchor; anchorSource?: FieldValueSource } => {
  if (choice === "flow_started") return { anchor: "flow_started" };
  if (choice.startsWith("step:")) {
    const [, nodeId, fieldKey] = choice.split(":");
    return {
      anchor: "step_field",
      anchorSource: { kind: "step_field", nodeId: nodeId ?? "", fieldKey: fieldKey ?? "" },
    };
  }
  return { anchor: "node_reached" };
};

const RELATIVE_SPEC = /^(\d+)\s*([smhdw])$/;

const readSpec = (spec: string): { amount: number; unit: ScheduleUnit } => {
  const match = RELATIVE_SPEC.exec(spec.trim());
  if (!match) return { amount: 1, unit: "d" };
  const amount = Number(match[1]);
  const raw = match[2];
  const unit: ScheduleUnit = raw === "m" || raw === "h" || raw === "w" ? raw : "d";
  return { amount, unit };
};

export const scheduledConfigFromValues = (values: NodeConfigValues): Record<string, unknown> => {
  if (values.scheduleWhen === "ai") {
    return { kind: "at", spec: "", specSource: { kind: "ai" }, recurring: false, maxOccurrences: null };
  }

  if (values.scheduleWhen === "describe") {
    return {
      kind: "at",
      spec: "",
      specSource: { kind: "ai" },
      describeText: values.scheduleDescribeText,
      recurring: false,
      maxOccurrences: null,
    };
  }

  const { anchor, anchorSource } = decodeAnchorChoice(values.scheduleAnchorChoice);
  const isOn = values.scheduleModifier === "on";
  const spec = isOn ? "0s" : `${Number(values.scheduleNumber) || 1}${values.scheduleUnit}`;
  return {
    kind: "relative",
    spec,
    recurring: false,
    maxOccurrences: null,
    anchor,
    ...(anchorSource ? { anchorSource } : {}),
    relativeDirection: isOn ? "after" : values.scheduleModifier,
  };
};

export const scheduledValuesFromConfig = (
  config: Record<string, unknown>,
): Partial<NodeConfigValues> => {
  const storedKind = config.kind as string | undefined;

  const defaults: Partial<NodeConfigValues> = {
    scheduleWhen: "specific",
    scheduleNumber: "1",
    scheduleUnit: "d",
    scheduleModifier: "after",
    scheduleAnchorChoice: "node_reached",
    scheduleDescribeText: "",
  };

  if (storedKind === "at") {
    const describeText = config.describeText ? String(config.describeText) : "";
    return {
      ...defaults,
      scheduleWhen: describeText ? "describe" : "ai",
      scheduleDescribeText: describeText,
    };
  }

  // relative (and legacy recurrence/cron) open in the mad-lib builder.
  const { amount, unit } = readSpec(String(config.spec ?? ""));
  const direction = config.relativeDirection === "before" ? "before" : "after";
  return {
    ...defaults,
    scheduleWhen: "specific",
    scheduleNumber: amount > 0 ? String(amount) : "1",
    scheduleUnit: amount > 0 ? unit : "d",
    scheduleModifier: amount === 0 ? "on" : direction,
    scheduleAnchorChoice: encodeAnchorChoice(
      config.anchor as ScheduleAnchor | undefined,
      config.anchorSource as FieldValueSource | undefined,
    ),
  };
};
