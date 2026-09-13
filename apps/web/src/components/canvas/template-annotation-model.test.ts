import { describe, it, expect } from "vitest";
import { lineToModel } from "./field-row-model";
import {
  canSave,
  duplicateCounts,
  rowTypeLabel,
  saveBlockedReason,
  toEditableRows,
  signatureLabelsIn,
  validateRow,
  type EditableRow,
} from "./template-annotation-model";

const row = (overrides: Partial<EditableRow> = {}): EditableRow => {
  const merged = {
    id: "row-1",
    key: "supplier_name",
    line: "Supplier Name (text)",
    occurrences: [{ sourceText: "{{ Supplier Name }}", occurrence: 0 }],
    locked: false,
    ...overrides,
  };
  // Keep the model in step with whatever line the test set, unless it supplied
  // its own — mirrors how the modal holds model and line together.
  return { ...merged, model: overrides.model ?? lineToModel(merged.line) };
};

describe("validateRow", () => {
  it("passes a well-formed row", () => {
    expect(validateRow(row(), []).blocking).toEqual([]);
  });

  it("blocks an unknown type", () => {
    expect(validateRow(row({ line: "Supplier Name (telephone)" }), []).blocking).toHaveLength(1);
  });

  it("blocks an empty enum", () => {
    expect(validateRow(row({ line: "Status (options: )" }), []).blocking).toHaveLength(1);
  });

  it("warns with a correction for a misspelled modifier", () => {
    const validation = validateRow(row({ line: "Status (optoins: A, B)" }), []);
    expect(validation.blocking).toEqual([]);
    expect(validation.warnings[0]?.correctedLine).toBe("Status (options: A, B)");
  });

  it("never blocks on a locked section row", () => {
    // A section's raw open tag is not a Label (annotations) line, so parsing it
    // as one would flag a construct the author cannot edit here anyway.
    expect(validateRow(row({ locked: true, line: "#Pricing" }), []).blocking).toEqual([]);
  });

  it("does not flag an empty row", () => {
    expect(validateRow(row({ line: "" }), []).blocking).toEqual([]);
  });
});

describe("duplicateCounts", () => {
  it("counts a label used by more than one row", () => {
    const counts = duplicateCounts([
      row({ id: "a", line: "Supplier Name (text)" }),
      row({ id: "b", line: "Supplier Name (text)" }),
      row({ id: "c", line: "Amount (currency)" }),
    ]);
    expect(counts.get("supplier_name")).toBe(2);
    expect(counts.has("amount")).toBe(false);
  });

  it("counts one row that fills several places in the document", () => {
    const counts = duplicateCounts([
      row({
        occurrences: [
          { sourceText: "{{ Supplier Name }}", occurrence: 0 },
          { sourceText: "{{ Supplier Name }}", occurrence: 1 },
          { sourceText: "{{ Supplier Name }}", occurrence: 2 },
        ],
      }),
    ]);
    expect(counts.get("supplier_name")).toBe(3);
  });

  it("ignores locked rows", () => {
    expect(duplicateCounts([row({ locked: true }), row({ id: "b", locked: true })]).size).toBe(0);
  });
});

describe("canSave", () => {
  it("allows a clean single-field set", () => {
    expect(canSave([row()])).toBe(true);
  });

  it("blocks while any row has a blocking error", () => {
    expect(canSave([row(), row({ id: "b", line: "X (telephone)" })])).toBe(false);
  });

  it("blocks a field set with nothing in it", () => {
    expect(canSave([row({ line: "  " })])).toBe(false);
  });

  it("blocks a set containing only locked rows, which capture nothing", () => {
    expect(canSave([row({ locked: true, line: "#Pricing" })])).toBe(false);
  });

  it("allows a set where one placeholder was removed but others remain", () => {
    expect(canSave([row(), row({ id: "b", line: "" })])).toBe(true);
  });
});

describe("saveBlockedReason", () => {
  it("names the validation problem first", () => {
    const reason = saveBlockedReason([row({ line: "X (telephone)" }), row({ id: "b" })]);
    expect(reason).toMatch(/fix/i);
  });

  it("names the empty field set", () => {
    expect(saveBlockedReason([row({ line: "" })])).toMatch(/at least one/i);
  });

  it("is null when saving is allowed", () => {
    expect(saveBlockedReason([row()])).toBeNull();
  });
});

describe("toEditableRows", () => {
  it("gives every row a stable id", () => {
    const rows = toEditableRows([
      { ...row(), id: undefined } as never,
      { ...row(), key: "amount", id: undefined } as never,
    ]);
    expect(new Set(rows.map((entry) => entry.id)).size).toBe(2);
  });

  it("seeds each row's model from its line", () => {
    const rows = toEditableRows([{ ...row({ line: "Contract Value (currency)" }) } as never]);
    expect(rows[0]?.model.type).toBe("currency");
  });

  it("recovers a multi-select from a serialised multi-options line", () => {
    const rows = toEditableRows([
      { ...row({ line: "Equipment Type (multi-options: Mobile phone, Laptop)" }) } as never,
    ]);
    expect(rows[0]?.model.type).toBe("multiselect");
    expect(rows[0]?.model.options).toEqual(["Mobile phone", "Laptop"]);
  });
});

describe("rowTypeLabel", () => {
  it("names the row's field type for the found-fields list", () => {
    expect(rowTypeLabel(row({ line: "Start Date (date)" }))).toBe("Date");
    expect(rowTypeLabel(row({ model: { ...row().model, type: "multiselect" } }))).toBe(
      "Multi-select",
    );
  });
});

// The pairing is a cross-row rule — the comment is on one row and the signature
// it names on another — so it is checked here rather than line by line, and
// checked in the editor at all so the author is not told at save time.
describe("approval comment binding", () => {
  const signature = (label: string) =>
    row({ id: `sig-${label}`, key: label, line: `${label} (approval)` });
  const comment = (line: string) => row({ id: "note", key: "note", line });

  it("lists the signatures a comment can be pointed at", () => {
    const rows = [signature("Delegate Signature"), signature("Finance Signature"), comment("Note (approval-comment)")];

    expect(signatureLabelsIn(rows)).toEqual(["Delegate Signature", "Finance Signature"]);
  });

  it("accepts an unnamed comment when the template has exactly one signature", () => {
    const rows = [signature("Delegate Signature"), comment("Note (approval-comment)")];

    expect(validateRow(rows[1]!, rows).blocking).toEqual([]);
    expect(canSave(rows)).toBe(true);
  });

  it("blocks an unnamed comment when the template has several signatures", () => {
    const rows = [
      signature("Delegate Signature"),
      signature("Finance Signature"),
      comment("Note (approval-comment)"),
    ];

    expect(validateRow(rows[2]!, rows).blocking).toHaveLength(1);
    expect(saveBlockedReason(rows)).not.toBeNull();
  });

  it("blocks a comment when the template has no signature at all", () => {
    const rows = [row(), comment("Note (approval-comment)")];

    expect(validateRow(rows[1]!, rows).blocking).toHaveLength(1);
  });

  it("blocks a comment naming a signature the template does not have", () => {
    const rows = [signature("Delegate Signature"), comment("Note (approval-comment: Legal Signature)")];

    expect(validateRow(rows[1]!, rows).blocking).toHaveLength(1);
  });

  it("accepts a comment naming a signature the template has", () => {
    const rows = [
      signature("Delegate Signature"),
      signature("Finance Signature"),
      comment("Note (approval-comment: Finance Signature)"),
    ];

    expect(validateRow(rows[2]!, rows).blocking).toEqual([]);
  });
});
