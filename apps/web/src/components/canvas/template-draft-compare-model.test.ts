import { describe, expect, it } from "vitest";
import { buildComparison } from "./template-draft-compare-model";

const comparisonOf = (originalText: string, edits: { find: string; tag: string; fieldKey: string }[]) => {
  let taggedText = "";
  let cursor = 0;
  const links = [];
  for (const edit of edits) {
    const originalStart = originalText.indexOf(edit.find, cursor);
    taggedText += originalText.slice(cursor, originalStart);
    const taggedStart = taggedText.length;
    taggedText += edit.tag;
    links.push({
      fieldKey: edit.fieldKey,
      originalStart,
      originalEnd: originalStart + edit.find.length,
      taggedStart,
      taggedEnd: taggedText.length,
    });
    cursor = originalStart + edit.find.length;
  }
  taggedText += originalText.slice(cursor);
  return { originalText, taggedText, links };
};

describe("buildComparison", () => {
  it("pairs each original paragraph with its tagged counterpart", () => {
    const paragraphs = buildComparison(
      comparisonOf("Supply Agreement\nSupplier: Acme", [{ find: "Acme", tag: "{{ Supplier }}", fieldKey: "supplier" }]),
    );

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toEqual({
      changed: false,
      original: [{ text: "Supply Agreement", linkId: null }],
      tagged: [{ text: "Supply Agreement", linkId: null }],
    });
  });

  it("marks the value and its placeholder with the same link", () => {
    const [, supplier] = buildComparison(
      comparisonOf("Title\nSupplier: Acme today", [{ find: "Acme", tag: "{{ Supplier }}", fieldKey: "supplier" }]),
    );

    expect(supplier).toEqual({
      changed: true,
      original: [
        { text: "Supplier: ", linkId: null },
        { text: "Acme", linkId: 0 },
        { text: " today", linkId: null },
      ],
      tagged: [
        { text: "Supplier: ", linkId: null },
        { text: "{{ Supplier }}", linkId: 0 },
        { text: " today", linkId: null },
      ],
    });
  });

  it("keeps several placeholders in one paragraph apart", () => {
    const [paragraph] = buildComparison(
      comparisonOf("Acme owes $5", [
        { find: "Acme", tag: "{{ Supplier }}", fieldKey: "supplier" },
        { find: "$5", tag: "{{ Amount }}", fieldKey: "amount" },
      ]),
    );

    expect(paragraph?.tagged.map((segment) => segment.linkId)).toEqual([0, null, 1]);
  });

  it("returns nothing for an empty document", () => {
    expect(buildComparison({ originalText: "", taggedText: "", links: [] })).toEqual([]);
  });
});
