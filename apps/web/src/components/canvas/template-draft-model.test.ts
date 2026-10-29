import { describe, expect, it } from "vitest";
import type { DraftEvidence } from "@rbrasier/domain";
import type { AnnotationRow } from "@/lib/template-annotation";
import { toEditableRows } from "./template-annotation-model";
import {
  confirmRow,
  draftSaveBlockedReason,
  evidenceLabel,
  exampleProblems,
  replacedLabel,
  restoreRow,
} from "./template-draft-model";

const draftedRow = (overrides: Partial<AnnotationRow> = {}, evidence: DraftEvidence = { kind: "single-example" }) => ({
  key: "supplier_name",
  line: "Supplier Name",
  occurrences: [{ sourceText: "Acme Pty Ltd", occurrence: 0 }],
  locked: false,
  draft: {
    replacedValue: "Acme Pty Ltd",
    context: "Supplier Name: Acme Pty Ltd",
    insertAfter: false,
    evidence,
    confirmed: evidence.kind !== "checking-pass",
  },
  ...overrides,
});

describe("evidenceLabel", () => {
  it("says how many other examples differ", () => {
    expect(evidenceLabel({ kind: "varies", differsIn: 2, of: 3 })).toBe("Differs in 2 of 3 other examples");
  });

  it("names a single other example in the singular", () => {
    expect(evidenceLabel({ kind: "varies", differsIn: 1, of: 1 })).toBe("Differs in 1 of 1 other example");
  });

  it("explains each of the other kinds of evidence", () => {
    expect(evidenceLabel({ kind: "single-example" })).toBe("Only one example");
    expect(evidenceLabel({ kind: "blank-in-example" })).toBe("Blank in your example");
    expect(evidenceLabel({ kind: "checking-pass" })).toBe("Added by the checking pass");
    expect(evidenceLabel({ kind: "restored" })).toBe("Restored by you");
  });
});

describe("replacedLabel", () => {
  it("says what a value row replaces", () => {
    expect(replacedLabel(draftedRow().draft)).toBe("Replaces “Acme Pty Ltd”");
  });

  it("says a caption row goes after its caption", () => {
    const draft = { ...draftedRow().draft, replacedValue: "Equipment Type", insertAfter: true };
    expect(replacedLabel(draft)).toBe("Goes after “Equipment Type”");
  });
});

describe("draftSaveBlockedReason", () => {
  it("allows saving a set of confirmed drafted fields", () => {
    expect(draftSaveBlockedReason(toEditableRows([draftedRow()]))).toBeNull();
  });

  it("blocks saving until a checking-pass field is confirmed", () => {
    const rows = toEditableRows([draftedRow({}, { kind: "checking-pass" })]);
    expect(draftSaveBlockedReason(rows)).toBe("Confirm the fields the checking pass added before saving.");
    expect(draftSaveBlockedReason(confirmRow(rows, rows[0]!.id))).toBeNull();
  });

  it("does not ask to confirm a checking-pass field the author removed", () => {
    const rows = toEditableRows([draftedRow(), draftedRow({ key: "ref", line: "" }, { kind: "checking-pass" })]);
    expect(draftSaveBlockedReason(rows)).toBeNull();
  });

  it("treats a removed drafted field as a rejection, not an error", () => {
    const rows = toEditableRows([draftedRow(), draftedRow({ key: "ref", line: "" })]);
    expect(draftSaveBlockedReason(rows)).toBeNull();
  });

  it("still needs one field to save", () => {
    expect(draftSaveBlockedReason(toEditableRows([draftedRow({ line: "" })]))).toBe(
      "Add at least one field before saving.",
    );
  });
});

describe("restoreRow", () => {
  it("moves a same-in-every-example field into the grid, marked as restored", () => {
    const rows = toEditableRows([draftedRow()]);
    const [same] = toEditableRows([
      draftedRow({ key: "payment_terms", line: "Payment Terms" }, { kind: "varies", differsIn: 0, of: 2 }),
    ]);

    const result = restoreRow(rows, [same!], same!.id);

    expect(result.rows.map((row) => row.key)).toEqual(["supplier_name", "payment_terms"]);
    expect(result.rows[1]?.draft?.evidence).toEqual({ kind: "restored" });
    expect(result.rows[1]?.draft?.confirmed).toBe(true);
    expect(result.sameInEveryExample).toEqual([]);
  });

  it("keeps row ids unique after a restore", () => {
    const rows = toEditableRows([draftedRow()]);
    const same = toEditableRows([draftedRow()]);

    const result = restoreRow(rows, same, same[0]!.id);

    expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
  });
});

describe("exampleProblems", () => {
  const file = (name: string, size = 10) => ({ name, size });

  it("accepts Word documents within the limits", () => {
    expect(exampleProblems([file("a.docx"), file("b.DOCX")])).toEqual([]);
  });

  it("names each file that is not a Word document", () => {
    expect(exampleProblems([file("a.docx"), file("b.pdf")])).toEqual([
      { subject: "b.pdf", message: "Only Word (.docx) files can be used as examples." },
    ]);
  });

  it("names a file over the 10 MB limit", () => {
    expect(exampleProblems([file("big.docx", 11 * 1024 * 1024)])).toEqual([
      { subject: "big.docx", message: "Over the 10 MB limit." },
    ]);
  });

  it("refuses more than ten examples", () => {
    const files = Array.from({ length: 11 }, (_, index) => file(`${index}.docx`));
    expect(exampleProblems(files)).toEqual([
      { subject: "11 files", message: "Upload up to 10 examples at a time." },
    ]);
  });

  it("refuses examples that total more than 25 MB", () => {
    const nine = 9 * 1024 * 1024;
    expect(exampleProblems([file("a.docx", nine), file("b.docx", nine), file("c.docx", nine)])).toEqual([
      { subject: "3 files", message: "Together the examples are over 25 MB." },
    ]);
  });
});
