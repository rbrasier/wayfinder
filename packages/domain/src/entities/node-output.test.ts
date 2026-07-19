import { describe, it, expect } from "vitest";
import type { ConversationalNodeConfig } from "./flow-node";
import {
  nodeFieldSet,
  normaliseOutputType,
  validateStructuredFieldSet,
} from "./node-output";
import type { TemplateField } from "./template-field";

const field = (key: string, type: TemplateField["type"] = "text"): TemplateField => ({
  key,
  label: key,
  type,
  optional: false,
  raw: key,
});

const config = (overrides: Partial<ConversationalNodeConfig>): ConversationalNodeConfig => ({
  aiInstruction: "",
  doneWhen: "",
  outputType: "unstructured",
  ...overrides,
});

describe("normaliseOutputType", () => {
  it("passes through generate_document and structured", () => {
    expect(normaliseOutputType("generate_document")).toBe("generate_document");
    expect(normaliseOutputType("structured")).toBe("structured");
    expect(normaliseOutputType("unstructured")).toBe("unstructured");
  });

  it("maps the legacy conversation_only value to unstructured", () => {
    expect(normaliseOutputType("conversation_only")).toBe("unstructured");
  });

  it("treats an unknown or missing value as unstructured", () => {
    expect(normaliseOutputType("something_else")).toBe("unstructured");
    expect(normaliseOutputType(null)).toBe("unstructured");
    expect(normaliseOutputType(undefined)).toBe("unstructured");
  });
});

describe("nodeFieldSet", () => {
  it("returns the template fields for a generate_document node", () => {
    const templateFields = [field("amount"), field("vendor")];
    const result = nodeFieldSet(
      config({ outputType: "generate_document", documentTemplateFields: templateFields }),
    );
    expect(result).toEqual(templateFields);
  });

  it("returns the structured fields for a structured node", () => {
    const structuredFields = [field("decision"), field("owner")];
    const result = nodeFieldSet(config({ outputType: "structured", structuredFields }));
    expect(result).toEqual(structuredFields);
  });

  it("never reads structuredFields for a generate_document node", () => {
    const result = nodeFieldSet(
      config({
        outputType: "generate_document",
        documentTemplateFields: [field("amount")],
        structuredFields: [field("leaked")],
      }),
    );
    expect(result).toEqual([field("amount")]);
  });

  it("returns an empty set for an unstructured node", () => {
    const result = nodeFieldSet(
      config({ outputType: "unstructured", structuredFields: [field("ignored")] }),
    );
    expect(result).toEqual([]);
  });

  it("returns an empty set for a legacy conversation_only node", () => {
    const result = nodeFieldSet(config({ outputType: "conversation_only" }));
    expect(result).toEqual([]);
  });

  it("returns an empty set when the applicable slot is absent", () => {
    expect(nodeFieldSet(config({ outputType: "structured" }))).toEqual([]);
    expect(nodeFieldSet(config({ outputType: "generate_document" }))).toEqual([]);
  });
});

describe("validateStructuredFieldSet", () => {
  it("accepts a set with no section fields", () => {
    const fields = [field("decision"), field("amount", "currency"), field("owner", "email")];
    const result = validateStructuredFieldSet(fields);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(fields);
  });

  it("rejects a set containing a section field", () => {
    const fields = [field("decision"), field("Optional Clause", "section")];
    const result = validateStructuredFieldSet(fields);
    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Optional Clause");
  });

  it("accepts an empty set", () => {
    const result = validateStructuredFieldSet([]);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([]);
  });
});
