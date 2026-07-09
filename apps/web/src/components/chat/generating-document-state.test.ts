import { describe, expect, it } from "vitest";
import { resolveGeneratingDocumentState } from "./generating-document-state";

describe("resolveGeneratingDocumentState", () => {
  it("is inactive with no annotations", () => {
    expect(resolveGeneratingDocumentState(undefined)).toEqual({ active: false });
    expect(resolveGeneratingDocumentState([])).toEqual({ active: false });
  });

  it("is active while the only generating-document annotation says active", () => {
    const state = resolveGeneratingDocumentState([
      { type: "confidence", score: 100 },
      { type: "generating-document", active: true },
    ]);
    expect(state.active).toBe(true);
  });

  it("clears when a later annotation turns it off (latest wins)", () => {
    // The route writes active:true before generation and active:false after, both
    // onto the same streaming message. The badge must follow the most recent.
    const state = resolveGeneratingDocumentState([
      { type: "generating-document", active: true },
      { type: "generating-document", active: false },
    ]);
    expect(state.active).toBe(false);
  });

  it("treats a missing active flag as active", () => {
    const state = resolveGeneratingDocumentState([{ type: "generating-document" }]);
    expect(state.active).toBe(true);
  });

  it("ignores unrelated annotations", () => {
    const state = resolveGeneratingDocumentState([
      { type: "cross-checking", active: true },
      { type: "confidence", score: 90 },
    ]);
    expect(state.active).toBe(false);
  });
});
