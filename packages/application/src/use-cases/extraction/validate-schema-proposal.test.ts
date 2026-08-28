import { describe, expect, it } from "vitest";
import type { ExtractionFieldDraft } from "@rbrasier/domain";
import { validateSchemaProposal } from "./validate-schema-proposal";

const draft = (overrides: Partial<ExtractionFieldDraft> = {}): ExtractionFieldDraft => ({
  label: "Supplier Name",
  annotation: "Supplier Name (text)",
  instruction: "The supplier's legal name.",
  doneWhen: null,
  ...overrides,
});

const blockingMessages = (fields: ExtractionFieldDraft[]): string[] =>
  validateSchemaProposal(fields)
    .filter((finding) => finding.severity === "blocking")
    .map((finding) => finding.message);

describe("validateSchemaProposal", () => {
  it("returns no blocking finding for a coherent set", () => {
    const findings = validateSchemaProposal([
      draft(),
      draft({ label: "Contract Value", annotation: "Contract Value (currency)" }),
      draft({ label: "Signed On", annotation: "Signed On (date) (optional)" }),
    ]);

    expect(findings.filter((finding) => finding.severity === "blocking")).toEqual([]);
  });

  it("blocks two fields that resolve to the same derived key", () => {
    // Keys are derived by lowercasing and snake-casing, so labels that look
    // different in the editor can still collide.
    const messages = blockingMessages([
      draft({ label: "Supplier Name", annotation: "Supplier Name (text)" }),
      draft({ label: "supplier name", annotation: "supplier name (text)" }),
    ]);

    expect(messages.some((message) => message.includes("supplier_name"))).toBe(true);
  });

  it("blocks an annotation the parser rejects, quoting its valid-annotation list", () => {
    const findings = validateSchemaProposal([draft({ annotation: "Supplier Name (colour)" })]);
    const blocking = findings.find((finding) => finding.severity === "blocking");

    expect(blocking).toBeDefined();
    // The parser's own list, not a second copy of it maintained here.
    expect(blocking!.message).toContain("(currency)");
    expect(blocking!.fieldLabel).toBe("Supplier Name");
  });

  it("blocks a length constraint on a type that has no length", () => {
    const messages = blockingMessages([
      draft({ label: "Signed", annotation: "Signed (yesno) (maxlen: 10)" }),
    ]);

    expect(messages.some((message) => message.includes("maxlen"))).toBe(true);
  });

  it("blocks a numeric bound on a type that is not numeric", () => {
    const messages = blockingMessages([
      draft({ label: "Supplier Name", annotation: "Supplier Name (text) (max: 10)" }),
    ]);

    expect(messages.some((message) => message.includes("max"))).toBe(true);
  });

  it("allows a length constraint on text and a numeric bound on a number", () => {
    const findings = validateSchemaProposal([
      draft({ label: "Notes", annotation: "Notes (text) (maxlen: 200)" }),
      draft({ label: "Headcount", annotation: "Headcount (number) (min: 0) (max: 5000)" }),
    ]);

    expect(findings.filter((finding) => finding.severity === "blocking")).toEqual([]);
  });

  it("blocks a section field, matching validateStructuredFieldSet", () => {
    const messages = blockingMessages([draft({ label: "Part B", annotation: "Part B (section)" })]);

    expect(messages.some((message) => message.includes("section"))).toBe(true);
  });

  it("blocks a signature field, matching validateStructuredFieldSet", () => {
    const messages = blockingMessages([
      draft({ label: "Approver", annotation: "Approver (approval)" }),
    ]);

    expect(messages.some((message) => message.includes("signature"))).toBe(true);
  });

  it("blocks a field with no extraction instruction", () => {
    const messages = blockingMessages([draft({ instruction: "   " })]);

    expect(messages.some((message) => message.includes("instruction"))).toBe(true);
  });

  it("blocks an empty field set", () => {
    expect(blockingMessages([])).toHaveLength(1);
  });

  it("advises on a narrative field, which composes rather than copies", () => {
    const findings = validateSchemaProposal([
      draft({ label: "Summary", annotation: "Summary (narrative)" }),
    ]);

    const advisory = findings.find((finding) => finding.severity === "advisory");
    expect(advisory?.fieldLabel).toBe("Summary");
    // Advisory, never blocking — a composed summary is a legitimate field.
    expect(findings.filter((finding) => finding.severity === "blocking")).toEqual([]);
  });

  it("advises on a fixed list of one option, which is a constant rather than a choice", () => {
    const findings = validateSchemaProposal([
      draft({ label: "Status", annotation: "Status (options: Active)" }),
    ]);

    expect(findings.some((finding) => finding.severity === "advisory")).toBe(true);
    expect(findings.filter((finding) => finding.severity === "blocking")).toEqual([]);
  });

  it("reports every blocking field rather than stopping at the first", () => {
    // The author is refining a whole set; fixing one problem per turn would make
    // the conversation as long as the number of mistakes.
    const messages = blockingMessages([
      draft({ label: "One", annotation: "One (colour)" }),
      draft({ label: "Two", annotation: "Two (flavour)" }),
    ]);

    expect(messages).toHaveLength(2);
  });
});
