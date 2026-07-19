import { describe, expect, it } from "vitest";
import {
  decodeAnchorChoice,
  encodeAnchorChoice,
  scheduledConfigFromValues,
  scheduledValuesFromConfig,
} from "./scheduled-node-config";
import type { NodeConfigValues } from "./node-config-modal";

describe("scheduledValuesFromConfig", () => {
  it("defaults a brand-new node (empty config) to the specific mad-lib builder", () => {
    const values = scheduledValuesFromConfig({});
    expect(values.scheduleWhen).toBe("specific");
    expect(values.scheduleNumber).toBe("1");
    expect(values.scheduleUnit).toBe("d");
    expect(values.scheduleModifier).toBe("after");
    expect(values.scheduleAnchorChoice).toBe("node_reached");
  });

  it("opens an `at` ai schedule as 'AI decides'", () => {
    expect(scheduledValuesFromConfig({ kind: "at", specSource: { kind: "ai" } }).scheduleWhen).toBe("ai");
  });

  it("opens an `at` schedule with describeText as 'Type anything'", () => {
    const values = scheduledValuesFromConfig({
      kind: "at",
      specSource: { kind: "ai" },
      describeText: "two days after approval",
    });
    expect(values.scheduleWhen).toBe("describe");
    expect(values.scheduleDescribeText).toBe("two days after approval");
  });

  it("reads a relative schedule back into the builder fields", () => {
    const values = scheduledValuesFromConfig({
      kind: "relative",
      spec: "3w",
      anchor: "flow_started",
      relativeDirection: "before",
    });
    expect(values.scheduleWhen).toBe("specific");
    expect(values.scheduleNumber).toBe("3");
    expect(values.scheduleUnit).toBe("w");
    expect(values.scheduleModifier).toBe("before");
    expect(values.scheduleAnchorChoice).toBe("flow_started");
  });

  it("reads a zero-duration relative schedule as the 'on' modifier", () => {
    const values = scheduledValuesFromConfig({ kind: "relative", spec: "0s", anchor: "node_reached" });
    expect(values.scheduleModifier).toBe("on");
  });

  it("maps a legacy recurrence row into the builder with defaults", () => {
    const values = scheduledValuesFromConfig({ kind: "recurrence", spec: "" });
    expect(values.scheduleWhen).toBe("specific");
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
    allowManualEdit: true,
    requireConfirmation: false,
    skillRefs: [],
    allowedMcpToolRefs: [],
    mcpServerId: "",
    mcpToolName: "",
    instruction: "",
    executor: "n8n",
    workflowId: null,
    webhookUrl: "",
    requestFields: [],
    requestFieldValues: {},
    responseFields: [],
    customRequestFieldKeys: [],
    scheduleWhen: "specific",
    scheduleNumber: "5",
    scheduleUnit: "d",
    scheduleModifier: "after",
    scheduleAnchorChoice: "node_reached",
    scheduleDescribeText: "",
    approverSource: "first_level_supervisor",
    roleHint: "",
    approvalInstructions: "",
    notifyOnComplete: true,
  };

  it("serialises a specific schedule into a relative config and round-trips", () => {
    const config = scheduledConfigFromValues(base);
    expect(config.kind).toBe("relative");
    expect(config.spec).toBe("5d");
    expect(config.relativeDirection).toBe("after");
    expect(config.anchor).toBe("node_reached");
    expect(scheduledValuesFromConfig(config).scheduleNumber).toBe("5");
  });

  it("serialises the 'on' modifier as a zero-duration relative schedule", () => {
    const config = scheduledConfigFromValues({ ...base, scheduleModifier: "on" });
    expect(config.kind).toBe("relative");
    expect(config.spec).toBe("0s");
  });

  it("serialises an AI schedule as an `at` node with an ai spec source", () => {
    const config = scheduledConfigFromValues({ ...base, scheduleWhen: "ai" });
    expect(config.kind).toBe("at");
    expect(config.specSource).toEqual({ kind: "ai" });
  });

  it("serialises a describe schedule with the author's text", () => {
    const config = scheduledConfigFromValues({
      ...base,
      scheduleWhen: "describe",
      scheduleDescribeText: "next Monday",
    });
    expect(config.kind).toBe("at");
    expect(config.describeText).toBe("next Monday");
  });

  it("serialises a prior-step-field anchor into anchor + anchorSource", () => {
    const config = scheduledConfigFromValues({
      ...base,
      scheduleAnchorChoice: "step:node-1:renewal_date",
    });
    expect(config.anchor).toBe("step_field");
    expect(config.anchorSource).toEqual({ kind: "step_field", nodeId: "node-1", fieldKey: "renewal_date" });
  });
});

describe("anchor choice encode / decode", () => {
  it("round-trips a prior-step-field anchor", () => {
    const encoded = encodeAnchorChoice("step_field", { kind: "step_field", nodeId: "n1", fieldKey: "f1" });
    expect(encoded).toBe("step:n1:f1");
    expect(decodeAnchorChoice(encoded)).toEqual({
      anchor: "step_field",
      anchorSource: { kind: "step_field", nodeId: "n1", fieldKey: "f1" },
    });
  });

  it("encodes the fixed anchors", () => {
    expect(encodeAnchorChoice("flow_started", undefined)).toBe("flow_started");
    expect(encodeAnchorChoice("node_reached", undefined)).toBe("node_reached");
    expect(decodeAnchorChoice("flow_started")).toEqual({ anchor: "flow_started" });
  });
});
