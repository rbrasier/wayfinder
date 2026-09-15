import { describe, expect, it } from "vitest";
import type { ExtractionField, FlowContextDoc } from "@wayfinder/domain";
import { buildExtractionSystemPrompt } from "./build-extraction-prompt";

const supplierName: ExtractionField = {
  field: { key: "supplier_name", label: "Supplier Name", type: "text", optional: false, raw: "Supplier Name" },
  instruction: "The supplier's legal name.",
  doneWhen: null,
};

const contractValue: ExtractionField = {
  field: { key: "contract_value", label: "Contract Value", type: "currency", optional: true, raw: "Contract Value (currency)" },
  instruction: "The total contract value.",
  doneWhen: null,
};

const signedOn: ExtractionField = {
  field: { key: "signed_on", label: "Signed On", type: "date", optional: false, raw: "Signed On (date)" },
  instruction: "The date the contract was signed.",
  doneWhen: null,
};

describe("buildExtractionSystemPrompt", () => {
  it("adapts the conversational-node structure: role, field formats, instructions and grounding rules, without questions", () => {
    const prompt = buildExtractionSystemPrompt({
      fields: [supplierName, contractValue],
      guidance: "Each file is one supplier's tender response.",
      contextDocs: [],
    });

    expect(prompt).toContain("<role>");
    expect(prompt).toContain("<field_formats>");
    expect(prompt).toContain("<field_instructions>");
    expect(prompt).toContain("<extraction_rules>");
    expect(prompt).toContain("Each file is one supplier's tender response.");
    expect(prompt).toContain("The supplier's legal name.");
    expect(prompt).toContain("never ask questions");
  });

  it("marks each field required or optional per its annotation", () => {
    const prompt = buildExtractionSystemPrompt({
      fields: [supplierName, contractValue],
      guidance: "",
      contextDocs: [],
    });

    expect(prompt).toContain('"Supplier Name" (key: supplier_name) [required]');
    expect(prompt).toContain('"Contract Value" (key: contract_value) [optional]');
  });

  it("grounds extraction on the context material when present", () => {
    const contextDoc: FlowContextDoc = {
      id: "ctx-1",
      filename: "evaluation-criteria.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 100,
      storagePath: "x",
      extractedText: "Mandatory criteria MC1..MC4",
      extractionStatus: "complete",
    };

    const prompt = buildExtractionSystemPrompt({
      fields: [supplierName],
      guidance: "",
      contextDocs: [contextDoc],
    });

    expect(prompt).toContain("evaluation-criteria.docx");
    expect(prompt).toContain("Mandatory criteria MC1..MC4");
  });

  // Extraction reads third-party documents whose date convention it does not
  // control, so — unlike the conversational node — it must not simply assert
  // day-first. It anchors its own output, then reasons about the source.
  it("anchors day-first output while reasoning about the source's own date convention", () => {
    const prompt = buildExtractionSystemPrompt({
      fields: [signedOn],
      guidance: "",
      contextDocs: [],
    });

    expect(prompt).toContain("the first number is the day and the second is the month");
    expect(prompt).toContain("10-08-2026, never 08-10-2026");
    expect(prompt).toContain("may not use the same convention");
    expect(prompt).toContain("above 12");
  });

  it("sends an undetermined date order to the low-confidence band instead of guessing", () => {
    const prompt = buildExtractionSystemPrompt({
      fields: [signedOn],
      guidance: "",
      contextDocs: [],
    });

    // 30-45 clears EXTRACTION_CONFIDENCE_FLOOR (25, below which the value is
    // blanked) and sits under AMBER_THRESHOLD (50), so it bands red for triage
    // rather than being discarded.
    expect(prompt).toContain("confidence between 30 and 45");
    expect(prompt).toContain("could not be determined");
    expect(prompt).toContain("Never swap a day and month");
  });
});
