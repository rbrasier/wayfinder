import { describe, it, expect } from "vitest";
import { buildAnnotationEdits, rowsFromDocumentTags, rowsFromDraft, type DraftedFieldPayload } from "./template-annotation";

describe("rowsFromDocumentTags", () => {
  it("returns one row per tag, in document order", () => {
    const rows = rowsFromDocumentTags("Supplier: {{ Supplier Name }}\nValue: {{ Amount }}");
    expect(rows.map((row) => row.line)).toEqual(["Supplier Name", "Amount"]);
  });

  it("captures the exact literal so the annotator can match it", () => {
    const rows = rowsFromDocumentTags("Supplier: {{  Supplier Name  }}");
    expect(rows[0]?.occurrences[0]?.sourceText).toBe("{{  Supplier Name  }}");
  });

  it("collapses repeated uses of one field into a single row", () => {
    const rows = rowsFromDocumentTags(
      "{{ Supplier Name }} agrees. {{ Supplier Name }} will invoice.",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrences).toHaveLength(2);
  });

  it("indexes each repeated literal by its own occurrence", () => {
    const rows = rowsFromDocumentTags("{{ Name }} and {{ Name }}");
    expect(rows[0]?.occurrences.map((entry) => entry.occurrence)).toEqual([0, 1]);
  });

  it("preserves an annotated tag's existing annotations", () => {
    const rows = rowsFromDocumentTags("{{ Amount (currency) (optional) }}");
    expect(rows[0]?.line).toBe("Amount (currency) (optional)");
  });

  it("locks a section tag rather than offering it for editing", () => {
    const rows = rowsFromDocumentTags("{{#Pricing}} Rate: {{ Rate }} {{/Pricing}}");
    const pricing = rows.find((row) => row.line.includes("Pricing"));
    expect(pricing?.locked).toBe(true);
    expect(rows.find((row) => row.line === "Rate")?.locked).toBe(false);
  });

  it("keeps a close tag out of the row list, since it has no field of its own", () => {
    const rows = rowsFromDocumentTags("{{#Pricing}} x {{/Pricing}}");
    expect(rows).toHaveLength(1);
  });

  it("returns nothing for a document with no tags", () => {
    expect(rowsFromDocumentTags("Plain prose with no placeholders.")).toEqual([]);
  });

  it("keeps a malformed tag as a row so the author can fix it", () => {
    const rows = rowsFromDocumentTags("{{ Supplier (telephone) }}");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.line).toBe("Supplier (telephone)");
  });
});

describe("buildAnnotationEdits", () => {
  const tagRow = {
    key: "supplier_name",
    line: "Supplier Name (text)",
    occurrences: [{ sourceText: "{{ Supplier Name }}", occurrence: 0 }],
    locked: false,
  };

  it("wraps the edited line in braces", () => {
    const edits = buildAnnotationEdits([tagRow]);
    expect(edits).toEqual([
      { find: "{{ Supplier Name }}", occurrence: 0, replacement: "{{ Supplier Name (text) }}" },
    ]);
  });

  it("emits one edit per occurrence so every use of a field is updated", () => {
    const edits = buildAnnotationEdits([
      {
        ...tagRow,
        occurrences: [
          { sourceText: "{{ Supplier Name }}", occurrence: 0 },
          { sourceText: "{{ Supplier Name }}", occurrence: 1 },
        ],
      },
    ]);
    expect(edits).toHaveLength(2);
    expect(edits.map((edit) => edit.occurrence)).toEqual([0, 1]);
  });

  it("removes an existing tag whose field name the author cleared", () => {
    const edits = buildAnnotationEdits([{ ...tagRow, line: "   " }]);
    expect(edits[0]?.replacement).toBe("");
  });

  it("never rewrites a locked section row", () => {
    const edits = buildAnnotationEdits([
      { ...tagRow, locked: true, line: "#Pricing", occurrences: [{ sourceText: "{{#Pricing}}", occurrence: 0 }] },
    ]);
    expect(edits).toEqual([]);
  });

  it("rewrites an edited tag to the annotations the author chose", () => {
    const edits = buildAnnotationEdits([{ ...tagRow, line: "Contract Value (currency) (optional)" }]);
    expect(edits).toEqual([
      {
        find: "{{ Supplier Name }}",
        occurrence: 0,
        replacement: "{{ Contract Value (currency) (optional) }}",
      },
    ]);
  });

  it("skips an edit that would replace text with an identical tag", () => {
    const edits = buildAnnotationEdits([
      { ...tagRow, line: "Supplier Name", occurrences: [{ sourceText: "{{ Supplier Name }}", occurrence: 0 }] },
    ]);
    expect(edits).toEqual([]);
  });
});

describe("drafted rows", () => {
  const drafted = (overrides: Partial<DraftedFieldPayload> = {}): DraftedFieldPayload => ({
    field: { key: "supplier_name", label: "Supplier Name" },
    line: "Supplier Name",
    sourceText: "Acme Pty Ltd",
    occurrence: 0,
    insertAfter: false,
    replacedValue: "Acme Pty Ltd",
    context: "Supplier Name: Acme Pty Ltd",
    evidence: { kind: "single-example" },
    ...overrides,
  });

  it("points each row at the value it replaces", () => {
    const rows = rowsFromDraft([drafted()]);
    expect(rows[0]).toMatchObject({
      key: "supplier_name",
      line: "Supplier Name",
      occurrences: [{ sourceText: "Acme Pty Ltd", occurrence: 0 }],
      locked: false,
      draft: { replacedValue: "Acme Pty Ltd", insertAfter: false, confirmed: true },
    });
  });

  it("leaves a checking-pass row unconfirmed until the author confirms it", () => {
    const rows = rowsFromDraft([drafted({ evidence: { kind: "checking-pass" } })]);
    expect(rows[0]?.draft?.confirmed).toBe(false);
  });

  it("collapses two drafted places for one field into one row", () => {
    const rows = rowsFromDraft([drafted(), drafted({ occurrence: 1 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrences.map((entry) => entry.occurrence)).toEqual([0, 1]);
  });

  it("replaces a drafted value with its placeholder", () => {
    expect(buildAnnotationEdits(rowsFromDraft([drafted()]))).toEqual([
      { find: "Acme Pty Ltd", occurrence: 0, replacement: "{{ Supplier Name }}" },
    ]);
  });

  it("keeps the caption in front of a placeholder that goes after it", () => {
    const rows = rowsFromDraft([
      drafted({ sourceText: "Equipment Type", insertAfter: true, line: "Equipment Type", field: { key: "equipment_type", label: "Equipment Type" } }),
    ]);
    expect(buildAnnotationEdits(rows)).toEqual([
      { find: "Equipment Type", occurrence: 0, replacement: "Equipment Type {{ Equipment Type }}" },
    ]);
  });

  it("writes nothing for a cleared go-after row, so the caption is never deleted", () => {
    const rows = rowsFromDraft([drafted({ sourceText: "Equipment Type", insertAfter: true, line: "" })]);
    expect(buildAnnotationEdits(rows)).toEqual([]);
  });

  it("leaves a drafted value in place when the author cleared its row", () => {
    const rows = rowsFromDraft([drafted({ line: "" })]);
    expect(buildAnnotationEdits(rows)).toEqual([]);
  });
});
