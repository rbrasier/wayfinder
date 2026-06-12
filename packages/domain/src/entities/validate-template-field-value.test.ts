import { describe, it, expect } from "vitest";
import type { TemplateField } from "./template-field";
import { validateTemplateFieldValue } from "./template-field";

const field = (overrides: Partial<TemplateField> = {}): TemplateField => ({
  key: "supplier_name",
  label: "Supplier Name",
  type: "text",
  optional: false,
  raw: "Supplier Name",
  ...overrides,
});

describe("validateTemplateFieldValue", () => {
  it("accepts a non-empty value for a required text field", () => {
    const result = validateTemplateFieldValue(field(), "Acme Ltd");
    expect(result.error).toBeUndefined();
    expect(result.data).toBe("Acme Ltd");
  });

  it("trims surrounding whitespace from the returned value", () => {
    const result = validateTemplateFieldValue(field(), "  Acme Ltd  ");
    expect(result.data).toBe("Acme Ltd");
  });

  it("rejects a blank value for a required field", () => {
    const result = validateTemplateFieldValue(field(), "   ");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("accepts a blank value for an optional field", () => {
    const result = validateTemplateFieldValue(field({ optional: true }), "");
    expect(result.error).toBeUndefined();
    expect(result.data).toBe("");
  });

  it("enforces maxLength on text", () => {
    const result = validateTemplateFieldValue(field({ maxLength: 3 }), "abcd");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("accepts text exactly at maxLength", () => {
    const result = validateTemplateFieldValue(field({ maxLength: 4 }), "abcd");
    expect(result.error).toBeUndefined();
  });

  it("accepts a valid email", () => {
    const result = validateTemplateFieldValue(
      field({ key: "email", type: "email" }),
      "ops@acme.test",
    );
    expect(result.data).toBe("ops@acme.test");
  });

  it("rejects an invalid email", () => {
    const result = validateTemplateFieldValue(field({ type: "email" }), "not-an-email");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("accepts a plain number and enforces min/max bounds", () => {
    const numberField = field({ type: "number", min: 1, max: 10 });
    expect(validateTemplateFieldValue(numberField, "5").data).toBe("5");
    expect(validateTemplateFieldValue(numberField, "0").error?.code).toBe("VALIDATION_FAILED");
    expect(validateTemplateFieldValue(numberField, "11").error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-numeric value for a number field", () => {
    const result = validateTemplateFieldValue(field({ type: "number" }), "abc");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("accepts a currency value with symbols and separators", () => {
    const result = validateTemplateFieldValue(field({ type: "currency" }), "$1,200.00");
    expect(result.data).toBe("$1,200.00");
  });

  it("accepts Yes or No for a yesno field and rejects anything else", () => {
    const yesno = field({ type: "yesno" });
    expect(validateTemplateFieldValue(yesno, "Yes").data).toBe("Yes");
    expect(validateTemplateFieldValue(yesno, "No").data).toBe("No");
    expect(validateTemplateFieldValue(yesno, "Maybe").error?.code).toBe("VALIDATION_FAILED");
  });

  it("normalises yesno casing to Yes/No", () => {
    expect(validateTemplateFieldValue(field({ type: "yesno" }), "yes").data).toBe("Yes");
    expect(validateTemplateFieldValue(field({ type: "yesno" }), "no").data).toBe("No");
  });

  it("treats a section gate like yesno", () => {
    const section = field({ type: "section", optional: true });
    expect(validateTemplateFieldValue(section, "Yes").data).toBe("Yes");
    expect(validateTemplateFieldValue(section, "No").data).toBe("No");
    expect(validateTemplateFieldValue(section, "include").error?.code).toBe("VALIDATION_FAILED");
  });

  it("accepts a value that is a member of a single-select options list", () => {
    const options = field({ options: ["Low", "Medium", "High"] });
    expect(validateTemplateFieldValue(options, "Medium").data).toBe("Medium");
  });

  it("rejects a value outside the options list", () => {
    const options = field({ options: ["Low", "High"] });
    expect(validateTemplateFieldValue(options, "Critical").error?.code).toBe("VALIDATION_FAILED");
  });

  it("accepts a comma-separated subset for a multi-select field", () => {
    const multi = field({ options: ["A", "B", "C"], multiple: true });
    expect(validateTemplateFieldValue(multi, "A, C").data).toBe("A, C");
  });

  it("rejects a multi-select value containing an unknown option", () => {
    const multi = field({ options: ["A", "B"], multiple: true });
    expect(validateTemplateFieldValue(multi, "A, Z").error?.code).toBe("VALIDATION_FAILED");
  });

  it("enforces max as a count of selected values for multi-select", () => {
    const multi = field({ options: ["A", "B", "C"], multiple: true, max: 2 });
    expect(validateTemplateFieldValue(multi, "A, B").data).toBe("A, B");
    expect(validateTemplateFieldValue(multi, "A, B, C").error?.code).toBe("VALIDATION_FAILED");
  });

  it("accepts narrative prose and enforces maxLength when present", () => {
    const narrative = field({ type: "narrative", maxLength: 5 });
    expect(validateTemplateFieldValue(narrative, "Hi").data).toBe("Hi");
    expect(validateTemplateFieldValue(narrative, "Too long").error?.code).toBe("VALIDATION_FAILED");
  });
});
