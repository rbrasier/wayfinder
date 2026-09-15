import { describe, it, expect } from "vitest";
import { parseTemplateFields } from "./template-field-set";
import {
  buildFieldConstraintsText,
  deriveFieldKey,
  describeTemplateFieldFormat,
  parseTemplateField,
  templateFieldToLine,
  type TemplateField,
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

describe("parseTemplateField — (options-source: …)", () => {
  it("binds the field to a registered source", () => {
    const result = parseTemplateField("Department (options-source: departments)");

    expect(result.error).toBeUndefined();
    expect(result.data?.optionsSource).toBe("departments");
    expect(result.data?.options).toBeUndefined();
    expect(result.data?.type).toBe("text");
  });

  it("rejects an options source combined with an inline options list", () => {
    const result = parseTemplateField("Department (options-source: departments) (options: A, B)");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("options-source");
  });

  it("rejects the same combination written in the other order", () => {
    const result = parseTemplateField("Department (options: A, B) (options-source: departments)");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an options source combined with multi-options", () => {
    const result = parseTemplateField(
      "Department (options-source: departments) (multi-options: A, B)",
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an options source combined with a scalar type", () => {
    const result = parseTemplateField("Department (date) (options-source: departments)");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a source name that is not a slug", () => {
    const result = parseTemplateField("Department (options-source: My Departments)");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("lowercase");
  });

  it("rejects two options sources on one tag", () => {
    const result = parseTemplateField("Department (options-source: a) (options-source: b)");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("accepts (multiple) alongside an options source", () => {
    const result = parseTemplateField("Departments (options-source: departments) (multiple)");

    expect(result.error).toBeUndefined();
    expect(result.data?.multiple).toBe(true);
    expect(result.data?.optionsSource).toBe("departments");
  });

  it("still rejects (multiple) with no options list of any kind", () => {
    const result = parseTemplateField("Departments (multiple)");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("describeTemplateFieldFormat — external fields", () => {
  it("names the source and defers correctness to the step-end check when nothing is inlined", () => {
    const field = parseTemplateField("Department (options-source: departments)").data!;

    const description = describeTemplateFieldFormat(field);

    expect(description).toContain("departments");
    expect(description).toContain("step completes");
  });

  it("describes a multi-select external field as accepting more than one value", () => {
    const field = parseTemplateField("Departments (options-source: departments) (multiple)").data!;

    expect(describeTemplateFieldFormat(field)).toContain("one or more");
  });

  it("uses the inlined entries when the application has supplied a small set", () => {
    const field = parseTemplateField("Department (options-source: departments)").data!;
    const inlined = { ...field, options: ["Finance (FIN-001)", "HR (HR-002)"] };

    expect(describeTemplateFieldFormat(inlined)).toContain("exactly one of: Finance (FIN-001)");
  });
});

describe("templateFieldToLine — external fields", () => {
  it("round-trips an options source through the parser", () => {
    const field = parseTemplateField("Department (options-source: departments)").data!;

    const line = templateFieldToLine(field);

    expect(line).toBe("Department (options-source: departments)");
    expect(parseTemplateField(line).data?.optionsSource).toBe("departments");
  });

  it("round-trips a multi-select external field", () => {
    const field = parseTemplateField("Departments (options-source: departments) (multiple)").data!;

    const line = templateFieldToLine(field);

    expect(parseTemplateField(line).data?.multiple).toBe(true);
    expect(parseTemplateField(line).data?.optionsSource).toBe("departments");
  });
});

describe("describeTemplateFieldFormat — conversation preview cap", () => {
  const external = (count: number, multiple = false): TemplateField => {
    const parsed = parseTemplateField(
      `Department (options-source: departments)${multiple ? " (multiple)" : ""}`,
    );
    return {
      ...parsed.data!,
      options: Array.from({ length: count }, (_, index) => `Dept ${index + 1} (D-${index + 1})`),
    };
  };

  it("tells the assistant to name at most three of a large inlined set", () => {
    const description = describeTemplateFieldFormat(external(12));

    expect(description).toContain("name at most 3 of these options");
    expect(description).toContain("list all 12 if they ask");
  });

  it("still caps a small set that fits entirely in the prompt", () => {
    const description = describeTemplateFieldFormat(external(8));

    expect(description).toContain("name at most 3");
    expect(description).toContain("Dept 8");
  });

  it("adds no cap when the whole set is three or fewer", () => {
    const description = describeTemplateFieldFormat(external(3));

    expect(description).not.toContain("name at most");
  });

  it("leaves an inline (options: …) field's description untouched", () => {
    const inline = parseTemplateField("Status (options: Open, Closed, Pending, Void)").data!;

    expect(describeTemplateFieldFormat(inline)).toBe(
      "exactly one of: Open, Closed, Pending, Void",
    );
  });

  it("tells the assistant to offer a lookup rather than invent values when nothing is inlined", () => {
    const description = describeTemplateFieldFormat(
      parseTemplateField("Department (options-source: departments)").data!,
    );

    expect(description).toContain("do not invent example values");
    expect(description).toContain("offer to search it");
  });

  it("keeps the cap on a multi-select external field", () => {
    expect(describeTemplateFieldFormat(external(12, true))).toContain("name at most 3");
  });
});

describe("describeTemplateFieldFormat — examples for a large external set", () => {
  const large = (sample?: string[]): TemplateField => ({
    ...parseTemplateField("Department (options-source: departments)").data!,
    ...(sample ? { optionsSample: sample } : {}),
  });

  it("shows real values from the list rather than describing it abstractly", () => {
    const description = describeTemplateFieldFormat(
      large(["Finance (FIN-001)", "Human Resources (HR-002)", "Legal Services (LEG-003)"]),
    );

    expect(description).toContain("Finance (FIN-001)");
    expect(description).toContain("Legal Services (LEG-003)");
    expect(description).toContain("examples from a longer list");
  });

  it("makes clear the examples are not the whole set", () => {
    const description = describeTemplateFieldFormat(large(["Finance (FIN-001)"]));

    expect(description).toContain("never that they are the only choices");
  });

  it("falls back to offering a lookup when no sample could be fetched", () => {
    const description = describeTemplateFieldFormat(large());

    expect(description).toContain("do not invent example values");
  });

  it("still defers correctness to the step-end check", () => {
    expect(describeTemplateFieldFormat(large(["Finance (FIN-001)"]))).toContain("step completes");
  });
});
