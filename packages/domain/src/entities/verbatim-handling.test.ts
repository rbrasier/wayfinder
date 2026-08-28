import { describe, expect, it } from "vitest";
import { isVerbatimIn, verbatimTransformViolations } from "./verbatim-handling";
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

describe("isVerbatimIn", () => {
  it("treats a value occurring byte-identically in a source text as verbatim", () => {
    expect(isVerbatimIn("Acme Ltd", ["Supplied by Acme Ltd of Bristol."])).toBe(true);
  });

  it("finds the value in any of the record's source texts, not only the first", () => {
    expect(isVerbatimIn("42 Mill Road", ["cover page", "Address: 42 Mill Road"])).toBe(true);
  });

  it("does not treat a reformatted value as verbatim", () => {
    // The model was asked to reformat into the field's required format, so this
    // is exactly the composing path — the characters were never in the source.
    expect(isVerbatimIn("10-08-2026", ["dated 10 August 2026"])).toBe(false);
  });

  it("does not accept a value that differs only by surrounding whitespace", () => {
    // Trimming is a transformation. Allowing it is the first "close enough"
    // tier, after which the guarantee stops being a byte comparison.
    expect(isVerbatimIn("Acme Ltd ", ["Acme Ltd"])).toBe(false);
  });

  it("does not accept a value that differs only by case", () => {
    expect(isVerbatimIn("ACME LTD", ["Acme Ltd"])).toBe(false);
  });

  it("never treats a blank value as verbatim", () => {
    // The empty string occurs in every text, so containment alone would report
    // a value that was never selected at all as copied from the document.
    expect(isVerbatimIn("", ["Acme Ltd"])).toBe(false);
  });

  it("is false when the record has no source texts", () => {
    expect(isVerbatimIn("Acme Ltd", [])).toBe(false);
  });
});
