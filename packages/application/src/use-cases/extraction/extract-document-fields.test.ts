import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type { ExtractionField, ILanguageModel } from "@rbrasier/domain";
import type { ExtractionResultData } from "@rbrasier/shared";
import { extractDocumentFields, UNREADABLE_RATIONALE } from "./extract-document-fields";

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

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

const makeModel = (object: ExtractionResultData): ILanguageModel =>
  ({
    provider: "anthropic",
    generateObject: vi.fn().mockResolvedValue(ok({ object, usage })),
    generateText: vi.fn(),
    streamText: vi.fn(),
    streamObject: vi.fn(),
  }) as unknown as ILanguageModel;

describe("extractDocumentFields", () => {
  it("returns one scored result per schema field, in schema order, normalising confidence to 0..1", async () => {
    const model = makeModel({
      supplier_name: { value: "Acme Ltd", confidence: 90, rationale: "Cover page." },
      contract_value: { value: "$1,200.00", confidence: 60, rationale: "Pricing sheet." },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName, contractValue],
      recordLabel: "Acme response",
      documentTexts: [{ documentId: "doc-acme", filename: "acme.pdf", text: "Acme Ltd proposes $1,200." }],
      contextDocs: [],
      instruction: "Read each supplier response.",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([
      // "Acme Ltd" occurs byte-identically in the source text, so it was
      // selected rather than composed; "$1,200.00" was reformatted from
      // "$1,200." and is therefore processed, which absence already says.
      {
        key: "supplier_name",
        value: "Acme Ltd",
        confidence: 0.9,
        rationale: "Cover page.",
        provenance: "verbatim",
      },
      { key: "contract_value", value: "$1,200.00", confidence: 0.6, rationale: "Pricing sheet." },
    ]);
  });

  it("puts field instructions and guidance in the system prompt and the record documents in the user prompt", async () => {
    const model = makeModel({
      supplier_name: { value: "Acme", confidence: 80, rationale: "x" },
    });

    await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme response",
      documentTexts: [{ documentId: "doc-acme", filename: "acme.pdf", text: "Acme Ltd" }],
      contextDocs: [],
      instruction: "Read carefully.",
    });

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // The stable, authored content moves into the system prompt (mirrors the
    // conversational node and lets the "view system prompt" preview reuse it).
    expect(call.system).toContain("The supplier's legal name.");
    expect(call.system).toContain("Read carefully.");
    expect(call.system).toContain("never ask questions");
    // The per-record document text stays in the user prompt.
    expect(call.prompt).toContain("acme.pdf");
    expect(call.prompt).toContain("Acme Ltd");
  });

  it("requests an explicit key for every field so the model cannot silently drop later fields", async () => {
    const model = makeModel({
      supplier_name: { value: "Acme", confidence: 80, rationale: "x" },
      contract_value: { value: "$5", confidence: 70, rationale: "y" },
    });

    await extractDocumentFields(model, {
      fields: [supplierName, contractValue],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme $5" }],
      contextDocs: [],
      instruction: "",
    });

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // Every field key is a required property of the schema (not a free-form record).
    const schemaKeys = Object.keys(call.schema.shape ?? {});
    expect(schemaKeys).toEqual(["supplier_name", "contract_value"]);
  });

  it("discards a value the model returns with confidence below the reliable-extraction floor", async () => {
    const model = makeModel({
      supplier_name: { value: "Acme", confidence: 90, rationale: "clear" },
      contract_value: { value: "$9,999", confidence: 10, rationale: "a wild guess" },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName, contractValue],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme Ltd" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.value).toBe("Acme");
    expect(result.data![1]).toMatchObject({ key: "contract_value", value: "", confidence: 0 });
    expect(result.data![1]!.rationale).toContain("threshold");
  });

  it("fills a missing field key best-effort with an empty, zero-confidence result", async () => {
    const model = makeModel({
      supplier_name: { value: "Acme", confidence: 85, rationale: "ok" },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName, contractValue],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![1]).toEqual({
      key: "contract_value",
      value: "",
      confidence: 0,
      rationale: expect.any(String),
    });
  });

  it("clamps an out-of-range confidence the model returns", async () => {
    const model = makeModel({
      supplier_name: { value: "Acme", confidence: 250, rationale: "x" },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.confidence).toBe(1);
  });

  it("flags an empty-text record as unreadable without calling the model (scanned-PDF guard)", async () => {
    const model = makeModel({});

    const result = await extractDocumentFields(model, {
      fields: [supplierName, contractValue],
      recordLabel: "Scan",
      documentTexts: [{ documentId: "doc-scan", filename: "scan.pdf", text: "   " }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.error).toBeUndefined();
    expect(model.generateObject).not.toHaveBeenCalled();
    expect(result.data).toEqual([
      { key: "supplier_name", value: "", confidence: 0, rationale: UNREADABLE_RATIONALE },
      { key: "contract_value", value: "", confidence: 0, rationale: UNREADABLE_RATIONALE },
    ]);
  });

  it("marks a value verbatim only when it occurs byte-identically in a source text", async () => {
    const model = makeModel({
      supplier_name: { value: "Acme Ltd", confidence: 90, rationale: "Cover page." },
      contract_value: { value: "$1,200.00", confidence: 90, rationale: "Reformatted." },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName, contractValue],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme Ltd — 1200 dollars" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.provenance).toBe("verbatim");
    // Composed stays unstamped: absence already reads as `processed`, so writing
    // it would add a member to every composed row to say what its omission says.
    expect(result.data![1]!.provenance).toBeUndefined();
  });

  it("finds a verbatim value in any of a multi-document record's texts", async () => {
    const model = makeModel({
      supplier_name: { value: "Beta Holdings", confidence: 90, rationale: "Schedule 2." },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Beta",
      documentTexts: [
        { documentId: "doc-a", filename: "cover.pdf", text: "Covering letter" },
        { documentId: "doc-b", filename: "schedule.pdf", text: "Party: Beta Holdings" },
      ],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.provenance).toBe("verbatim");
  });

  it("does not mark a value the confidence floor discarded as verbatim", async () => {
    // The blanked value is no longer in the document, and an empty string
    // occurs in every text — stamping it would claim a copy of nothing.
    const model = makeModel({
      supplier_name: { value: "Acme Ltd", confidence: 5, rationale: "a guess" },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme Ltd" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.value).toBe("");
    expect(result.data![0]!.provenance).toBeUndefined();
  });

  it("resolves a reported source reference to the document id it names", async () => {
    const model = makeModel({
      supplier_name: {
        value: "Acme Ltd",
        confidence: 90,
        rationale: "Cover page.",
        sourceRef: { document: "acme.pdf", locator: "page 1, header" },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-acme", filename: "acme.pdf", text: "Acme Ltd" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.sourceRef).toEqual({
      documentId: "doc-acme",
      locator: "page 1, header",
    });
  });

  it("leaves the source reference absent when the model omits it, rather than failing or emptying it", async () => {
    const model = makeModel({
      supplier_name: { value: "Acme Ltd", confidence: 90, rationale: "Cover page." },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-acme", filename: "acme.pdf", text: "Acme Ltd" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.error).toBeUndefined();
    expect(result.data![0]).not.toHaveProperty("sourceRef");
  });

  it("drops a source reference naming a document outside the record", async () => {
    // Nothing can open a locator against a document this record never had, so
    // the reference is dropped rather than stored against a guessed id.
    const model = makeModel({
      supplier_name: {
        value: "Acme Ltd",
        confidence: 90,
        rationale: "Cover page.",
        sourceRef: { document: "somewhere-else.pdf", locator: "page 4" },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-acme", filename: "acme.pdf", text: "Acme Ltd" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]).not.toHaveProperty("sourceRef");
  });

  it("drops a source reference whose locator is blank", async () => {
    const model = makeModel({
      supplier_name: {
        value: "Acme Ltd",
        confidence: 90,
        rationale: "Cover page.",
        sourceRef: { document: "acme.pdf", locator: "   " },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-acme", filename: "acme.pdf", text: "Acme Ltd" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]).not.toHaveProperty("sourceRef");
  });

  it("drops a source reference on a value the confidence floor discarded", async () => {
    const model = makeModel({
      supplier_name: {
        value: "Acme Ltd",
        confidence: 5,
        rationale: "a guess",
        sourceRef: { document: "acme.pdf", locator: "page 1" },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-acme", filename: "acme.pdf", text: "Acme Ltd" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.value).toBe("");
    expect(result.data![0]).not.toHaveProperty("sourceRef");
  });

  it("asks for a source reference in the system prompt and states it is optional", async () => {
    const model = makeModel({
      supplier_name: { value: "Acme", confidence: 80, rationale: "x" },
    });

    await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme" }],
      contextDocs: [],
      instruction: "",
    });

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.system).toContain("sourceRef");
    expect(call.system).toContain("Omit");
  });

  it("propagates a model error", async () => {
    const model = {
      provider: "anthropic",
      generateObject: vi.fn().mockResolvedValue(err(domainError("AI_PROVIDER_FAILED", "boom"))),
      generateText: vi.fn(),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    } as unknown as ILanguageModel;

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme Ltd" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});
