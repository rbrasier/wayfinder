import { describe, expect, it, vi } from "vitest";
import {
  countOccurrences,
  domainError,
  err,
  ok,
  type IDocumentGenerator,
  type ILanguageModel,
  type TemplateAnnotationEdit,
  type TemplateDraftField,
} from "@rbrasier/domain";
import { DraftTemplateFromExamples } from "./draft-template-from-examples";

const USAGE = {
  promptTokens: 10,
  completionTokens: 10,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const field = (overrides: Partial<TemplateDraftField>): TemplateDraftField => ({
  label: "Supplier Name",
  type: "text",
  options: [],
  multiple: false,
  sourceValue: "Acme Pty Ltd",
  occurrence: 0,
  ...overrides,
});

// The first call is extraction, the second the checking pass.
const makeLanguageModel = (
  extracted: TemplateDraftField[],
  checkingPass: TemplateDraftField[] = [],
): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi
    .fn()
    .mockResolvedValueOnce(ok({ object: { fields: extracted }, usage: USAGE, provider: "anthropic", model: "m" }))
    .mockResolvedValueOnce(ok({ object: { fields: checkingPass }, usage: USAGE, provider: "anthropic", model: "m" })),
  generateText: vi.fn(),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

// An in-memory document whose bytes are its text, annotated the way the real
// generator does it: occurrence-addressed, one line (paragraph) at a time.
const makeDocumentGenerator = (options: { refuse?: string[] } = {}): IDocumentGenerator => ({
  extractTags: vi.fn(),
  extractFields: vi.fn(),
  generate: vi.fn(),
  extractFullText: ({ templateBytes }) => ok({ text: templateBytes.toString("utf8") }),
  annotate: ({ templateBytes, edits }) => {
    const unmatched: TemplateAnnotationEdit[] = [];
    let text = templateBytes.toString("utf8");
    const ordered = edits
      .map((edit) => ({ edit, position: positionOf(text, edit.find, edit.occurrence) }))
      .sort((a, b) => b.position - a.position);
    for (const { edit, position } of ordered) {
      if (position < 0 || options.refuse?.includes(edit.find)) {
        unmatched.push(edit);
        continue;
      }
      text = text.slice(0, position) + edit.replacement + text.slice(position + edit.find.length);
    }
    return ok({ bytes: Buffer.from(text), appliedCount: edits.length - unmatched.length, unmatched });
  },
});

const positionOf = (text: string, value: string, occurrence: number): number => {
  let from = 0;
  for (let seen = 0; ; seen += 1) {
    const index = text.indexOf(value, from);
    if (index < 0 || seen === occurrence) return index;
    from = index + value.length;
  }
};

const draft = (
  languageModel: ILanguageModel,
  baseText: string,
  otherTexts: string[] = [],
  documentGenerator = makeDocumentGenerator(),
) =>
  new DraftTemplateFromExamples(languageModel, documentGenerator).execute({
    baseBytes: Buffer.from(baseText),
    baseText,
    otherTexts,
  });

describe("DraftTemplateFromExamples", () => {
  it("drafts a field and writes its placeholder over the value", async () => {
    const languageModel = makeLanguageModel([field({})]);

    const result = await draft(languageModel, "Supplier Name: Acme Pty Ltd");

    expect(result.data?.fields).toHaveLength(1);
    expect(result.data?.fields[0]).toMatchObject({
      line: "Supplier Name",
      sourceText: "Acme Pty Ltd",
      occurrence: 0,
      insertAfter: false,
      replacedValue: "Acme Pty Ltd",
      context: "Supplier Name: Acme Pty Ltd",
      evidence: { kind: "single-example" },
    });
    expect(result.data?.taggedDocument.toString("utf8")).toBe("Supplier Name: {{ Supplier Name }}");
  });

  it("serialises the type and options into the annotation line", async () => {
    const languageModel = makeLanguageModel([
      field({ label: "Contract Value", type: "currency", sourceValue: "$5,000" }),
      field({ label: "Equipment", options: ["Laptop", "Mobile phone"], multiple: true, sourceValue: "Laptop, Mobile phone" }),
    ]);

    const result = await draft(languageModel, "Value: $5,000\nEquipment: Laptop, Mobile phone");

    expect(result.data?.fields.map((drafted) => drafted.line)).toEqual([
      "Contract Value (currency)",
      "Equipment (multi-options: Laptop, Mobile phone)",
    ]);
  });

  it("drops a field whose value is not in the document", async () => {
    const languageModel = makeLanguageModel([field({ sourceValue: "Globex" })]);

    const result = await draft(languageModel, "Supplier Name: Acme Pty Ltd");

    expect(result.data?.fields).toEqual([]);
    expect(result.data?.unplaced).toEqual([
      { label: "Supplier Name", sourceValue: "Globex", reason: "not-in-document" },
    ]);
  });

  it("drops a field whose occurrence the document does not have", async () => {
    const languageModel = makeLanguageModel([field({ sourceValue: "Acme", occurrence: 1 })]);

    const result = await draft(languageModel, "Supplier: Acme");

    expect(result.data?.fields).toEqual([]);
  });

  it("places a field the model anchored on its caption onto the value", async () => {
    const languageModel = makeLanguageModel([
      field({ label: "Employee Name", sourceValue: "Employee Name" }),
    ]);

    const result = await draft(languageModel, "Employee Name\nRichard Brasier");

    expect(result.data?.fields[0]?.sourceText).toBe("Richard Brasier");
    expect(result.data?.taggedDocument.toString("utf8")).toBe("Employee Name\n{{ Employee Name }}");
  });

  it("writes the placeholder after the caption when the example left it blank", async () => {
    const languageModel = makeLanguageModel([
      field({ label: "Equipment Type", sourceValue: "Equipment Type" }),
    ]);

    const result = await draft(languageModel, "Equipment Type", ["Equipment Type\nLaptop"]);

    expect(result.data?.fields[0]).toMatchObject({
      insertAfter: true,
      evidence: { kind: "blank-in-example" },
    });
    expect(result.data?.taggedDocument.toString("utf8")).toBe("Equipment Type {{ Equipment Type }}");
  });

  describe("with more than one example", () => {
    it("records how many other examples differ", async () => {
      const languageModel = makeLanguageModel([field({})]);

      const result = await draft(languageModel, "Supplier Name: Acme Pty Ltd", [
        "Supplier Name: Globex",
        "Supplier Name: Initech",
      ]);

      expect(result.data?.fields[0]?.evidence).toEqual({ kind: "varies", differsIn: 2, of: 2 });
    });

    it("leaves a value that is the same in every example untagged", async () => {
      const languageModel = makeLanguageModel([
        field({ label: "Payment Terms", sourceValue: "Net 30" }),
        field({}),
      ]);

      const result = await draft(languageModel, "Terms: Net 30\nSupplier Name: Acme Pty Ltd", [
        "Terms: Net 30\nSupplier Name: Globex",
      ]);

      expect(result.data?.fields.map((drafted) => drafted.field.label)).toEqual(["Supplier Name"]);
      expect(result.data?.sameInEveryExample.map((drafted) => drafted.field.label)).toEqual(["Payment Terms"]);
      expect(result.data?.taggedDocument.toString("utf8")).toContain("Terms: Net 30");
    });

    it("collects a multi-select's choices from every example", async () => {
      const languageModel = makeLanguageModel([
        field({ label: "Equipment", options: ["Laptop", "Mobile phone"], multiple: true, sourceValue: "Laptop, Mobile phone" }),
      ]);

      const result = await draft(languageModel, "Equipment\nLaptop, Mobile phone", [
        "Equipment\nMonitor / Laptop",
      ]);

      expect(result.data?.fields[0]?.field.options).toEqual(["Laptop", "Mobile phone", "Monitor"]);
    });
  });

  it("skips the comparison when there is only one example", async () => {
    const languageModel = makeLanguageModel([field({ label: "Payment Terms", sourceValue: "Net 30" })]);

    const result = await draft(languageModel, "Terms: Net 30");

    expect(result.data?.fields[0]?.evidence).toEqual({ kind: "single-example" });
  });

  describe("the checking pass", () => {
    it("adds a field it found, marked as needing confirmation", async () => {
      const languageModel = makeLanguageModel([field({})], [field({ label: "Reference", sourceValue: "PO-42" })]);

      const result = await draft(languageModel, "Supplier Name: Acme Pty Ltd\nRef: PO-42");

      expect(result.data?.fields.map((drafted) => drafted.field.label)).toEqual(["Supplier Name", "Reference"]);
      expect(result.data?.fields[1]?.evidence).toEqual({ kind: "checking-pass" });
    });

    it("sees the tagged text and maps its occurrence back to the original", async () => {
      const languageModel = makeLanguageModel(
        [field({ sourceValue: "Acme", occurrence: 0 })],
        [field({ label: "Billed To", sourceValue: "Acme", occurrence: 0 })],
      );

      const result = await draft(languageModel, "Supplier Name: Acme\nBilled to: Acme");

      const checkingPrompt = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]
        .prompt as string;
      expect(checkingPrompt).toContain("Supplier Name: {{ Supplier Name }}");
      expect(result.data?.fields[1]).toMatchObject({ sourceText: "Acme", occurrence: 1 });
      expect(result.data?.taggedDocument.toString("utf8")).toBe(
        "Supplier Name: {{ Supplier Name }}\nBilled to: {{ Billed To }}",
      );
    });

    it("cannot replace a field already placed", async () => {
      const languageModel = makeLanguageModel(
        [field({})],
        [field({ label: "Company", sourceValue: "{{ Supplier Name }}" }), field({ label: "Supplier Name", sourceValue: "Acme Pty Ltd" })],
      );

      const result = await draft(languageModel, "Supplier Name: Acme Pty Ltd");

      expect(result.data?.fields.map((drafted) => drafted.field.label)).toEqual(["Supplier Name"]);
      expect(result.data?.fields[0]?.evidence).toEqual({ kind: "single-example" });
    });

    it("leaves the extracted fields standing when it fails", async () => {
      const languageModel = makeLanguageModel([field({})]);
      (languageModel.generateObject as ReturnType<typeof vi.fn>)
        .mockReset()
        .mockResolvedValueOnce(ok({ object: { fields: [field({})] }, usage: USAGE, provider: "anthropic", model: "m" }))
        .mockResolvedValueOnce(err(domainError("AI_PROVIDER_FAILED", "down")));

      const result = await draft(languageModel, "Supplier Name: Acme Pty Ltd");

      expect(result.data?.fields).toHaveLength(1);
    });
  });

  it("reports an edit the document refused instead of claiming it", async () => {
    const languageModel = makeLanguageModel([field({}), field({ label: "Reference", sourceValue: "PO-42" })]);

    const result = await draft(
      languageModel,
      "Supplier Name: Acme Pty Ltd\nRef: PO-42",
      [],
      makeDocumentGenerator({ refuse: ["PO-42"] }),
    );

    expect(result.data?.fields.map((drafted) => drafted.field.label)).toEqual(["Supplier Name"]);
    expect(result.data?.unplaced).toEqual([{ label: "Reference", sourceValue: "PO-42", reason: "could-not-place" }]);
    expect(result.data?.comparison.taggedText).toBe("Supplier Name: {{ Supplier Name }}\nRef: PO-42");
  });

  it("links every placed value to its placeholder for the side-by-side comparison", async () => {
    const languageModel = makeLanguageModel([field({})]);

    const result = await draft(languageModel, "Supplier Name: Acme Pty Ltd");

    const comparison = result.data!.comparison;
    const link = comparison.links[0]!;
    expect(comparison.originalText.slice(link.originalStart, link.originalEnd)).toBe("Acme Pty Ltd");
    expect(comparison.taggedText.slice(link.taggedStart, link.taggedEnd)).toBe("{{ Supplier Name }}");
    expect(link.fieldKey).toBe("supplier_name");
  });

  it("never lets two fields claim the same text", async () => {
    const languageModel = makeLanguageModel([field({}), field({ label: "Company", sourceValue: "Acme Pty Ltd" })]);

    const result = await draft(languageModel, "Supplier Name: Acme Pty Ltd");

    expect(result.data?.fields.map((drafted) => drafted.field.label)).toEqual(["Supplier Name"]);
    expect(countOccurrences(result.data!.taggedDocument.toString("utf8"), "{{")).toBe(1);
  });

  it("returns an error when extraction fails", async () => {
    const languageModel = makeLanguageModel([]);
    (languageModel.generateObject as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce(err(domainError("AI_PROVIDER_FAILED", "down")));

    const result = await draft(languageModel, "Supplier Name: Acme Pty Ltd");

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });

  it("tells the model to quote the value, never the caption", async () => {
    const languageModel = makeLanguageModel([]);

    await draft(languageModel, "Employee Name\nRichard Brasier");

    const prompt = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].prompt as string;
    expect(prompt).toContain("never the caption");
    expect(prompt).toContain("Employee Name\nRichard Brasier");
  });

  it("labels its two calls for usage tracking", async () => {
    const languageModel = makeLanguageModel([field({})]);

    await draft(languageModel, "Supplier Name: Acme Pty Ltd");

    const calls = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((call) => call[0].purpose)).toEqual(["template-draft-extract", "template-draft-verify"]);
  });
});
