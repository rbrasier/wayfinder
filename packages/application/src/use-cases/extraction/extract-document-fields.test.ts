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
      supplier_name: {
        value: "Acme Ltd",
        confidence: 90,
        rationale: "Cover page.",
        sourceRef: { document: "acme.pdf", locator: "page 1", quote: "Acme Ltd proposes" },
      },
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
      // The model quoted "Acme Ltd proposes" from acme.pdf and the quote
      // verifies against that document's text, so the value was selected rather
      // than composed; "$1,200.00" was reformatted from "$1,200." and claims no
      // quote, so it is processed — which absence already says.
      {
        key: "supplier_name",
        value: "Acme Ltd",
        confidence: 0.9,
        rationale: "Cover page.",
        provenance: "verbatim",
        sourceRef: { documentId: "doc-acme", locator: "page 1", quote: "Acme Ltd proposes" },
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

  it("stamps verbatim when the model's quote verifies against the document it named", async () => {
    const model = makeModel({
      supplier_name: {
        value: "Acme Ltd",
        confidence: 90,
        rationale: "Cover page.",
        sourceRef: { document: "a.pdf", locator: "page 1", quote: "Acme Ltd — 1200 dollars" },
      },
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

  it("does not stamp verbatim on a composed value that happens to occur in the document", async () => {
    // The defect this contract closes. Before, containment alone stamped this
    // Copied, which put it on the selection scale and won merge arbitration
    // outright — so a coincidence could displace a better-supported answer.
    const model = makeModel({
      supplier_name: { value: "N/A", confidence: 90, rationale: "No supplier is named." },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [
        { documentId: "doc-a", filename: "a.pdf", text: "The N/A designation applies to part 4." },
      ],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.provenance).toBeUndefined();
  });

  it("verifies the quote against the named document rather than any of the record's texts", async () => {
    // The quote is real, but it is in the other document. Nothing here
    // establishes the value came from the one the model pointed at.
    const model = makeModel({
      supplier_name: {
        value: "Beta Holdings",
        confidence: 90,
        rationale: "Schedule 2.",
        sourceRef: { document: "cover.pdf", locator: "page 1", quote: "Party: Beta Holdings" },
      },
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

    expect(result.data![0]!.provenance).toBeUndefined();
  });

  it("keeps a resolved source reference on a value whose quote failed to verify", async () => {
    // The claim is refused silently: the locator may well be right even where
    // the quote was mis-transcribed, so the reference is still worth showing.
    const model = makeModel({
      supplier_name: {
        value: "Acme Ltd",
        confidence: 90,
        rationale: "Cover page.",
        sourceRef: { document: "a.pdf", locator: "page 1", quote: "Supplied by Acme Ltd" },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme Ltd of Bristol" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.provenance).toBeUndefined();
    expect(result.data![0]!.sourceRef).toEqual({
      documentId: "doc-a",
      locator: "page 1",
      quote: "Supplied by Acme Ltd",
    });
  });

  it("does not stamp verbatim when the value occurs in its quote only inside a longer word", async () => {
    const model = makeModel({
      supplier_name: {
        value: "No",
        confidence: 90,
        rationale: "Notice clause.",
        sourceRef: { document: "a.pdf", locator: "clause 4", quote: "Notice of termination" },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Notice of termination" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.provenance).toBeUndefined();
  });

  it("does not mark a value the confidence floor discarded as verbatim", async () => {
    // The blanked value is no longer in the document, so stamping it would
    // claim a copy of nothing.
    const model = makeModel({
      supplier_name: {
        value: "Acme Ltd",
        confidence: 5,
        rationale: "a guess",
        sourceRef: { document: "a.pdf", locator: "page 1", quote: "Acme Ltd" },
      },
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

  it("does not mark a reshaped type verbatim even when its quote verifies", async () => {
    // A yesno, date, number or currency field reformats what it read by
    // definition, so the characters appearing in the quote is coincidence.
    const renewed: ExtractionField = {
      field: { key: "renewed", label: "Renewed", type: "yesno", optional: false, raw: "Renewed (yesno)" },
      instruction: "Whether the contract renews.",
      doneWhen: null,
    };
    const model = makeModel({
      renewed: {
        value: "No",
        confidence: 90,
        rationale: "Notice clause.",
        sourceRef: { document: "a.pdf", locator: "clause 4", quote: "No renewal applies." },
      },
      contract_value: {
        value: "$1,200.00",
        confidence: 90,
        rationale: "Pricing.",
        sourceRef: { document: "a.pdf", locator: "page 2", quote: "$1,200.00 total." },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [renewed, contractValue],
      recordLabel: "Acme",
      documentTexts: [
        {
          documentId: "doc-a",
          filename: "a.pdf",
          text: "No renewal applies. Notice period applies. $1,200.00 total.",
        },
      ],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.provenance).toBeUndefined();
    expect(result.data![1]!.provenance).toBeUndefined();
  });

  it("does not mark an options-restricted field verbatim, since its value is mapped to the list", async () => {
    const status: ExtractionField = {
      field: {
        key: "status",
        label: "Status",
        type: "text",
        options: ["Draft", "Final"],
        optional: false,
        raw: "Status (options: Draft, Final)",
      },
      instruction: "The bid status.",
      doneWhen: null,
    };
    const model = makeModel({
      status: {
        value: "Draft",
        confidence: 90,
        rationale: "Heading.",
        sourceRef: { document: "a.pdf", locator: "heading", quote: "Draft agreement" },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [status],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Draft agreement" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.provenance).toBeUndefined();
  });

  it("does not mark a whitespace-only value verbatim", async () => {
    // The floor leaves a blank value alone, so the verbatim check has to use the
    // same definition of blank the floor does.
    const model = makeModel({
      supplier_name: {
        value: "   ",
        confidence: 90,
        rationale: "x",
        sourceRef: { document: "a.pdf", locator: "page 1", quote: "Acme Ltd trading" },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Acme",
      documentTexts: [{ documentId: "doc-a", filename: "a.pdf", text: "Acme Ltd trading" }],
      contextDocs: [],
      instruction: "",
    });

    expect(result.data![0]!.provenance).toBeUndefined();
  });

  it("labels two same-named documents distinctly so a source reference reaches the right one", async () => {
    const model = makeModel({
      supplier_name: {
        value: "Beta Ltd",
        confidence: 90,
        rationale: "Second invoice.",
        sourceRef: { document: "invoice.pdf (2)", locator: "page 1", quote: "Beta Ltd" },
      },
    });

    const result = await extractDocumentFields(model, {
      fields: [supplierName],
      recordLabel: "Pair",
      documentTexts: [
        { documentId: "doc-a", filename: "invoice.pdf", text: "Acme Ltd" },
        { documentId: "doc-b", filename: "invoice.pdf", text: "Beta Ltd" },
      ],
      contextDocs: [],
      instruction: "",
    });

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt).toContain("[invoice.pdf]");
    expect(call.prompt).toContain("[invoice.pdf (2)]");
    expect(result.data![0]!.sourceRef).toEqual({
      documentId: "doc-b",
      locator: "page 1",
      quote: "Beta Ltd",
    });
  });

  it("resolves a reported source reference to the document id it names", async () => {
    const model = makeModel({
      supplier_name: {
        value: "Acme Ltd",
        confidence: 90,
        rationale: "Cover page.",
        sourceRef: { document: "acme.pdf", locator: "page 1, header", quote: "Acme Ltd" },
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
      quote: "Acme Ltd",
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
        sourceRef: { document: "somewhere-else.pdf", locator: "page 4", quote: "Acme Ltd" },
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
        sourceRef: { document: "acme.pdf", locator: "   ", quote: "Acme Ltd" },
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
        sourceRef: { document: "acme.pdf", locator: "page 1", quote: "Acme Ltd" },
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
