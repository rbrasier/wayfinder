import { describe, expect, it } from "vitest";
import {
  aggregateConfidence,
  confidenceBand,
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
