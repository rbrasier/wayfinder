import { describe, expect, it } from "vitest";
import { scheduledConfigFromValues, scheduledValuesFromConfig } from "./scheduled-node-config";
import type { NodeConfigValues } from "./node-config-modal";

describe("scheduledValuesFromConfig", () => {
  it("defaults a brand-new node (empty config) to the relative kind", () => {
    const values = scheduledValuesFromConfig({});
    expect(values.scheduleKind).toBe("relative");
    expect(values.scheduleSpec).toBe("");
  });

  it("keeps relative and at kinds as authored", () => {
    expect(scheduledValuesFromConfig({ kind: "relative", spec: "30d" }).scheduleKind).toBe("relative");
    expect(scheduledValuesFromConfig({ kind: "at" }).scheduleKind).toBe("at");
  });

  it("opens a stored recurrence as a recurrence", () => {
    expect(scheduledValuesFromConfig({ kind: "recurrence", spec: "" }).scheduleKind).toBe("recurrence");
  });

  it("opens a legacy cron row as a recurrence so it can be re-expressed", () => {
    expect(scheduledValuesFromConfig({ kind: "cron", spec: "0 9 * * 1" }).scheduleKind).toBe("recurrence");
  });

  it("reads a relative spec back from the stored config", () => {
    const values = scheduledValuesFromConfig({ kind: "relative", spec: "45d", anchor: "node_reached" });
    expect(values.scheduleSpec).toBe("45d");
    expect(values.scheduleAnchor).toBe("node_reached");
  });
});

describe("scheduledConfigFromValues", () => {
  const base: NodeConfigValues = {
    name: "Wait",
    colour: "#1f8a4c",
    type: "scheduled",
    aiInstruction: "",
    doneWhen: "",
    neverDone: false,
    outputType: "conversation_only",
    instruction: "",
    executor: "n8n",
    workflowId: null,
    webhookUrl: "",
    requestFields: [],
    requestFieldValues: {},
    responseFields: [],
    scheduleKind: "relative",
    scheduleSpec: "30d",
    scheduleSpecSource: { kind: "ai" },
    scheduleRecurring: false,
    scheduleMaxOccurrences: "",
    scheduleAnchor: "node_reached",
    scheduleMetadataKey: "",
    recurrenceFrequency: "weekly",
    recurrenceInterval: "1",
    recurrenceWeekdays: [1],
    recurrenceMonthDay: "1",
    recurrenceHour: 9,
    recurrenceMinute: 0,
    recurrenceTimezone: "UTC",
  };

  it("serialises a relative schedule and round-trips back to relative", () => {
    const config = scheduledConfigFromValues(base);
    expect(config.kind).toBe("relative");
    expect(config.spec).toBe("30d");
    expect(scheduledValuesFromConfig(config).scheduleKind).toBe("relative");
  });
});
