import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  ExtractionSchema,
  IDocumentExtractor,
  ILanguageModel,
} from "@rbrasier/domain";
import { RunSampleExtraction, type SampleInputDocument } from "./run-sample-extraction";

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const schema = (cardinality: "one_per_file" | "many_per_record"): ExtractionSchema => ({
  fields: [
    {
      field: { key: "supplier_name", label: "Supplier Name", type: "text", optional: false, raw: "Supplier Name" },
      instruction: "The supplier's legal name.",
      doneWhen: null,
    },
  ],
  input: {
    cardinality,
    selectionCriteria: cardinality === "many_per_record" ? "group by folder" : null,
    guidance: "Read each supplier response.",
  },
  output: {
    format: "xlsx",
    outputTemplate: null,
    instruction: "One row per supplier.",
    generateSummary: false,
    summaryTemplate: null,
    contextDocs: [],
  },
});

const doc = (id: string, filename: string, treePath = filename): SampleInputDocument => ({
  id,
  filename,
  treePath,
  mimeType: "application/pdf",
  buffer: Buffer.from(`content of ${filename}`),
});

const extractorReturning = (textByFilename: Record<string, string>): IDocumentExtractor => ({
  extract: vi.fn().mockImplementation(({ buffer }: { buffer: Buffer }) => {
    const filename = buffer.toString().replace("content of ", "");
    return Promise.resolve(ok(textByFilename[filename] ?? ""));
  }),
});

// Returns supplier_name = the first source filename, high confidence.
const extractionModel = (): ILanguageModel =>
  ({
    provider: "anthropic",
    generateObject: vi.fn().mockImplementation((input: { prompt: string }) =>
      Promise.resolve(
        ok({
          object: {
            supplier_name: { value: "Extracted", confidence: 88, rationale: "From the document." },
          },
          usage,
        }),
      ),
    ),
    generateText: vi.fn(),
    streamText: vi.fn(),
    streamObject: vi.fn(),
  }) as unknown as ILanguageModel;

describe("RunSampleExtraction — one_per_file", () => {
  it("produces one record per document, each linked to its source file", async () => {
    const model = extractionModel();
    const extractor = extractorReturning({ "acme.pdf": "Acme Ltd", "globex.pdf": "Globex Inc" });
    const useCase = new RunSampleExtraction(model, extractor);

    const result = await useCase.execute({
      schema: schema("one_per_file"),
      documents: [doc("d1", "acme.pdf"), doc("d2", "globex.pdf")],
    });

    expect(result.error).toBeUndefined();
    expect(result.data!.records).toHaveLength(2);
    expect(result.data!.records[0]!.sourceDocumentIds).toEqual(["d1"]);
    expect(result.data!.records[0]!.fields[0]!.value).toBe("Extracted");
    expect(result.data!.documents.map((document) => document.readable)).toEqual([true, true]);
    expect(result.data!.exceptionFileIds).toEqual([]);
  });

  it("marks an empty-text document unreadable and does not invent a value for it", async () => {
    const model = extractionModel();
    const extractor = extractorReturning({ "acme.pdf": "Acme Ltd", "scan.pdf": "" });
    const useCase = new RunSampleExtraction(model, extractor);

    const result = await useCase.execute({
      schema: schema("one_per_file"),
      documents: [doc("d1", "acme.pdf"), doc("d2", "scan.pdf")],
    });

    const scanDoc = result.data!.documents.find((document) => document.id === "d2");
    expect(scanDoc!.readable).toBe(false);
    const scanRecord = result.data!.records.find((record) => record.sourceDocumentIds.includes("d2"));
    expect(scanRecord!.fields[0]!.value).toBe("");
    expect(scanRecord!.fields[0]!.confidence).toBe(0);
  });

  it("rejects a sample larger than the allowed maximum", async () => {
    const useCase = new RunSampleExtraction(extractionModel(), extractorReturning({}));

    const result = await useCase.execute({
      schema: schema("one_per_file"),
      documents: [doc("d1", "a.pdf"), doc("d2", "b.pdf"), doc("d3", "c.pdf"), doc("d4", "d.pdf")],
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an empty sample", async () => {
    const useCase = new RunSampleExtraction(extractionModel(), extractorReturning({}));

    const result = await useCase.execute({ schema: schema("one_per_file"), documents: [] });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("RunSampleExtraction — many_per_record", () => {
  it("runs the grouping pass, then extracts per record over its grouped files", async () => {
    const groupingModel = {
      provider: "anthropic",
      generateObject: vi
        .fn()
        .mockResolvedValueOnce(
          ok({ object: { records: [{ label: "Acme", fileIds: ["d1", "d2"] }] }, usage }),
        )
        .mockResolvedValueOnce(
          ok({
            object: { supplier_name: { value: "Acme Ltd", confidence: 90, rationale: "Cover." } },
            usage,
          }),
        ),
      generateText: vi.fn(),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    } as unknown as ILanguageModel;
    const extractor = extractorReturning({ "acme-cover.pdf": "Acme cover", "acme-price.pdf": "Acme price" });
    const useCase = new RunSampleExtraction(groupingModel, extractor);

    const result = await useCase.execute({
      schema: schema("many_per_record"),
      documents: [doc("d1", "acme-cover.pdf", "acme/cover.pdf"), doc("d2", "acme-price.pdf", "acme/price.pdf")],
    });

    expect(result.error).toBeUndefined();
    expect(result.data!.records).toHaveLength(1);
    expect(result.data!.records[0]!.sourceDocumentIds.sort()).toEqual(["d1", "d2"]);
    expect(result.data!.records[0]!.label).toBe("Acme");
  });

  it("surfaces a file matched by no record as an exception", async () => {
    const groupingModel = {
      provider: "anthropic",
      generateObject: vi
        .fn()
        .mockResolvedValueOnce(
          ok({ object: { records: [{ label: "Acme", fileIds: ["d1"] }] }, usage }),
        )
        .mockResolvedValue(
          ok({
            object: { supplier_name: { value: "Acme", confidence: 80, rationale: "x" } },
            usage,
          }),
        ),
      generateText: vi.fn(),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    } as unknown as ILanguageModel;
    const extractor = extractorReturning({ "a.pdf": "A", "b.pdf": "B" });
    const useCase = new RunSampleExtraction(groupingModel, extractor);

    const result = await useCase.execute({
      schema: schema("many_per_record"),
      documents: [doc("d1", "a.pdf"), doc("d2", "b.pdf")],
    });

    expect(result.data!.exceptionFileIds).toEqual(["d2"]);
  });

  it("propagates a grouping-pass model error", async () => {
    const model = {
      provider: "anthropic",
      generateObject: vi.fn().mockResolvedValue(err(domainError("AI_PROVIDER_FAILED", "boom"))),
      generateText: vi.fn(),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    } as unknown as ILanguageModel;
    const useCase = new RunSampleExtraction(model, extractorReturning({ "a.pdf": "A" }));

    const result = await useCase.execute({
      schema: schema("many_per_record"),
      documents: [doc("d1", "a.pdf")],
    });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});
