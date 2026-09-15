import { describe, expect, it } from "vitest";
import { applySelection, removeSelection, splitSelection } from "./lookup-value-input";

describe("splitSelection", () => {
  it("reads a comma-separated multi-select value", () => {
    expect(splitSelection("Finance, Human Resources")).toEqual(["Finance", "Human Resources"]);
  });

  it("ignores blanks left by trailing separators", () => {
    expect(splitSelection("Finance, , ")).toEqual(["Finance"]);
  });

  it("reads an empty value as no selection", () => {
    expect(splitSelection("")).toEqual([]);
  });
});

describe("applySelection", () => {
  it("replaces the value for a single-value field", () => {
    expect(applySelection("Finance", "Legal", false)).toBe("Legal");
  });

  it("appends to a multi-select field", () => {
    expect(applySelection("Finance", "Legal", true)).toBe("Finance, Legal");
  });

  it("starts a multi-select field from empty", () => {
    expect(applySelection("", "Finance", true)).toBe("Finance");
  });

  it("ignores a repeat pick, whatever its casing", () => {
    expect(applySelection("Finance", "finance", true)).toBe("Finance");
  });
});

describe("removeSelection", () => {
  it("drops one value and keeps the rest", () => {
    expect(removeSelection("Finance, Legal, HR", "Legal")).toBe("Finance, HR");
  });

  it("matches regardless of casing", () => {
    expect(removeSelection("Finance, Legal", "legal")).toBe("Finance");
  });

  it("empties the value when the last selection goes", () => {
    expect(removeSelection("Finance", "Finance")).toBe("");
  });
});
