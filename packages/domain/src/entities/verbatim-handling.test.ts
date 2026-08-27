import { describe, expect, it } from "vitest";
import { verbatimTransformViolations } from "./verbatim-handling";
import type { TemplateField } from "./template-field";

const field = (overrides: Partial<TemplateField> = {}): TemplateField => ({
  key: "output",
  label: "Output",
  type: "text",
  optional: false,
  raw: "{{output}}",
  ...overrides,
});

describe("verbatimTransformViolations", () => {
  it("permits a plain text pass-through of the tool result", () => {
    expect(verbatimTransformViolations([field()])).toEqual([]);
  });

  it("permits a narrative pass-through", () => {
    expect(verbatimTransformViolations([field({ type: "narrative" })])).toEqual([]);
  });

  it("refuses a typed field, which reshapes the received bytes", () => {
    const violations = verbatimTransformViolations([field({ key: "rate", type: "currency" })]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("rate");
    expect(violations[0]).toContain("currency");
  });

  it("refuses a field constrained to options, which substitutes a permitted value", () => {
    const violations = verbatimTransformViolations([
      field({ key: "status", options: ["Open", "Closed"] }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("status");
  });

  it("names every offending field rather than stopping at the first", () => {
    const violations = verbatimTransformViolations([
      field({ key: "rate", type: "number" }),
      field({ key: "due", type: "date" }),
      field(),
    ]);
    expect(violations).toHaveLength(2);
  });

  it("permits a step that declares no response fields at all", () => {
    expect(verbatimTransformViolations([])).toEqual([]);
  });
});
