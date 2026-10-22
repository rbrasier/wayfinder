import { describe, expect, it } from "vitest";
import type { PriorStepField } from "@rbrasier/domain";
import {
  aiTaskConfigFromForm,
  aiTaskFormFromConfig,
  emailConfigFromForm,
  emailFormFromConfig,
  inputLabelFor,
  placeholderOptions,
} from "./automation-step-model";

const priorFields: PriorStepField[] = [
  {
    nodeId: "node-1",
    stepLabel: "1. Intake",
    stepNumber: 1,
    stepName: "Intake",
    field: { key: "transcript", label: "Transcript", type: "narrative" },
  },
];

describe("aiTaskFormFromConfig", () => {
  it("opens a new step with sensible defaults", () => {
    const form = aiTaskFormFromConfig({});

    expect(form).toEqual({
      instruction: "",
      inputs: [],
      outputLines: [],
      confidenceThreshold: 80,
      reviewer: { mode: "run_owner" },
      skillRefs: [],
      allowedMcpToolRefs: [],
    });
  });

  it("reads saved inputs back as label-and-source rows, with skills and tools", () => {
    const form = aiTaskFormFromConfig({
      instruction: "Summarise.",
      inputFields: [{ key: "transcript", label: "Transcript", type: "text", optional: false, raw: "Transcript" }],
      inputFieldValues: { transcript: { kind: "step_field", nodeId: "node-1", fieldKey: "transcript" } },
      structuredFields: [{ key: "summary", label: "Summary", type: "narrative", optional: false, raw: "Summary (narrative)" }],
      confidenceThreshold: 70,
      reviewer: { mode: "user", userId: "user-1" },
      skillRefs: ["skill-1"],
      allowedMcpToolRefs: [{ serverId: "server-1", toolName: "search" }],
    });

    expect(form.inputs).toEqual([
      { label: "Transcript", source: { kind: "step_field", nodeId: "node-1", fieldKey: "transcript" } },
    ]);
    expect(form.outputLines).toEqual(["Summary (narrative)"]);
    expect(form.skillRefs).toEqual(["skill-1"]);
    expect(form.allowedMcpToolRefs).toEqual([{ serverId: "server-1", toolName: "search" }]);
  });
});

describe("aiTaskConfigFromForm", () => {
  const form = {
    instruction: "Summarise.",
    inputs: [
      { label: "Transcript", source: { kind: "step_field" as const, nodeId: "node-1", fieldKey: "transcript" } },
      { label: "Transcript", source: { kind: "trigger_input" as const, inputKey: "hearing_id" } },
    ],
    outputLines: ["Summary (narrative)"],
    confidenceThreshold: 80,
    reviewer: { mode: "run_owner" as const },
    skillRefs: ["skill-1"],
    allowedMcpToolRefs: [],
  };

  it("derives an input field per row, with a unique key, and keeps each row's source", () => {
    const { config, problems } = aiTaskConfigFromForm(form);

    expect(problems).toEqual([]);
    expect(config.inputFields?.map((field) => [field.key, field.label])).toEqual([
      ["transcript", "Transcript"],
      ["transcript_2", "Transcript"],
    ]);
    expect(config.inputFieldValues).toEqual({
      transcript: { kind: "step_field", nodeId: "node-1", fieldKey: "transcript" },
      transcript_2: { kind: "trigger_input", inputKey: "hearing_id" },
    });
    expect(config.skillRefs).toEqual(["skill-1"]);
  });

  it("requires a label on every input and at least one output field", () => {
    const { problems } = aiTaskConfigFromForm({
      ...form,
      inputs: [{ label: " ", source: { kind: "ai" } }],
      outputLines: [],
    });

    expect(problems).toContain("Name every input.");
    expect(problems).toContain("Add at least one output field.");
  });
});

describe("inputLabelFor", () => {
  it("names an input after the field or trigger input it reads", () => {
    expect(inputLabelFor({ kind: "step_field", nodeId: "node-1", fieldKey: "transcript" }, priorFields, [])).toBe(
      "Transcript",
    );
    expect(
      inputLabelFor({ kind: "trigger_input", inputKey: "hearing_id" }, [], [
        { key: "hearing_id", label: "Hearing", type: "text", required: true },
      ]),
    ).toBe("Hearing");
    expect(inputLabelFor({ kind: "literal", value: "x" }, priorFields, [])).toBe("");
  });
});

describe("email form", () => {
  it("round-trips a config", () => {
    const config = {
      recipients: [{ kind: "address" as const, email: "team@agency.gov.au" }],
      subjectTemplate: "Summary",
      bodyTemplate: "Body",
      attachStepIds: ["node-1"],
    };

    const { config: rebuilt, problems } = emailConfigFromForm(emailFormFromConfig(config), []);

    expect(problems).toEqual([]);
    expect(rebuilt).toEqual(config);
  });

  it("flags a fixed address outside the allowed domains", () => {
    const form = emailFormFromConfig({
      recipients: [{ kind: "address", email: "x@gmail.com" }],
      subjectTemplate: "S",
      bodyTemplate: "B",
      attachStepIds: [],
    });

    expect(emailConfigFromForm(form, ["agency.gov.au"]).problems).toEqual([
      "x@gmail.com is not on an allowed email domain.",
    ]);
  });
});

describe("placeholderOptions", () => {
  it("offers a token for every earlier step field, labelled by step", () => {
    const prior: PriorStepField[] = [
      {
        nodeId: "node-1",
        stepLabel: "1. Summarise",
        stepNumber: 1,
        stepName: "Summarise",
        field: { key: "summary", label: "Summary", type: "narrative" },
      },
    ];

    expect(placeholderOptions(prior)).toEqual([
      { label: "1. Summarise → Summary", token: "{{ step.node-1.summary }}" },
    ]);
  });

  it("offers the flow's trigger inputs first", () => {
    expect(
      placeholderOptions([], [{ key: "hearing_id", label: "Hearing", type: "text", required: true }]),
    ).toEqual([{ label: "Trigger input → Hearing", token: "{{ input.hearing_id }}" }]);
  });
});
