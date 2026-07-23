import { describe, expect, it } from "vitest";
import {
  aggregateConfidence,
  applyFieldEdit,
  confidenceBand,
  fieldCompleteness,
  mergeFieldResults,
  recordConfidenceBand,
  type ExtractionFieldResult,
  type ExtractionRecord,
} from "./extraction-record";

const fieldResult = (overrides: Partial<ExtractionFieldResult> = {}): ExtractionFieldResult => ({
  key: "supplier_name",
  value: "Acme Ltd",
  confidence: 0.9,
  rationale: "Stated on the cover page.",
  ...overrides,
});

const record = (fields: ExtractionFieldResult[]): ExtractionRecord => ({
  id: "record-1",
  label: "Acme response",
  fields,
  sourceDocumentIds: ["doc-1"],
});

describe("confidenceBand", () => {
  it("maps low confidence to red", () => {
    expect(confidenceBand(0)).toBe("red");
    expect(confidenceBand(0.49)).toBe("red");
  });

  it("maps mid confidence to amber", () => {
    expect(confidenceBand(0.5)).toBe("amber");
    expect(confidenceBand(0.79)).toBe("amber");
  });

  it("maps high confidence to green", () => {
    expect(confidenceBand(0.8)).toBe("green");
    expect(confidenceBand(1)).toBe("green");
  });

  it("clamps out-of-range values", () => {
    expect(confidenceBand(-1)).toBe("red");
    expect(confidenceBand(5)).toBe("green");
  });
});

describe("aggregateConfidence", () => {
  it("is the weakest field's confidence — a record is only as reliable as its worst field", () => {
    const result = aggregateConfidence(record([
      fieldResult({ confidence: 0.9 }),
      fieldResult({ key: "value", confidence: 0.4 }),
    ]));

    expect(result).toBe(0.4);
  });

  it("is zero for a record with no fields", () => {
    expect(aggregateConfidence(record([]))).toBe(0);
  });
});

describe("recordConfidenceBand", () => {
  it("bands the aggregate (weakest field) confidence", () => {
    const amberRecord = record([
      fieldResult({ confidence: 0.95 }),
      fieldResult({ key: "value", confidence: 0.6 }),
    ]);

    expect(recordConfidenceBand(amberRecord)).toBe("amber");
  });

  it("is red for an empty record", () => {
    expect(recordConfidenceBand(record([]))).toBe("red");
  });
});

describe("mergeFieldResults", () => {
  it("keeps the higher-confidence value when a key appears twice", () => {
    const existing = [fieldResult({ key: "price", value: "£10", confidence: 0.4 })];
    const incoming = [fieldResult({ key: "price", value: "£12", confidence: 0.9 })];
    expect(mergeFieldResults(existing, incoming)).toEqual([
      fieldResult({ key: "price", value: "£12", confidence: 0.9 }),
    ]);
  });

  it("does not let a weaker later value overwrite a stronger earlier one", () => {
    const existing = [fieldResult({ key: "price", value: "£12", confidence: 0.9 })];
    const incoming = [fieldResult({ key: "price", value: "£10", confidence: 0.4 })];
    expect(mergeFieldResults(existing, incoming)[0]?.value).toBe("£12");
  });

  it("adds keys not yet present", () => {
    const existing = [fieldResult({ key: "price", confidence: 0.9 })];
    const incoming = [fieldResult({ key: "delivery", value: "30 days", confidence: 0.7 })];
    const merged = mergeFieldResults(existing, incoming);
    expect(merged.map((field) => field.key).sort()).toEqual(["delivery", "price"]);
  });
});

describe("applyFieldEdit", () => {
  it("replaces the value and marks the field human-verified (no AI re-run)", () => {
    const original = record([
      fieldResult({ key: "supplier_name", value: "Acme", confidence: 0.4, rationale: "Guessed." }),
    ]);

    const result = applyFieldEdit(original, "supplier_name", "Acme Ltd", "Dana Ops");
    expect(result.error).toBeUndefined();
    const edited = result.data!.record.fields[0]!;
    expect(edited.value).toBe("Acme Ltd");
    // A human correction is authoritative, so the field bands green.
    expect(edited.confidence).toBe(1);
    expect(edited.rationale).toContain("Dana Ops");
  });

  it("returns the before/after change for the audit trail", () => {
    const original = record([fieldResult({ key: "price", value: "£10" })]);
    const result = applyFieldEdit(original, "price", "£12", "Dana Ops");
    expect(result.data!.change).toEqual({ key: "price", previousValue: "£10", newValue: "£12" });
  });

  it("does not mutate the original record", () => {
    const original = record([fieldResult({ key: "price", value: "£10" })]);
    applyFieldEdit(original, "price", "£12", "Dana Ops");
    expect(original.fields[0]!.value).toBe("£10");
  });

  it("fails when the field key is not on the record", () => {
    const original = record([fieldResult({ key: "price" })]);
    const result = applyFieldEdit(original, "missing", "x", "Dana Ops");
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("fieldCompleteness", () => {
  const recordWith = (id: string, fields: ExtractionFieldResult[]): ExtractionRecord => ({
    id,
    label: id,
    fields,
    sourceDocumentIds: [],
  });

  it("counts non-empty values per field key across records", () => {
    const records = [
      recordWith("r1", [fieldResult({ key: "price", value: "£10" }), fieldResult({ key: "term", value: "" })]),
      recordWith("r2", [fieldResult({ key: "price", value: "£20" }), fieldResult({ key: "term", value: "30d" })]),
    ];

    const result = fieldCompleteness(records, ["price", "term"]);
    expect(result.perField).toEqual([
      { key: "price", filled: 2, total: 2 },
      { key: "term", filled: 1, total: 2 },
    ]);
    expect(result.overallFilled).toBe(3);
    expect(result.overallTotal).toBe(4);
  });

  it("treats whitespace-only values as unfilled", () => {
    const records = [recordWith("r1", [fieldResult({ key: "price", value: "   " })])];
    expect(fieldCompleteness(records, ["price"]).perField[0]).toEqual({
      key: "price",
      filled: 0,
      total: 1,
    });
  });
});
