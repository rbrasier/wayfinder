import { describe, expect, it } from "vitest";
import {
  aggregateConfidenceByKind,
  applyConfidenceFloor,
  applyFieldEdit,
  confidenceBand,
  EXTRACTION_CONFIDENCE_FLOOR,
  fieldCompleteness,
  mergeFieldResults,
  recordConfidenceBands,
  type ExtractionFieldResult,
  type ExtractionRecord,
} from "./extraction-record";
import { fieldConfidence, fieldProvenance } from "./field-provenance";

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

describe("applyConfidenceFloor", () => {
  it("keeps a value whose confidence is at or above the floor", () => {
    const result = applyConfidenceFloor(fieldResult({ confidence: EXTRACTION_CONFIDENCE_FLOOR }));
    expect(result.value).toBe("Acme Ltd");
    expect(result.confidence).toBe(EXTRACTION_CONFIDENCE_FLOOR);
  });

  it("discards a value below the floor, zeroing confidence and noting why", () => {
    const result = applyConfidenceFloor(fieldResult({ value: "$9,999", confidence: 0.1 }));
    expect(result.value).toBe("");
    expect(result.confidence).toBe(0);
    expect(result.rationale).toContain("threshold");
  });

  it("leaves an already-blank value untouched", () => {
    const blank = fieldResult({ value: "", confidence: 0, rationale: "absent" });
    expect(applyConfidenceFloor(blank)).toEqual(blank);
  });

  it("keeps a verbatim result's provenance when it blanks the value", () => {
    const discarded = applyConfidenceFloor(
      fieldResult({ value: "AC-100", confidence: 0.1, provenance: "verbatim" }),
    );
    expect(discarded.value).toBe("");
    expect(fieldProvenance(discarded)).toBe("verbatim");
  });
});

describe("ExtractionFieldResult provenance", () => {
  it("reads a historical result with no provenance as processed on the accuracy scale", () => {
    const historical = fieldResult({ confidence: 0.9 });
    expect(fieldConfidence(historical)).toEqual({
      value: 0.9,
      kind: "accuracy",
      provenance: "processed",
    });
  });

  it("carries a derivation and a source reference when one was recorded", () => {
    const derived = fieldResult({
      key: "total_ex_vat",
      value: "1200",
      provenance: "derived",
      derivation: { method: "unit_price × quantity", sourceKeys: ["unit_price", "quantity"] },
      sourceRef: { documentId: "doc-1", locator: "page 4, table 2" },
    });
    expect(derived.derivation?.sourceKeys).toEqual(["unit_price", "quantity"]);
    expect(derived.sourceRef?.locator).toBe("page 4, table 2");
  });
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

describe("aggregateConfidenceByKind", () => {
  it("reports an all-accuracy record on the accuracy scale and leaves selection absent", () => {
    const result = aggregateConfidenceByKind(record([
      fieldResult({ key: "supplier_name", confidence: 0.9 }),
      fieldResult({ key: "price", confidence: 0.4 }),
      fieldResult({ key: "term", confidence: 0.7 }),
    ]));
    // Byte-identical to the single number every historical record reported.
    expect(result).toEqual({ selection: null, accuracy: 0.4 });
  });

  it("reports an all-verbatim record on the selection scale and leaves accuracy absent", () => {
    const result = aggregateConfidenceByKind(record([
      fieldResult({ key: "rate", confidence: 0.6, provenance: "verbatim" }),
      fieldResult({ key: "code", confidence: 0.8, provenance: "verbatim" }),
    ]));
    expect(result).toEqual({ selection: 0.6, accuracy: null });
  });

  it("keeps each kind's own minimum on a mixed record, neither influencing the other", () => {
    const result = aggregateConfidenceByKind(record([
      fieldResult({ key: "rate", confidence: 0.3, provenance: "verbatim" }),
      fieldResult({ key: "summary", confidence: 0.9 }),
      fieldResult({ key: "total", confidence: 0.7, provenance: "derived" }),
    ]));
    expect(result).toEqual({ selection: 0.3, accuracy: 0.7 });
  });

  it("returns null for both kinds on an empty record — absent, not zero", () => {
    expect(aggregateConfidenceByKind(record([]))).toEqual({ selection: null, accuracy: null });
  });

  it("clamps a field confidence outside [0, 1] before aggregating", () => {
    const result = aggregateConfidenceByKind(record([fieldResult({ confidence: 1.5 })]));
    expect(result.accuracy).toBe(1);
  });
});

describe("recordConfidenceBands", () => {
  it("bands each kind separately", () => {
    const bands = recordConfidenceBands(record([
      fieldResult({ key: "rate", confidence: 0.9, provenance: "verbatim" }),
      fieldResult({ key: "summary", confidence: 0.6 }),
    ]));
    expect(bands).toEqual({ selection: "green", accuracy: "amber" });
  });

  it("leaves an absent kind as null rather than banding it red", () => {
    const bands = recordConfidenceBands(record([fieldResult({ confidence: 0.9 })]));
    expect(bands).toEqual({ selection: null, accuracy: "green" });
  });

  it("returns null for both kinds on an empty record", () => {
    expect(recordConfidenceBands(record([]))).toEqual({ selection: null, accuracy: null });
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

  it("never loses a human correction to a more confident model value", () => {
    const corrected = fieldResult({
      key: "price",
      value: "£12",
      confidence: 1,
      provenance: "human_corrected",
    });
    const model = fieldResult({ key: "price", value: "£10", confidence: 1 });
    expect(mergeFieldResults([corrected], [model])[0]).toEqual(corrected);
  });

  it("lets a human correction replace a model value it arrives after", () => {
    const model = fieldResult({ key: "price", value: "£10", confidence: 1 });
    const corrected = fieldResult({
      key: "price",
      value: "£12",
      confidence: 1,
      provenance: "human_corrected",
    });
    expect(mergeFieldResults([model], [corrected])[0]).toEqual(corrected);
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
    // A person typed it: recorded as provenance rather than as model certainty.
    expect(fieldProvenance(edited)).toBe("human_corrected");
  });

  it("drops a derivation and source reference the corrected value no longer has", () => {
    const original = record([
      fieldResult({
        key: "total_ex_vat",
        value: "1200",
        provenance: "derived",
        derivation: { method: "unit × quantity", sourceKeys: ["unit", "quantity"] },
        sourceRef: { documentId: "doc-1", locator: "page 4" },
      }),
    ]);

    const edited = applyFieldEdit(original, "total_ex_vat", "1350", "Dana Ops").data!.record.fields[0]!;

    // A person typed this value: it was not calculated from those fields and it
    // is not on that page, so neither claim may survive into the UI or an export.
    expect(edited.derivation).toBeUndefined();
    expect(edited.sourceRef).toBeUndefined();
    expect(fieldProvenance(edited)).toBe("human_corrected");
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
