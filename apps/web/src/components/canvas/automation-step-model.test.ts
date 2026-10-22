import { describe, expect, it } from "vitest";
import type { PriorStepField } from "@rbrasier/domain";
import {
  aiTaskConfigFromForm,
  aiTaskFormFromConfig,
  emailConfigFromForm,
  emailFormFromConfig,
  placeholderOptions,
} from "./automation-step-model";

describe("aiTaskFormFromConfig", () => {
  it("opens a new step with sensible defaults", () => {
    const form = aiTaskFormFromConfig({});

    expect(form).toEqual({
      instruction: "",
      inputLines: [],
      inputFieldValues: {},
      outputLines: [],
      confidenceThreshold: 80,
      reviewer: { mode: "run_owner" },
    });
  });

  it("reads a saved config back into editable lines", () => {
    const form = aiTaskFormFromConfig({
      instruction: "Summarise.",
      inputFields: [{ key: "transcript", label: "Transcript", type: "text", optional: false, raw: "Transcript" }],
      inputFieldValues: { transcript: { kind: "ai" } },
      structuredFields: [{ key: "summary", label: "Summary", type: "narrative", optional: false, raw: "Summary (narrative)" }],
      confidenceThreshold: 70,
      reviewer: { mode: "user", userId: "user-1" },
    });

    expect(form.inputLines).toEqual(["Transcript"]);
    expect(form.outputLines).toEqual(["Summary (narrative)"]);
    expect(form.confidenceThreshold).toBe(70);
    expect(form.reviewer).toEqual({ mode: "user", userId: "user-1" });
  });
});

describe("aiTaskConfigFromForm", () => {
  it("builds a structured-output config from the form", () => {
    const { config, problems } = aiTaskConfigFromForm({
      instruction: "Summarise.",
      inputLines: ["Transcript"],
      inputFieldValues: { transcript: { kind: "literal", value: "x" }, removed: { kind: "ai" } },
      outputLines: ["Summary (narrative)"],
      confidenceThreshold: 80,
      reviewer: { mode: "run_owner" },
    });

    expect(problems).toEqual([]);
    expect(config.outputType).toBe("structured");
    expect(config.structuredFields.map((field) => field.key)).toEqual(["summary"]);
    expect(config.inputFields?.map((field) => field.key)).toEqual(["transcript"]);
    // A value source for a field that no longer exists is dropped, not kept.
    expect(Object.keys(config.inputFieldValues ?? {})).toEqual(["transcript"]);
  });

  it("reports an unparseable field line and the domain's own problems", () => {
    const { problems } = aiTaskConfigFromForm({
      instruction: "",
      inputLines: [],
      inputFieldValues: {},
      outputLines: ["Summary (not-a-type)"],
      confidenceThreshold: 80,
      reviewer: { mode: "run_owner" },
    });

    expect(problems).toContain("Fix the highlighted output fields.");
    expect(problems).toContain("Add an instruction for the AI task.");
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
});
