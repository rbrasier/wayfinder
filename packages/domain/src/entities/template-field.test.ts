import { describe, it, expect } from "vitest";
import {
  buildFieldConstraintsText,
  DEFAULT_ITEM_CAP,
  deriveFieldKey,
  describeTemplateFieldFormat,
  parseTemplateField,
  parseTemplateFields,
  templateFieldToLine,
  type TemplateField,
} from "./template-field";
import { validateTemplateFieldValue } from "./template-field-value";

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

describe("repeating group fields", () => {
  it("parses a {{#name (repeat)}} block into a group with itemFields", () => {
    const result = parseTemplateFields([
      "#Recommendations (repeat)",
      "Number (number)",
      "Owner",
      "/Recommendations",
    ]);
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
    const group = result.data![0]!;
    expect(group).toMatchObject({ key: "recommendations", label: "Recommendations", type: "group" });
    expect(group.itemFields?.map((field) => field.key)).toEqual(["number", "owner"]);
    expect(group.itemFields?.[0]?.type).toBe("number");
  });

  it("keeps a plain {{#section}} with an inner tag as a gate plus a top-level field", () => {
    // Regression guard: v1.19.0 narrative-in-section must NOT reclassify as a group.
    const result = parseTemplateFields(["#Risk Section", "Mitigation (text)", "/Risk Section"]);
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toMatchObject({ key: "risk_section", type: "section" });
    expect(result.data?.[1]).toMatchObject({ key: "mitigation", type: "text" });
  });

  it("defaults the item cap to DEFAULT_ITEM_CAP", () => {
    const group = parseTemplateField("#Suppliers (repeat)").data!;
    expect(group.type).toBe("group");
    expect(group.itemCap).toBeUndefined();
    expect(describeTemplateFieldFormat({ ...group, itemFields: [] })).toContain(
      `up to ${DEFAULT_ITEM_CAP}`,
    );
  });

  it("reads a per-group item cap from (max: N)", () => {
    const group = parseTemplateField("#Suppliers (repeat) (max: 50)").data!;
    expect(group.type).toBe("group");
    expect(group.itemCap).toBe(50);
  });

  it("rejects a non-positive (max: N) on a group", () => {
    expect(parseTemplateField("#Suppliers (repeat) (max: 0)").error?.code).toBe("VALIDATION_FAILED");
    expect(parseTemplateField("#Suppliers (repeat) (max: two)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("describes a group as a capped list of its item fields", () => {
    const result = parseTemplateFields([
      "#Suppliers (repeat) (max: 5)",
      "Name",
      "Price (currency)",
      "/Suppliers",
    ]);
    const description = describeTemplateFieldFormat(result.data![0]!);
    expect(description).toContain("up to 5 items");
    expect(description).toContain("Name");
    expect(description).toContain("Price");
    expect(description.toLowerCase()).toContain("currency");
  });

  it("rejects an empty repeating group", () => {
    const result = parseTemplateFields(["#Empty (repeat)", "/Empty"]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message.toLowerCase()).toContain("no fields");
  });

  it("rejects a group nested inside a section", () => {
    const result = parseTemplateFields([
      "#Risk Section",
      "#Findings (repeat)",
      "Detail",
      "/Findings",
      "/Risk Section",
    ]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message.toLowerCase()).toContain("section");
  });

  it("rejects a section nested inside a group", () => {
    const result = parseTemplateFields([
      "#Findings (repeat)",
      "#Inner Section",
      "/Inner Section",
      "/Findings",
    ]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a group nested inside another group", () => {
    const result = parseTemplateFields([
      "#Outer (repeat)",
      "#Inner (repeat)",
      "Detail",
      "/Inner",
      "/Outer",
    ]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  describe("templateFieldToLine", () => {
    const semantic = (line: string) => {
      const parsed = parseTemplateField(line);
      if (parsed.error) throw new Error(`unexpected parse error for "${line}": ${parsed.error.message}`);
      const { label, type, options, multiple, optional, maxLength, max, min } = parsed.data;
      return { label, type, options, multiple, optional, maxLength, max, min };
    };

    const roundTrips = (line: string) => {
      const parsed = parseTemplateField(line);
      if (parsed.error) throw new Error(parsed.error.message);
      const reserialised = templateFieldToLine(parsed.data);
      expect(semantic(reserialised)).toEqual(semantic(line));
    };

    it("omits annotations for a plain text field", () => {
      const parsed = parseTemplateField("Preferred Vendor (text)");
      expect(parsed.error).toBeUndefined();
      expect(templateFieldToLine(parsed.data!)).toBe("Preferred Vendor");
    });

    it("round-trips scalar, options, multi-options and constraint fields", () => {
      roundTrips("Approved (yesno)");
      roundTrips("Budget (currency) (optional)");
      roundTrips("Headcount (number) (min: 1) (max: 500)");
      roundTrips("Notes (text) (maxlen: 200) (optional)");
      roundTrips("Status (options: Approved, Rejected, Pending)");
      roundTrips("Skills (multi-options: Python, Go, Rust) (max: 3)");
      roundTrips("Contact (email)");
    });

    it("returns the raw open tag for a section field untouched", () => {
      const parsed = parseTemplateField("#Risk Section");
      expect(parsed.error).toBeUndefined();
      expect(templateFieldToLine(parsed.data!)).toBe("#Risk Section");
    });
  });

  describe("signature fields", () => {
    it("parses an (approval) tag as an optional signature field", () => {
      const result = parseTemplateField("Delegate Signature (approval)");

      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({
        key: "delegate_signature",
        label: "Delegate Signature",
        type: "signature",
        optional: true,
      });
    });

    it("rejects (approval) combined with another type keyword", () => {
      expect(parseTemplateField("Signature (approval) (text)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (date) (approval)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (approval) (narrative)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("rejects (approval) combined with an options list", () => {
      expect(parseTemplateField("Signature (approval) (options: A, B)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (multi-options: A, B) (approval)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("rejects length, numeric and multiple annotations on a signature", () => {
      expect(parseTemplateField("Signature (approval) (maxlen: 200)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (approval) (min: 1)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (max: 3) (approval)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (approval) (multiple)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("rejects a signature inside a repeating group", () => {
      const result = parseTemplateFields([
        "#Findings (repeat)",
        "Detail",
        "Signature (approval)",
        "/Findings",
      ]);

      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });

    it("allows a signature beside ordinary fields at the top level", () => {
      const result = parseTemplateFields([
        "Client Name",
        "Delegate Signature (approval)",
        "Finance Signature (approval)",
      ]);

      expect(result.error).toBeUndefined();
      expect(result.data?.map((field) => [field.key, field.type])).toEqual([
        ["client_name", "text"],
        ["delegate_signature", "signature"],
        ["finance_signature", "signature"],
      ]);
    });

    it("round-trips back to the (approval) annotation, not the type name", () => {
      const parsed = parseTemplateField("Delegate Signature (approval)");
      expect(parsed.error).toBeUndefined();

      expect(templateFieldToLine(parsed.data!)).toBe("Delegate Signature (approval)");
    });

    it("describes a signature as system-filled so it is never asked for", () => {
      const parsed = parseTemplateField("Delegate Signature (approval)");

      expect(describeTemplateFieldFormat(parsed.data!)).toContain("approval");
    });

    it("accepts an empty value and refuses a typed one", () => {
      const parsed = parseTemplateField("Delegate Signature (approval)");

      expect(validateTemplateFieldValue(parsed.data!, "")).toEqual({ data: "" });
      expect(validateTemplateFieldValue(parsed.data!, "Jane Doe").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });
  });

  it("allows a top-level field, a group, and a section together", () => {
    const result = parseTemplateFields([
      "Client Name",
      "#Recommendations (repeat)",
      "Text",
      "/Recommendations",
      "#Risk Section",
      "/Risk Section",
    ]);
    expect(result.error).toBeUndefined();
    expect(result.data?.map((field) => [field.key, field.type])).toEqual([
      ["client_name", "text"],
      ["recommendations", "group"],
      ["risk_section", "section"],
    ]);
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

describe("parseTemplateFields — the Field.key accessor", () => {
  it("does not emit a field for the accessor tag", () => {
    const result = parseTemplateFields([
      "Department (options-source: departments)",
      "Department.key",
    ]);

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.key).toBe("department");
  });

  it("rejects an accessor on a field with no options source", () => {
    const result = parseTemplateFields(["Department", "Department.key"]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Department.key");
  });

  it("rejects an accessor that names no field in the template", () => {
    const result = parseTemplateFields([
      "Department (options-source: departments)",
      "Supplier.key",
    ]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Supplier.key");
  });

  it("accepts an accessor written before the field it references", () => {
    const result = parseTemplateFields([
      "Department.key",
      "Department (options-source: departments)",
    ]);

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
  });
});

describe("validateTemplateFieldValue — external fields", () => {
  it("accepts any non-empty value, leaving correctness to the step-end resolve", () => {
    const field = parseTemplateField("Department (options-source: departments)").data!;

    const result = validateTemplateFieldValue(field, "Finance");

    expect(result.error).toBeUndefined();
    expect(result.data).toBe("Finance");
  });

  it("still requires a value when the field is not optional", () => {
    const field = parseTemplateField("Department (options-source: departments)").data!;

    expect(validateTemplateFieldValue(field, "   ").error?.code).toBe("VALIDATION_FAILED");
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
