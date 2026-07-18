import { describe, it, expect } from "vitest";
import { computeGroupCompletenessNotes } from "./group-fields";
import { parseTemplateFields } from "./template-field";

const suppliersGroup = () =>
  parseTemplateFields([
    "#Suppliers (repeat)",
    "Name",
    "Pricing",
    "Notes (optional)",
    "/Suppliers",
  ]).data![0]!;

describe("computeGroupCompletenessNotes", () => {
  it("returns no notes when every item has its required sub-fields", () => {
    const notes = computeGroupCompletenessNotes(suppliersGroup(), [
      { name: "Acme", pricing: "£100", notes: "" },
      { name: "Globex", pricing: "£200", notes: "preferred" },
    ]);
    expect(notes).toEqual([]);
  });

  it("flags an empty array", () => {
    const notes = computeGroupCompletenessNotes(suppliersGroup(), []);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("No \"Suppliers\" items");
  });

  it("flags an item missing a required sub-field but ignores optional ones", () => {
    const notes = computeGroupCompletenessNotes(suppliersGroup(), [
      { name: "Acme", pricing: "£100", notes: "" },
      { name: "", pricing: "", notes: "" },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("item 2");
    expect(notes[0]).toContain("Name");
    expect(notes[0]).toContain("Pricing");
    expect(notes[0]).not.toContain("Notes");
  });

  it("returns no notes for a non-group field", () => {
    const field = parseTemplateFields(["Client Name"]).data![0]!;
    expect(computeGroupCompletenessNotes(field, [])).toEqual([]);
  });
});
