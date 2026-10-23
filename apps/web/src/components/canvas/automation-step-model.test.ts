import { describe, expect, it } from "vitest";
import type { PriorStepField } from "@rbrasier/domain";
import {
  aiTaskConfigFromForm,
  aiTaskFormFromConfig,
  emailConfigFromForm,
  emailFormFromConfig,
  aiTaskInputOptions,
  inputSourceFrom,
  inputSourceValue,
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

const hearing = { key: "hearing_id", label: "Hearing", type: "text" as const, required: true };
const context = { priorStepFields: priorFields, triggerInputs: [hearing] };

describe("aiTaskFormFromConfig", () => {
  it("opens a new step accepting all inputs, with sensible defaults", () => {
    const form = aiTaskFormFromConfig({});

    expect(form).toEqual({
      instruction: "",
      acceptAllInputs: true,
      inputs: [],
      outputLines: [],
      confidenceThreshold: 80,
      reviewer: { mode: "run_owner" },
      skillRefs: [],
      allowedMcpToolRefs: [],
    });
  });

  it("reads a step that picked its inputs back as those picks, with skills and tools", () => {
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

    expect(form.acceptAllInputs).toBe(false);
    expect(form.inputs).toEqual([{ kind: "step_field", nodeId: "node-1", fieldKey: "transcript" }]);
    expect(form.outputLines).toEqual(["Summary (narrative)"]);
    expect(form.skillRefs).toEqual(["skill-1"]);
    expect(form.allowedMcpToolRefs).toEqual([{ serverId: "server-1", toolName: "search" }]);
  });
});

describe("aiTaskFormFromConfig with a field saved without its raw line", () => {
  it("reads the field by its label rather than failing", () => {
    const form = aiTaskFormFromConfig({
      structuredFields: [{ key: "summary", label: "Summary", type: "narrative" }],
    });

    expect(form.outputLines).toEqual(["Summary"]);
  });
});

describe("aiTaskConfigFromForm", () => {
  const form = {
    instruction: "Summarise.",
    acceptAllInputs: false,
    inputs: [
      { kind: "step_field" as const, nodeId: "node-1", fieldKey: "transcript" },
      { kind: "trigger_input" as const, inputKey: "hearing_id" },
    ],
    outputLines: ["Summary (narrative)"],
    confidenceThreshold: 80,
    reviewer: { mode: "run_owner" as const },
    skillRefs: ["skill-1"],
    allowedMcpToolRefs: [],
  };

  it("names each picked input after its field and keeps where it comes from", () => {
    const { config, problems } = aiTaskConfigFromForm(form, context);

    expect(problems).toEqual([]);
    expect(config.inputMode).toBe("selected");
    expect(config.inputFields?.map((field) => [field.key, field.label])).toEqual([
      ["transcript", "Transcript"],
      ["hearing", "Hearing"],
    ]);
    expect(config.inputFieldValues).toEqual({
      transcript: { kind: "step_field", nodeId: "node-1", fieldKey: "transcript" },
      hearing: { kind: "trigger_input", inputKey: "hearing_id" },
    });
    expect(config.skillRefs).toEqual(["skill-1"]);
  });

  it("stores no picked inputs while it accepts all", () => {
    const { config } = aiTaskConfigFromForm({ ...form, acceptAllInputs: true }, context);

    expect(config.inputMode).toBe("all");
    expect(config.inputFields).toEqual([]);
    expect(config.inputFieldValues).toEqual({});
  });

  it("files each problem under its field, in the order the editor shows them", () => {
    const { problems } = aiTaskConfigFromForm(
      { ...form, instruction: "", inputs: [], outputLines: [], confidenceThreshold: 120 },
      context,
    );

    expect(problems).toEqual([
      { field: "instruction", message: "Add an instruction for the AI task." },
      { field: "inputs", message: "Pick at least one input, or accept all inputs." },
      { field: "outputs", message: "Add at least one output field." },
      { field: "threshold", message: "The confidence threshold must be between 0 and 100." },
    ]);
  });

  it("names the output row that is wrong and why", () => {
    const { problems } = aiTaskConfigFromForm({ ...form, outputLines: ["Summary (narrative)", " (number)"] }, context);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ field: "outputs", outputRow: 1 });
    expect(problems[0]!.message).not.toBe("");
  });
});

describe("aiTaskInputOptions", () => {
  it("offers trigger inputs, then each earlier step's fields grouped under the step", () => {
    expect(aiTaskInputOptions(priorFields, [hearing])).toEqual([
      { label: "Trigger inputs", options: [{ value: "input:hearing_id", label: "Hearing (text)" }] },
      {
        label: "1. Intake",
        options: [{ value: "step:node-1:transcript", label: "1. Intake — Transcript (narrative)" }],
      },
    ]);
  });

  it("round-trips a choice through its option value", () => {
    const source = { kind: "step_field" as const, nodeId: "node-1", fieldKey: "transcript" };

    expect(inputSourceFrom(inputSourceValue(source))).toEqual(source);
    expect(inputSourceFrom(inputSourceValue({ kind: "trigger_input", inputKey: "hearing_id" }))).toEqual({
      kind: "trigger_input",
      inputKey: "hearing_id",
    });
    expect(inputSourceFrom("nonsense")).toBeNull();
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
      { field: "recipients", message: "x@gmail.com is not on an allowed email domain." },
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

    expect(placeholderOptions(prior, [], new Map([["node-1", "summarise"]]))).toEqual([
      { label: "1. Summarise → Summary", token: "{{ summarise.summary }}" },
    ]);
  });

  it("skips a field whose step has no key yet", () => {
    expect(placeholderOptions(priorFields, [], new Map())).toEqual([]);
  });

  it("offers the flow's trigger inputs first", () => {
    expect(
      placeholderOptions([], [{ key: "hearing_id", label: "Hearing", type: "text", required: true }], new Map()),
    ).toEqual([{ label: "Trigger input → Hearing", token: "{{ input.hearing_id }}" }]);
  });
});
