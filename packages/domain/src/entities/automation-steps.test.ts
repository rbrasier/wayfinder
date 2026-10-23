import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD,
  aiTaskConfidenceThresholdOf,
  aiTaskInputModeOf,
  isEmailAddressAllowed,
  meetsConfidenceThreshold,
  renderMessageTemplate,
  flowStepKeys,
  validateAiTaskNodeConfig,
  validateEmailNodeConfig,
} from "./automation-steps";
import type { AiTaskNodeConfig, EmailNodeConfig } from "./flow-node";

const aiTaskConfig = (overrides: Partial<AiTaskNodeConfig> = {}): AiTaskNodeConfig => ({
  instruction: "Summarise the transcript in one page.",
  outputType: "structured",
  structuredFields: [
    { key: "summary", label: "Summary", type: "narrative", optional: false, raw: "{{ summary }}" },
  ],
  confidenceThreshold: 80,
  reviewer: { mode: "run_owner" },
  ...overrides,
});

const emailConfig = (overrides: Partial<EmailNodeConfig> = {}): EmailNodeConfig => ({
  recipients: [{ kind: "address", email: "estimates@agency.gov.au" }],
  subjectTemplate: "Hearing summary",
  bodyTemplate: "{{ summarise.summary }}",
  attachStepIds: [],
  ...overrides,
});

describe("meetsConfidenceThreshold", () => {
  it("passes a result exactly at the threshold", () => {
    expect(meetsConfidenceThreshold(80, 80)).toBe(true);
  });

  it("holds a result one point below the threshold", () => {
    expect(meetsConfidenceThreshold(79, 80)).toBe(false);
  });
});

describe("aiTaskConfidenceThresholdOf", () => {
  it("falls back to the default when a stored config carries none", () => {
    const config = { ...aiTaskConfig(), confidenceThreshold: undefined } as unknown as AiTaskNodeConfig;

    expect(aiTaskConfidenceThresholdOf(config)).toBe(DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD);
  });
});

describe("aiTaskInputModeOf", () => {
  it("reads the stored mode", () => {
    expect(aiTaskInputModeOf(aiTaskConfig({ inputMode: "all" }))).toBe("all");
    expect(aiTaskInputModeOf(aiTaskConfig({ inputMode: "selected" }))).toBe("selected");
  });

  it("treats a config saved before the mode existed by whether it picked inputs", () => {
    const picked = aiTaskConfig({
      inputFields: [{ key: "transcript", label: "Transcript", type: "text", optional: false, raw: "Transcript" }],
    });

    expect(aiTaskInputModeOf(picked)).toBe("selected");
    expect(aiTaskInputModeOf(aiTaskConfig())).toBe("all");
  });
});

describe("validateAiTaskNodeConfig", () => {
  it("accepts a complete config", () => {
    expect(validateAiTaskNodeConfig(aiTaskConfig())).toEqual([]);
  });

  it("requires an instruction and at least one output field", () => {
    const problems = validateAiTaskNodeConfig(aiTaskConfig({ instruction: "  ", structuredFields: [] }));

    expect(problems).toEqual([
      { field: "instruction", message: "Add an instruction for the AI task." },
      { field: "outputs", message: "Add at least one output field." },
    ]);
  });

  it("rejects a threshold outside 0 to 100", () => {
    expect(validateAiTaskNodeConfig(aiTaskConfig({ confidenceThreshold: 101 }))).toEqual([
      { field: "threshold", message: "The confidence threshold must be between 0 and 100." },
    ]);
  });

  it("requires a named reviewer to have a user", () => {
    expect(
      validateAiTaskNodeConfig(aiTaskConfig({ reviewer: { mode: "user", userId: "" } })),
    ).toEqual([{ field: "reviewer", message: "Choose who reviews low-confidence results." }]);
  });
});

describe("isEmailAddressAllowed", () => {
  it("allows any address when no domains are configured", () => {
    expect(isEmailAddressAllowed("someone@example.com", [])).toBe(true);
  });

  it("allows an address on a listed domain, ignoring case", () => {
    expect(isEmailAddressAllowed("Team@Agency.gov.au", ["agency.gov.au"])).toBe(true);
  });

  it("rejects a lookalike domain that only ends with a listed one", () => {
    expect(isEmailAddressAllowed("x@evilagency.gov.au", ["agency.gov.au"])).toBe(false);
  });

  it("rejects a malformed address", () => {
    expect(isEmailAddressAllowed("not-an-email", [])).toBe(false);
  });
});

describe("validateEmailNodeConfig", () => {
  it("accepts a complete config", () => {
    expect(validateEmailNodeConfig(emailConfig(), [])).toEqual([]);
  });

  it("requires a recipient, a subject and a body", () => {
    const problems = validateEmailNodeConfig(
      emailConfig({ recipients: [], subjectTemplate: " ", bodyTemplate: "" }),
      [],
    );

    expect(problems).toEqual([
      { field: "recipients", message: "Add at least one recipient." },
      { field: "subject", message: "Add a subject." },
      { field: "body", message: "Add a message body." },
    ]);
  });

  it("names a fixed address outside the allowed domains", () => {
    const problems = validateEmailNodeConfig(
      emailConfig({ recipients: [{ kind: "address", email: "x@gmail.com" }] }),
      ["agency.gov.au"],
    );

    expect(problems).toEqual([
      { field: "recipients", message: "x@gmail.com is not on an allowed email domain." },
    ]);
  });
});

describe("renderMessageTemplate", () => {
  const values = {
    inputs: { hearingId: "H-123" },
    steps: { review_the_hearing: { summary: "The committee met." } },
  };

  it("fills trigger input and step field placeholders", () => {
    const rendered = renderMessageTemplate(
      "Hearing {{ input.hearingId }}: {{ review_the_hearing.summary }}",
      values,
    );

    expect(rendered).toBe("Hearing H-123: The committee met.");
  });

  it("renders an unknown placeholder as blank", () => {
    expect(renderMessageTemplate("[{{ input.missing }}]", values)).toBe("[]");
    expect(renderMessageTemplate("[{{ no_such_step.summary }}]", values)).toBe("[]");
  });

  it("leaves text that is not a step-and-field placeholder alone", () => {
    expect(renderMessageTemplate("{{ summary }} and {{ Two Words.x }}", values)).toBe(
      "{{ summary }} and {{ Two Words.x }}",
    );
  });

});

describe("flowStepKeys", () => {
  it("keys each step by its snake_cased name", () => {
    const keys = flowStepKeys([
      { id: "b", name: "Summarise" },
      { id: "a", name: "Review the hearing" },
    ]);

    expect(keys.get("a")).toBe("review_the_hearing");
    expect(keys.get("b")).toBe("summarise");
  });

  it("suffixes a repeated name by node id, whatever order the steps arrive in", () => {
    const steps = [
      { id: "b", name: "Draft" },
      { id: "a", name: "Draft" },
    ];

    expect(flowStepKeys(steps)).toEqual(flowStepKeys([...steps].reverse()));
    expect([flowStepKeys(steps).get("a"), flowStepKeys(steps).get("b")]).toEqual(["draft", "draft_2"]);
  });

  it("never gives a step the key reserved for trigger inputs", () => {
    expect(flowStepKeys([{ id: "a", name: "Input" }]).get("a")).toBe("input_2");
  });
});
