import { describe, it, expect } from "vitest";
import type { ConversationalNodeConfig } from "./flow-node";
import {
  SIGNATURE_SLOT_MARKER,
  gatherableTemplateContent,
  nodeFieldSet,
  normaliseOutputType,
  validateStructuredFieldSet,
} from "./node-output";
import { buildFieldConstraintsText, type TemplateField } from "./template-field";

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

  it("filters a signature field out of a document step's set", () => {
    const result = nodeFieldSet(
      config({
        outputType: "generate_document",
        documentTemplateFields: [
          field("amount"),
          field("delegate_signature", "signature"),
          field("vendor"),
        ],
      }),
    );

    expect(result).toEqual([field("amount"), field("vendor")]);
  });

  it("keeps a signature out of the AI's field constraints entirely", () => {
    const fields = nodeFieldSet(
      config({
        outputType: "generate_document",
        documentTemplateFields: [field("amount"), field("delegate_signature", "signature")],
      }),
    );

    expect(buildFieldConstraintsText(fields)).not.toContain("delegate_signature");
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

  it("rejects a set containing a signature field", () => {
    const fields = [field("decision"), field("Delegate Signature", "signature")];
    const result = validateStructuredFieldSet(fields);
    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Delegate Signature");
  });

  it("accepts an empty set", () => {
    const result = validateStructuredFieldSet([]);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([]);
  });
});

describe("gatherableTemplateContent", () => {
  it("drops a signature line whole, so its label cannot be asked about either", () => {
    // The reported transcript asked for "First Level Supervisor Approval" — the
    // label, not the tag. Removing only the tag leaves that label over a blank.
    const gatherable = gatherableTemplateContent(
      "Full Name: {{Full Name}}\nFirst Level Supervisor Approval: {{ First Level Supervisor Approval (approval) }}",
    );

    expect(gatherable).toBe("Full Name: {{Full Name}}");
  });

  it("drops every signature line in a template that declares more than one", () => {
    const gatherable = gatherableTemplateContent(
      "Name: {{Full Name}}\n{{ First Level Supervisor Approval (approval) }}\n{{ Second Level Supervisor Approval (approval) }}",
    );

    expect(gatherable).toBe("Name: {{Full Name}}");
  });

  it("keeps a line that mixes a signature with a gatherable tag, masking only the signature", () => {
    // The gatherable tag has to survive, so the line cannot be dropped; the
    // marker stands in for the signature and the prompt's constraint explains it.
    const gatherable = gatherableTemplateContent(
      "Executed on {{ Start Date (date) }} by {{ Delegate Signature (approval) }}",
    );

    expect(gatherable).toBe(
      `Executed on {{ Start Date (date) }} by ${SIGNATURE_SLOT_MARKER}`,
    );
    expect(gatherable).not.toContain("Delegate Signature");
  });

  it("leaves a template with no signatures byte-identical", () => {
    const content =
      "Name: {{Full Name}}\nStart: {{ Start Date (date) }}\nDept: {{ Department (options: Legal, Sales) }}";

    expect(gatherableTemplateContent(content)).toBe(content);
  });

  it("recognises the annotation regardless of case or surrounding whitespace", () => {
    expect(gatherableTemplateContent("Name: {{Name}}\nSig: {{Sig (APPROVAL)}}")).toBe(
      "Name: {{Name}}",
    );
    expect(gatherableTemplateContent("Name: {{Name}}\nSig: {{   Sig   (Approval)   }}")).toBe(
      "Name: {{Name}}",
    );
  });

  it("recognises a signature tag carrying other annotations alongside (approval)", () => {
    // Validation rejects this combination at upload, but this is a safety
    // filter — it must not depend on the tag being well-formed.
    expect(gatherableTemplateContent("Name: {{Name}}\n{{ Sig (approval) (optional) }}")).toBe(
      "Name: {{Name}}",
    );
  });

  it("does not touch a tag whose name merely mentions approval", () => {
    const content = "{{ Approval Notes }}";

    expect(gatherableTemplateContent(content)).toBe(content);
  });

  it("returns null when a template declares nothing but signatures", () => {
    // No gatherable body left, so the caller emits no template block and indexes
    // no chunk — better than a body of markers.
    expect(gatherableTemplateContent("{{ Annexe Signature (approval) }}")).toBeNull();
  });

  it("returns null for absent content", () => {
    expect(gatherableTemplateContent(null)).toBeNull();
    expect(gatherableTemplateContent(undefined)).toBeNull();
  });
});
