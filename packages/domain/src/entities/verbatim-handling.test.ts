import { describe, expect, it } from "vitest";
import { verbatimTransformViolations, verifyVerbatim } from "./verbatim-handling";
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

describe("verifyVerbatim", () => {
  const quotedFrom = (documentText: string, quote: string, value: string) =>
    verifyVerbatim({ value, quote, documentText, field: field() });

  it("verifies a value the model quoted from the named document", () => {
    expect(quotedFrom("Supplied by Acme Ltd of Bristol.", "by Acme Ltd of", "Acme Ltd")).toBe(true);
  });

  it("verifies a quote that is exactly the value", () => {
    expect(quotedFrom("Address: 42 Mill Road", "42 Mill Road", "42 Mill Road")).toBe(true);
  });

  it("refuses a value the model composed but which occurs incidentally in the document", () => {
    // The defect this function exists to close: "N/A" turns up inside any long
    // document, and containment alone stamped it Copied — which then won merge
    // arbitration outright against a better-supported composed answer.
    const documentText = "The N/A designation applies to sections 4 and 9.";
    expect(verifyVerbatim({ value: "N/A", quote: "", documentText, field: field() })).toBe(false);
  });

  it("refuses a quote that does not occur in the named document", () => {
    // The model pointed at a document it did not read the value from. The value
    // may still be right, but nothing here verifies that, so it is composed.
    expect(quotedFrom("Supplied by Acme Ltd.", "Supplied by Beta Ltd", "Beta Ltd")).toBe(false);
  });

  it("refuses a value that does not occur inside its own quote", () => {
    expect(quotedFrom("Invoice total 4,820.00 GBP", "Invoice total 4,820.00 GBP", "4820")).toBe(
      false,
    );
  });

  it("refuses a value that occurs in the quote only inside a longer word", () => {
    // Word-bounded containment: "No" inside "Notice" is not a selection.
    expect(quotedFrom("Notice of termination", "Notice of termination", "No")).toBe(false);
  });

  it("accepts a value bounded by punctuation rather than whitespace", () => {
    expect(quotedFrom("Ref: (A7) applies", "Ref: (A7) applies", "A7")).toBe(true);
  });

  it("does not accept a value that differs only by case", () => {
    expect(quotedFrom("Supplied by Acme Ltd.", "Supplied by Acme Ltd.", "ACME LTD")).toBe(false);
  });

  it("does not accept a quote that differs from the document only by whitespace", () => {
    // Trimming is a transformation. Allowing it is the first "close enough"
    // tier, after which the guarantee stops being a byte comparison.
    expect(quotedFrom("Supplied by  Acme Ltd.", "Supplied by Acme Ltd.", "Acme Ltd")).toBe(false);
  });

  it("never verifies a blank value", () => {
    expect(quotedFrom("Acme Ltd", "Acme Ltd", "")).toBe(false);
  });

  it("never verifies a blank quote", () => {
    // The empty string occurs in every document, so a blank quote would verify
    // against anything.
    expect(quotedFrom("Acme Ltd", "", "Acme Ltd")).toBe(false);
  });

  it("refuses a field that cannot return source bytes even when the quote verifies", () => {
    // A date, a number or an options value is reshaped by definition, so its
    // characters appearing in the quote is coincidence, not selection.
    expect(
      verifyVerbatim({
        value: "10-08-2026",
        quote: "dated 10-08-2026",
        documentText: "Signed, dated 10-08-2026.",
        field: field({ type: "date" }),
      }),
    ).toBe(false);
    expect(
      verifyVerbatim({
        value: "Open",
        quote: "status Open",
        documentText: "Current status Open at review.",
        field: field({ options: ["Open", "Closed"] }),
      }),
    ).toBe(false);
  });
});
