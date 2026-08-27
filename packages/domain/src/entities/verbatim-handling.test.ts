import { describe, expect, it } from "vitest";
import {
  classifyToolValueProvenance,
  verbatimTransformViolations,
} from "./verbatim-handling";
import type { TemplateField } from "./template-field";

const field = (overrides: Partial<TemplateField> = {}): TemplateField => ({
  key: "output",
  label: "Output",
  type: "text",
  optional: false,
  raw: "{{output}}",
  ...overrides,
});

describe("classifyToolValueProvenance", () => {
  const received = "  AC-100 \n";

  it("calls a value verbatim when it is byte-identical to what was received", () => {
    expect(classifyToolValueProvenance(received, received)).toBe("verbatim");
  });

  it("calls whitespace-normalised output processed", () => {
    expect(classifyToolValueProvenance(received, received.trim())).toBe("processed");
  });

  it("calls truncated output processed", () => {
    expect(classifyToolValueProvenance(received, received.slice(0, 4))).toBe("processed");
  });

  it("calls a byte-identical scalar selected from a JSON result verbatim", () => {
    const json = JSON.stringify({ rate: "4.25", meta: { code: "AC-100" } });
    expect(classifyToolValueProvenance(json, "4.25")).toBe("verbatim");
    expect(classifyToolValueProvenance(json, "AC-100")).toBe("verbatim");
  });

  it("calls a reworded value processed even when the source was JSON", () => {
    const json = JSON.stringify({ rate: "4.25" });
    expect(classifyToolValueProvenance(json, "4.25%")).toBe("processed");
  });

  it("calls a value assembled from two JSON leaves processed", () => {
    const json = JSON.stringify({ first: "Ada", last: "Lovelace" });
    expect(classifyToolValueProvenance(json, "Ada Lovelace")).toBe("processed");
  });
});

describe("verbatimTransformViolations", () => {
  it("permits a plain text pass-through of the tool result", () => {
    expect(verbatimTransformViolations([field()])).toEqual([]);
  });

  it("permits a narrative pass-through", () => {
    expect(verbatimTransformViolations([field({ type: "narrative" })])).toEqual([]);
  });

  it("refuses a typed field, which reshapes the received bytes", () => {
    const violations = verbatimTransformViolations([field({ key: "rate", type: "currency" })]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("rate");
    expect(violations[0]).toContain("currency");
  });

  it("refuses a field constrained to options, which substitutes a permitted value", () => {
    const violations = verbatimTransformViolations([
      field({ key: "status", options: ["Open", "Closed"] }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("status");
  });

  it("names every offending field rather than stopping at the first", () => {
    const violations = verbatimTransformViolations([
      field({ key: "rate", type: "number" }),
      field({ key: "due", type: "date" }),
      field(),
    ]);
    expect(violations).toHaveLength(2);
  });

  it("permits a step that declares no response fields at all", () => {
    expect(verbatimTransformViolations([])).toEqual([]);
  });
});
