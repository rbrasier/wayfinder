import { describe, expect, it } from "vitest";
import type { ExtractionFieldDraft } from "@wayfinder/domain";
import { mergeProposedFields } from "./merge-proposed-fields";

const draft = (label: string, instruction = "Pull it."): ExtractionFieldDraft => ({
  label,
  annotation: `${label} (text)`,
  instruction,
  doneWhen: null,
});

describe("mergeProposedFields", () => {
  it("appends proposed fields to an empty set, in the order proposed", () => {
    const merged = mergeProposedFields([], [draft("Supplier Name"), draft("Submission Date")]);

    expect(merged.map((field) => field.label)).toEqual(["Supplier Name", "Submission Date"]);
  });

  it("appends proposed fields after the author's existing ones", () => {
    const existing = [draft("Contract Value")];
    const merged = mergeProposedFields(existing, [draft("Supplier Name")]);

    expect(merged.map((field) => field.label)).toEqual(["Contract Value", "Supplier Name"]);
  });

  it("drops a proposal whose derived key collides with an existing field", () => {
    const existing = [draft("Supplier Name", "The author's own wording.")];
    const merged = mergeProposedFields(existing, [draft("Supplier Name", "The AI's wording.")]);

    expect(merged).toHaveLength(1);
    expect(merged[0].instruction).toBe("The author's own wording.");
  });

  it("treats labels differing only in case or punctuation as the same field", () => {
    const existing = [draft("Supplier Name")];
    const merged = mergeProposedFields(existing, [draft("supplier   name"), draft("Supplier-Name")]);

    expect(merged).toHaveLength(1);
  });

  it("never modifies an existing field, even when the proposal offers a better instruction", () => {
    const existing = [draft("Supplier Name", "supplier")];
    const merged = mergeProposedFields(existing, [
      draft("Supplier Name", "The supplier's full registered legal name, from the cover page."),
    ]);

    expect(merged[0].instruction).toBe("supplier");
  });

  it("makes no change when every proposed field is a duplicate, and does not error", () => {
    const existing = [draft("Supplier Name"), draft("Submission Date")];
    const merged = mergeProposedFields(existing, [draft("Supplier Name"), draft("Submission Date")]);

    expect(merged).toEqual(existing);
  });

  it("drops a proposal that duplicates an earlier proposal in the same batch", () => {
    const merged = mergeProposedFields([], [draft("Supplier Name"), draft("Supplier name")]);

    expect(merged).toHaveLength(1);
  });

  it("drops a proposed field with a blank label rather than deriving a placeholder key", () => {
    const merged = mergeProposedFields([], [draft("Supplier Name"), draft("   ")]);

    expect(merged.map((field) => field.label)).toEqual(["Supplier Name"]);
  });

  it("returns a new array and mutates neither input", () => {
    const existing = [draft("Contract Value")];
    const proposed = [draft("Supplier Name")];

    const merged = mergeProposedFields(existing, proposed);

    expect(merged).not.toBe(existing);
    expect(existing).toHaveLength(1);
    expect(proposed).toHaveLength(1);
  });

  it("returns the existing set unchanged when nothing is proposed", () => {
    const existing = [draft("Contract Value")];

    expect(mergeProposedFields(existing, [])).toEqual(existing);
  });
});
