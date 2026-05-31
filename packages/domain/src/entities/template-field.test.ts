import { describe, it, expect } from "vitest";
import {
  buildFieldConstraintsText,
  deriveFieldKey,
  describeTemplateFieldFormat,
  parseTemplateField,
  parseTemplateFields,
} from "./template-field";

describe("deriveFieldKey", () => {
  it("converts a label to lowercase snake_case", () => {
    expect(deriveFieldKey("Employee Email")).toBe("employee_email");
  });

  it("strips punctuation and collapses separators", () => {
    expect(deriveFieldKey("Contract Value ($)")).toBe("contract_value");
  });

  it("leaves an already snake_case name unchanged", () => {
    expect(deriveFieldKey("client_name")).toBe("client_name");
  });
});

describe("parseTemplateField", () => {
  it("treats a bare name as free text", () => {
    const result = parseTemplateField("client_name");
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      key: "client_name",
      label: "client_name",
      type: "text",
      optional: false,
    });
  });

  it("derives key and label separately when annotations are present", () => {
    const result = parseTemplateField("Employee Email (email)");
    expect(result.data).toMatchObject({
      key: "employee_email",
      label: "Employee Email",
      type: "email",
    });
  });

  it("recognises each scalar type keyword", () => {
    expect(parseTemplateField("Born (date)").data?.type).toBe("date");
    expect(parseTemplateField("Fee (currency)").data?.type).toBe("currency");
    expect(parseTemplateField("Count (number)").data?.type).toBe("number");
    expect(parseTemplateField("Mail (email)").data?.type).toBe("email");
    expect(parseTemplateField("Agreed (yesno)").data?.type).toBe("yesno");
    expect(parseTemplateField("Note (text)").data?.type).toBe("text");
  });

  it("parses an options enum", () => {
    const result = parseTemplateField("Status (options: Approved, Rejected, Pending)");
    expect(result.data?.options).toEqual(["Approved", "Rejected", "Pending"]);
  });

  it("preserves option values that contain spaces", () => {
    const result = parseTemplateField("Stage (options: Not Started, In Progress, Done)");
    expect(result.data?.options).toEqual(["Not Started", "In Progress", "Done"]);
  });

  it("parses maxlen, max, min and optional constraints", () => {
    expect(parseTemplateField("Notes (maxlen: 200)").data?.maxLength).toBe(200);
    expect(parseTemplateField("Fee (currency) (max: 100)").data?.max).toBe(100);
    expect(parseTemplateField("Fee (currency) (min: 10)").data?.min).toBe(10);
    expect(parseTemplateField("Notes (optional)").data?.optional).toBe(true);
  });

  it("stacks multiple annotations", () => {
    const result = parseTemplateField("Approval Status (options: Approved, Rejected, Pending) (optional)");
    expect(result.data).toMatchObject({
      key: "approval_status",
      label: "Approval Status",
      optional: true,
    });
    expect(result.data?.options).toEqual(["Approved", "Rejected", "Pending"]);
  });

  it("combines a type with constraints", () => {
    const result = parseTemplateField("Notes (text) (maxlen: 200) (optional)");
    expect(result.data).toMatchObject({
      type: "text",
      maxLength: 200,
      optional: true,
    });
  });

  it("trims whitespace inside annotations", () => {
    expect(parseTemplateField("Mail ( email )").data?.type).toBe("email");
    expect(parseTemplateField("Mail ( email)").data?.type).toBe("email");
    expect(parseTemplateField("Fee (min:   60)").data?.min).toBe(60);
    expect(parseTemplateField("S (options:  A ,  B )").data?.options).toEqual(["A", "B"]);
  });

  it("rejects an unknown annotation", () => {
    const result = parseTemplateField("Name (frobnicate)");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("frobnicate");
  });

  it("rejects a tag with no field name", () => {
    const result = parseTemplateField("(email)");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an empty options list", () => {
    expect(parseTemplateField("Status (options:)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-numeric maxlen", () => {
    expect(parseTemplateField("Notes (maxlen: abc)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-positive-integer maxlen", () => {
    expect(parseTemplateField("Notes (maxlen: 0)").error?.code).toBe("VALIDATION_FAILED");
    expect(parseTemplateField("Notes (maxlen: 1.5)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-numeric max or min", () => {
    expect(parseTemplateField("Fee (max: lots)").error?.code).toBe("VALIDATION_FAILED");
    expect(parseTemplateField("Fee (min: none)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects two conflicting scalar types", () => {
    expect(parseTemplateField("X (date) (number)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects combining a scalar type with options", () => {
    expect(parseTemplateField("X (currency) (options: A, B)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("parses (multiple) combined with (options: …)", () => {
    const result = parseTemplateField("Skills (options: Python, Go, Rust) (multiple)");
    expect(result.error).toBeUndefined();
    expect(result.data?.options).toEqual(["Python", "Go", "Rust"]);
    expect(result.data?.multiple).toBe(true);
  });

  it("parses (multiple) before (options: …)", () => {
    const result = parseTemplateField("Skills (multiple) (options: Python, Go, Rust)");
    expect(result.error).toBeUndefined();
    expect(result.data?.multiple).toBe(true);
    expect(result.data?.options).toEqual(["Python", "Go", "Rust"]);
  });

  it("parses (multi-options: …) as shorthand for options + multiple", () => {
    const result = parseTemplateField("Skills (multi-options: Python, Go, Rust)");
    expect(result.error).toBeUndefined();
    expect(result.data?.options).toEqual(["Python", "Go", "Rust"]);
    expect(result.data?.multiple).toBe(true);
  });

  it("preserves option values with spaces in (multi-options: …)", () => {
    const result = parseTemplateField("Stage (multi-options: Not Started, In Progress, Done)");
    expect(result.data?.options).toEqual(["Not Started", "In Progress", "Done"]);
    expect(result.data?.multiple).toBe(true);
  });

  it("accepts (max: N) on a multi-options field to cap selection count", () => {
    const result = parseTemplateField("Skills (multi-options: Python, Go, Rust) (max: 2)");
    expect(result.error).toBeUndefined();
    expect(result.data?.max).toBe(2);
    expect(result.data?.multiple).toBe(true);
  });

  it("rejects (multiple) without an options list", () => {
    const result = parseTemplateField("Name (multiple)");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("multiple");
  });

  it("rejects (multi-options: …) combined with (options: …)", () => {
    const result = parseTemplateField("X (options: A, B) (multi-options: C, D)");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects (multi-options: …) combined with a scalar type", () => {
    const result = parseTemplateField("X (number) (multi-options: A, B)");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an empty (multi-options: …) list", () => {
    const result = parseTemplateField("X (multi-options:)");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("describeTemplateFieldFormat", () => {
  it("describes each scalar type", () => {
    expect(describeTemplateFieldFormat(parseTemplateField("X (date)").data!)).toContain("DD-MM-YYYY");
    expect(describeTemplateFieldFormat(parseTemplateField("X (currency)").data!)).toContain("currency");
    expect(describeTemplateFieldFormat(parseTemplateField("X (number)").data!)).toContain("plain number");
    expect(describeTemplateFieldFormat(parseTemplateField("X (email)").data!)).toContain("email");
    expect(describeTemplateFieldFormat(parseTemplateField("X (yesno)").data!)).toContain("Yes or No");
    expect(describeTemplateFieldFormat(parseTemplateField("X").data!)).toContain("free text");
  });

  it("describes a single-select options enum", () => {
    const field = parseTemplateField("X (options: A, B, C)").data!;
    expect(describeTemplateFieldFormat(field)).toContain("exactly one of: A, B, C");
  });

  it("describes a multi-select options field", () => {
    const field = parseTemplateField("X (multi-options: A, B, C)").data!;
    expect(describeTemplateFieldFormat(field)).toContain("one or more of: A, B, C");
  });

  it("describes max selections on a multi-select field", () => {
    const field = parseTemplateField("X (multi-options: A, B, C) (max: 2)").data!;
    const description = describeTemplateFieldFormat(field);
    expect(description).toContain("one or more of: A, B, C");
    expect(description).toContain("select up to 2 values");
  });

  it("appends constraints and optionality", () => {
    const field = parseTemplateField("Notes (text) (maxlen: 200) (optional)").data!;
    const description = describeTemplateFieldFormat(field);
    expect(description).toContain("max length 200");
    expect(description).toContain("optional");
  });

  it("appends min and max for numeric fields", () => {
    const field = parseTemplateField("Fee (currency) (min: 10) (max: 100)").data!;
    const description = describeTemplateFieldFormat(field);
    expect(description).toContain("minimum 10");
    expect(description).toContain("maximum 100");
  });
});

describe("buildFieldConstraintsText", () => {
  it("renders one line per field with label and key", () => {
    const fields = parseTemplateFields([
      "Employee Email (email)",
      "Notes (text) (optional)",
    ]).data!;
    const text = buildFieldConstraintsText(fields);
    expect(text).toContain('"Employee Email" (key: employee_email)');
    expect(text).toContain('"Notes" (key: notes)');
    expect(text.split("\n")).toHaveLength(2);
  });
});

describe("parseTemplateFields", () => {
  it("parses a list of raw tags", () => {
    const result = parseTemplateFields([
      "Employee Email (email)",
      "Contract Value (currency) (optional)",
    ]);
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.key).toBe("employee_email");
    expect(result.data?.[1]?.key).toBe("contract_value");
  });

  it("deduplicates by key, keeping the first occurrence", () => {
    const result = parseTemplateFields(["Total (currency)", "Total (currency)"]);
    expect(result.data).toHaveLength(1);
  });

  it("returns the first validation error encountered", () => {
    const result = parseTemplateFields(["Email (email)", "Bad (nope)"]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("nope");
  });

  it("collapses a section open and close tag into one gate field", () => {
    const result = parseTemplateFields(["#Risk Section", "Mitigation (text)", "/Risk Section"]);
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toMatchObject({
      key: "risk_section",
      label: "Risk Section",
      type: "section",
    });
    expect(result.data?.[1]?.key).toBe("mitigation");
  });
});

describe("narrative fields", () => {
  it("parses a bare (narrative) annotation", () => {
    const result = parseTemplateField("Background (narrative)");
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      key: "background",
      label: "Background",
      type: "narrative",
    });
    expect(result.data?.instruction).toBeUndefined();
  });

  it("captures the instruction text from (narrative: \"…\")", () => {
    const result = parseTemplateField('Background (narrative: "Summarise the rationale and context")');
    expect(result.error).toBeUndefined();
    expect(result.data?.type).toBe("narrative");
    expect(result.data?.label).toBe("Background");
    expect(result.data?.instruction).toBe("Summarise the rationale and context");
  });

  it("allows (narrative) combined with (optional)", () => {
    const result = parseTemplateField("Background (narrative) (optional)");
    expect(result.data?.type).toBe("narrative");
    expect(result.data?.optional).toBe(true);
  });

  it("rejects combining (narrative) with a scalar type", () => {
    expect(parseTemplateField("X (date) (narrative)").error?.code).toBe("VALIDATION_FAILED");
    expect(parseTemplateField("X (narrative) (date)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects combining (narrative) with (options: …)", () => {
    expect(parseTemplateField("X (narrative) (options: A, B)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("describes a narrative field with its instruction", () => {
    const field = parseTemplateField('Background (narrative: "Explain the funding gap")').data!;
    const description = describeTemplateFieldFormat(field);
    expect(description).toContain("narrative prose");
    expect(description).toContain("Explain the funding gap");
  });
});

describe("section gate fields", () => {
  it("parses a section open tag into a Yes/No gate", () => {
    const result = parseTemplateField("#Risk Section");
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      key: "risk_section",
      label: "Risk Section",
      type: "section",
      optional: true,
    });
  });

  it("treats an inverted-section tag the same as an open tag", () => {
    const result = parseTemplateField("^Risk Section");
    expect(result.data?.key).toBe("risk_section");
    expect(result.data?.type).toBe("section");
  });

  it("derives the same key from the matching close tag", () => {
    expect(parseTemplateField("/Risk Section").data?.key).toBe("risk_section");
  });

  it("rejects a section tag with no name", () => {
    expect(parseTemplateField("#").error?.code).toBe("VALIDATION_FAILED");
  });

  it("describes a section gate as an include/omit decision", () => {
    const field = parseTemplateField("#Risk Section").data!;
    const description = describeTemplateFieldFormat(field);
    expect(description).toContain("Risk Section");
    expect(description.toLowerCase()).toContain("include");
    expect(description).not.toContain("may be left blank");
  });
});
