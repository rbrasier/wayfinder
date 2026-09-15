import { describe, expect, it } from "vitest";
import {
  confidenceKind,
  fieldConfidence,
  fieldProvenance,
  FIELD_PROVENANCES,
  type FieldProvenance,
} from "./field-provenance";

describe("fieldProvenance", () => {
  it("reads a result with no provenance member as processed", () => {
    expect(fieldProvenance({})).toBe("processed");
  });

  it("returns the stored provenance when one is present", () => {
    for (const provenance of FIELD_PROVENANCES) {
      expect(fieldProvenance({ provenance })).toBe(provenance);
    }
  });
});

describe("confidenceKind", () => {
  it("maps verbatim to selection", () => {
    expect(confidenceKind("verbatim")).toBe("selection");
  });

  it("maps every other provenance to accuracy", () => {
    const others: FieldProvenance[] = ["processed", "derived", "human_corrected"];
    for (const provenance of others) {
      expect(confidenceKind(provenance)).toBe("accuracy");
    }
  });
});

describe("fieldConfidence", () => {
  it("returns the value and its kind together for a verbatim result", () => {
    expect(fieldConfidence({ confidence: 0.7, provenance: "verbatim" })).toEqual({
      value: 0.7,
      kind: "selection",
      provenance: "verbatim",
    });
  });

  it("reads a historical result as an accuracy metric", () => {
    expect(fieldConfidence({ confidence: 0.42 })).toEqual({
      value: 0.42,
      kind: "accuracy",
      provenance: "processed",
    });
  });

  it("clamps a confidence outside [0, 1] so a reader never sees an impossible metric", () => {
    expect(fieldConfidence({ confidence: 1.4 }).value).toBe(1);
    expect(fieldConfidence({ confidence: -0.2 }).value).toBe(0);
  });

  it("reports a human correction as a correction, not as maximum model confidence", () => {
    const read = fieldConfidence({ confidence: 1, provenance: "human_corrected" });
    expect(read.provenance).toBe("human_corrected");
    expect(read.kind).toBe("accuracy");
  });
});
