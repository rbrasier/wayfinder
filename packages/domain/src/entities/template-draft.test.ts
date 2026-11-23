import { describe, expect, it } from "vitest";
import {
  applyTextEdits,
  captionBefore,
  contextAround,
  countExamplesLacking,
  countOccurrences,
  draftFieldToTemplateField,
  locateExactOccurrence,
  originalPositionOf,
  resolveCaptionAnchor,
  splitChoices,
  valueAfterCaption,
  type TemplateDraftField,
} from "./template-draft";

const draftField = (overrides: Partial<TemplateDraftField> = {}): TemplateDraftField => ({
  label: "Supplier Name",
  type: "text",
  options: [],
  multiple: false,
  sourceValue: "Acme Pty Ltd",
  occurrence: 0,
  ...overrides,
});

describe("countOccurrences", () => {
  it("counts non-overlapping copies of a value", () => {
    expect(countOccurrences("Acme, Acme and Acme", "Acme")).toBe(3);
  });

  it("counts nothing for an empty value", () => {
    expect(countOccurrences("anything", "")).toBe(0);
  });
});

describe("locateExactOccurrence", () => {
  const text = "Supplier: Acme\nBilled to Acme\nAcme";

  it("finds the first occurrence", () => {
    expect(locateExactOccurrence(text, "Acme", 0)).toBe(10);
  });

  it("finds a later occurrence the document really has", () => {
    expect(locateExactOccurrence(text, "Acme", 2)).toBe(text.lastIndexOf("Acme"));
  });

  it("returns null for an occurrence past the last copy", () => {
    expect(locateExactOccurrence(text, "Acme", 3)).toBeNull();
  });

  it("returns null for a value that is not in the document", () => {
    expect(locateExactOccurrence(text, "Globex", 0)).toBeNull();
  });

  // annotate() matches within one paragraph, so a value crossing a paragraph
  // break can never be placed and must not be addressable here either.
  it("returns null for a value that crosses a paragraph break", () => {
    expect(locateExactOccurrence(text, "Acme\nBilled", 0)).toBeNull();
  });

  it("returns null for a blank value", () => {
    expect(locateExactOccurrence(text, "   ", 0)).toBeNull();
  });
});

describe("countExamplesLacking", () => {
  it("counts zero when every other example contains the value", () => {
    expect(countExamplesLacking("Standard terms apply", ["Standard terms apply.", "x Standard terms apply"])).toBe(0);
  });

  it("counts the examples that do not contain the value", () => {
    expect(countExamplesLacking("Acme", ["Globex", "Initech", "Acme"])).toBe(2);
  });

  it("ignores differences in whitespace only", () => {
    expect(countExamplesLacking("Net  30\tdays", ["Payment Net 30 days"])).toBe(0);
  });

  it("treats a formatting difference as a different value", () => {
    expect(countExamplesLacking("$1,200.00", ["Total $1,200"])).toBe(1);
  });
});

// Word extracts one table cell per line, so a form's caption and the value
// someone typed arrive as consecutive lines. Ported from the removed
// SuggestTemplateFields anchoring (ed73b66).
describe("resolveCaptionAnchor", () => {
  const anchorFor = (documentText: string, label: string, sourceText: string, reserved: string[] = []) => {
    const position = documentText.indexOf(sourceText);
    return resolveCaptionAnchor({
      documentText,
      sourceText,
      position,
      label,
      reservedLabels: [label, ...reserved],
    });
  };

  it("leaves an anchor that already points at a value alone", () => {
    const anchor = anchorFor("Employee Name\nRichard Brasier", "Employee Name", "Richard Brasier");
    expect(anchor).toEqual({ sourceText: "Richard Brasier", occurrence: 0, position: 14, insertAfter: false });
  });

  it("moves an anchor on the caption onto the value on the next line", () => {
    const anchor = anchorFor("Employee Name\nRichard Brasier", "Employee Name", "Employee Name");
    expect(anchor.sourceText).toBe("Richard Brasier");
    expect(anchor.insertAfter).toBe(false);
  });

  it("moves an anchor onto a value sharing the caption's line", () => {
    const anchor = anchorFor("Supplier Name: Acme Pty Ltd", "Supplier Name", "Supplier Name:");
    expect(anchor.sourceText).toBe("Acme Pty Ltd");
    expect(anchor.position).toBe(15);
  });

  it("indexes the moved anchor by the value's own occurrence count", () => {
    const anchor = anchorFor(
      "Approved By\nJoe Bloggs\nRequested By\nJoe Bloggs",
      "Requested By",
      "Requested By",
    );
    expect(anchor.sourceText).toBe("Joe Bloggs");
    expect(anchor.occurrence).toBe(1);
  });

  it("goes after the caption when the example left the value blank", () => {
    const anchor = anchorFor("Equipment Type", "Equipment Type", "Equipment Type");
    expect(anchor).toEqual({ sourceText: "Equipment Type", occurrence: 0, position: 0, insertAfter: true });
  });

  it("never treats a run of prose as the value a caption introduces", () => {
    const anchor = anchorFor(`Note\n${"a".repeat(200)}`, "Note", "Note");
    expect(anchor.insertAfter).toBe(true);
  });

  it("does not move the anchor onto another field's caption", () => {
    const anchor = anchorFor("Equipment Type\nRequested By\nJoe Bloggs", "Equipment Type", "Equipment Type", [
      "Requested By",
    ]);
    expect(anchor.sourceText).toBe("Equipment Type");
    expect(anchor.insertAfter).toBe(true);
  });

  it("does not move the anchor onto text ending in a colon", () => {
    const anchor = anchorFor("Equipment Type\nDelivery address:", "Equipment Type", "Equipment Type");
    expect(anchor.insertAfter).toBe(true);
  });

  it("does not move the anchor onto text that already carries a tag", () => {
    const anchor = anchorFor("Equipment Type\n{{ Item }}", "Equipment Type", "Equipment Type");
    expect(anchor.insertAfter).toBe(true);
  });
});

describe("captionBefore", () => {
  it("reads the caption sharing the value's line", () => {
    const text = "Supplier Name: Acme Pty Ltd";
    expect(captionBefore(text, text.indexOf("Acme"))).toBe("Supplier Name");
  });

  it("reads the caption on the line before the value", () => {
    const text = "Equipment\nLaptop, Mobile phone";
    expect(captionBefore(text, text.indexOf("Laptop"))).toBe("Equipment");
  });

  it("returns null for the document's first line with nothing before it", () => {
    expect(captionBefore("Laptop", 0)).toBeNull();
  });
});

describe("valueAfterCaption", () => {
  it("reads the value the same caption introduces in another example", () => {
    expect(valueAfterCaption("Equipment", "Intro\nEquipment\nMonitor / Keyboard", [])).toBe("Monitor / Keyboard");
  });

  it("returns null when the caption is not in that example", () => {
    expect(valueAfterCaption("Equipment", "Something else entirely", [])).toBeNull();
  });

  it("ignores the caption's words inside a heading or sentence", () => {
    const text = "Equipment Request Form\nWe supply equipment quickly.\nEquipment\nHeadset";
    expect(valueAfterCaption("Equipment", text, [])).toBe("Headset");
  });

  it("reads a value after a separator on the caption's own line", () => {
    expect(valueAfterCaption("Equipment", "Equipment Request Form\nEquipment: Monitor", [])).toBe("Monitor");
  });
});

describe("splitChoices", () => {
  it("splits a comma or slash separated list into trimmed choices", () => {
    expect(splitChoices("Mobile phone, Laptop / Monitor")).toEqual(["Mobile phone", "Laptop", "Monitor"]);
  });
});

describe("contextAround", () => {
  it("returns the surrounding text, capped and trimmed", () => {
    const text = `${"x".repeat(300)} Acme ${"y".repeat(300)}`;
    const start = text.indexOf("Acme");
    const context = contextAround(text, start, start + 4, 40);
    expect(context.length).toBeLessThanOrEqual(42);
    expect(context).toContain("Acme");
  });

  it("stays within the value's own paragraph", () => {
    const text = "Previous line\nSupplier: Acme\nNext line";
    const start = text.indexOf("Acme");
    expect(contextAround(text, start, start + 4)).toBe("Supplier: Acme");
  });
});

describe("applyTextEdits", () => {
  it("rewrites each span and links it to its original position", () => {
    const text = "Supplier: Acme\nAmount: $5";
    const result = applyTextEdits(text, [
      { start: 10, end: 14, replacement: "{{ Supplier }}", fieldKey: "supplier" },
      { start: 23, end: 25, replacement: "{{ Amount (currency) }}", fieldKey: "amount" },
    ]);

    expect(result.text).toBe("Supplier: {{ Supplier }}\nAmount: {{ Amount (currency) }}");
    expect(result.links[1]).toEqual({
      fieldKey: "amount",
      originalStart: 23,
      originalEnd: 25,
      taggedStart: 33,
      taggedEnd: 56,
    });
  });

  it("applies edits given out of order", () => {
    const result = applyTextEdits("a b c", [
      { start: 4, end: 5, replacement: "C", fieldKey: "c" },
      { start: 0, end: 1, replacement: "A", fieldKey: "a" },
    ]);
    expect(result.text).toBe("A b C");
  });
});

describe("originalPositionOf", () => {
  const edited = applyTextEdits("Supplier: Acme\nRef 42", [
    { start: 10, end: 14, replacement: "{{ Supplier }}", fieldKey: "supplier" },
  ]);

  it("maps a position after an edit back to the original text", () => {
    const tagged = edited.text.indexOf("42");
    expect(originalPositionOf(edited.links, tagged)).toBe("Supplier: Acme\nRef 42".indexOf("42"));
  });

  it("returns null for a position inside a placed tag", () => {
    expect(originalPositionOf(edited.links, edited.text.indexOf("Supplier }}"))).toBeNull();
  });
});

describe("draftFieldToTemplateField", () => {
  it("builds a field whose line serialises its type", () => {
    const field = draftFieldToTemplateField(draftField({ label: "Contract Value", type: "currency" }));
    expect(field?.type).toBe("currency");
    expect(field?.key).toBe("contract_value");
  });

  it("carries options and multiplicity into a multi-select", () => {
    const field = draftFieldToTemplateField(
      draftField({ label: "Equipment", options: ["Laptop", "Mobile phone"], multiple: true }),
    );
    expect(field?.options).toEqual(["Laptop", "Mobile phone"]);
    expect(field?.multiple).toBe(true);
    expect(field?.type).toBe("text");
  });

  it("ignores the multiple flag when there are no options", () => {
    expect(draftFieldToTemplateField(draftField({ multiple: true }))?.multiple).toBeUndefined();
  });

  it("rejects a label that would produce a broken line", () => {
    expect(draftFieldToTemplateField(draftField({ label: "  " }))).toBeNull();
    expect(draftFieldToTemplateField(draftField({ label: "Name {{x}}" }))).toBeNull();
    expect(draftFieldToTemplateField(draftField({ label: "Name (text)" }))).toBeNull();
  });
});
