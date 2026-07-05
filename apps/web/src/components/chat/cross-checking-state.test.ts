import { describe, expect, it } from "vitest";
import { resolveCrossCheckingState } from "./cross-checking-state";

describe("resolveCrossCheckingState", () => {
  it("is inactive with no annotations", () => {
    expect(resolveCrossCheckingState(undefined)).toEqual({ active: false, documents: [] });
    expect(resolveCrossCheckingState([])).toEqual({ active: false, documents: [] });
  });

  it("is active while the only cross-checking annotation says active", () => {
    const state = resolveCrossCheckingState([
      { type: "confidence", score: 100 },
      { type: "cross-checking", active: true, documents: ["Recruitment Policy", "Handbook"] },
    ]);
    expect(state.active).toBe(true);
    expect(state.documents).toEqual(["Recruitment Policy", "Handbook"]);
  });

  it("clears when a later annotation turns it off (latest wins)", () => {
    // The route writes active:true before the gate and active:false after, both
    // onto the same streaming message. The badge must follow the most recent.
    const state = resolveCrossCheckingState([
      { type: "cross-checking", active: true, documents: ["Recruitment Policy"] },
      { type: "cross-checking", active: false },
    ]);
    expect(state.active).toBe(false);
  });

  it("treats a missing active flag as active (legacy annotation)", () => {
    const state = resolveCrossCheckingState([{ type: "cross-checking" }]);
    expect(state.active).toBe(true);
    expect(state.documents).toEqual([]);
  });

  it("ignores non-string document entries", () => {
    const state = resolveCrossCheckingState([
      { type: "cross-checking", active: true, documents: ["Policy", 42, null] },
    ]);
    expect(state.documents).toEqual(["Policy"]);
  });
});
