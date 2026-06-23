import { describe, expect, it } from "vitest";
import { normaliseAdvanceConfidenceThreshold } from "./confidence-threshold";

describe("normaliseAdvanceConfidenceThreshold", () => {
  it("returns the default 90 when undefined", () => {
    expect(normaliseAdvanceConfidenceThreshold(undefined)).toBe(90);
  });

  it("returns the default 90 when the value is not a finite number", () => {
    expect(normaliseAdvanceConfidenceThreshold(Number.NaN)).toBe(90);
    expect(normaliseAdvanceConfidenceThreshold(Number.POSITIVE_INFINITY)).toBe(90);
  });

  it("treats a value in (0, 1] as a fraction and scales it to 0-100", () => {
    expect(normaliseAdvanceConfidenceThreshold(0.7)).toBe(70);
    expect(normaliseAdvanceConfidenceThreshold(0.75)).toBe(75);
    // 1 is the fractional whole — 100%, not 1%.
    expect(normaliseAdvanceConfidenceThreshold(1)).toBe(100);
  });

  it("keeps a value already on the 0-100 scale", () => {
    expect(normaliseAdvanceConfidenceThreshold(70)).toBe(70);
    expect(normaliseAdvanceConfidenceThreshold(90)).toBe(90);
  });

  it("clamps out-of-range values into 0-100", () => {
    expect(normaliseAdvanceConfidenceThreshold(150)).toBe(100);
    expect(normaliseAdvanceConfidenceThreshold(-5)).toBe(0);
  });

  it("treats zero as zero (always advance) rather than the default", () => {
    expect(normaliseAdvanceConfidenceThreshold(0)).toBe(0);
  });
});
