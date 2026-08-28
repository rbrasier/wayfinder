import { describe, expect, it } from "vitest";
import type { ExtractionFieldDraft, SchemaProposalFinding } from "@rbrasier/domain";
import {
  confirmState,
  fieldChanges,
  orderedFindings,
  revisionEntries,
} from "./schema-proposal-model";

const field = (
  label: string,
  overrides: Partial<ExtractionFieldDraft> = {},
): ExtractionFieldDraft => ({
  label,
  annotation: `${label} (text)`,
  instruction: `Pull the ${label.toLowerCase()}.`,
  doneWhen: null,
  ...overrides,
});

const blocking: SchemaProposalFinding = {
  severity: "blocking",
  fieldLabel: "Supplier",
  message: "Unknown annotation.",
};

const advisory: SchemaProposalFinding = {
  severity: "advisory",
  fieldLabel: "Summary",
  message: "Narrative fields compose prose.",
};

describe("fieldChanges", () => {
  it("marks an unchanged field unchanged", () => {
    const rows = fieldChanges([field("Supplier")], [field("Supplier")]);

    expect(rows).toEqual([
      expect.objectContaining({ label: "Supplier", change: "unchanged" }),
    ]);
  });

  it("marks a new field added", () => {
    const rows = fieldChanges([field("Supplier"), field("Value")], [field("Supplier")]);

    expect(rows.map((row) => row.change)).toEqual(["unchanged", "added"]);
  });

  it("marks a field whose annotation or instruction moved as changed", () => {
    const rows = fieldChanges(
      [field("Value", { annotation: "Value (currency)" })],
      [field("Value")],
    );

    expect(rows[0]!.change).toBe("changed");
  });

  it("notices a changed doneWhen, which neither of the other two fields shows", () => {
    const rows = fieldChanges(
      [field("Value", { doneWhen: "A number is present." })],
      [field("Value")],
    );

    expect(rows[0]!.change).toBe("changed");
  });

  it("lists a dropped field last as removed rather than letting it vanish", () => {
    const rows = fieldChanges([field("Supplier")], [field("Supplier"), field("Value")]);

    expect(rows.map((row) => [row.label, row.change])).toEqual([
      ["Supplier", "unchanged"],
      ["Value", "removed"],
    ]);
  });

  it("reads a rename as one addition and one removal", () => {
    const rows = fieldChanges([field("Supplier Name")], [field("Supplier")]);

    expect(rows.map((row) => [row.label, row.change])).toEqual([
      ["Supplier Name", "added"],
      ["Supplier", "removed"],
    ]);
  });

  it("treats every field of an opening proposal as added", () => {
    const rows = fieldChanges([field("Supplier"), field("Value")], []);

    expect(rows.every((row) => row.change === "added")).toBe(true);
  });
});

describe("confirmState", () => {
  it("enables confirm on a draft with no blocking finding", () => {
    expect(confirmState("draft", [advisory], false)).toEqual({ disabled: false, reason: null });
  });

  it("disables confirm while a blocking finding is open and says how many", () => {
    const one = confirmState("draft", [blocking], false);
    const two = confirmState("draft", [blocking, { ...blocking, message: "Another." }], false);

    expect(one.disabled).toBe(true);
    expect(one.reason).toContain("the problem");
    expect(two.reason).toContain("2 problems");
  });

  it("disables confirm on a confirmed proposal and says it is terminal", () => {
    const state = confirmState("confirmed", [], false);

    expect(state.disabled).toBe(true);
    expect(state.reason).toContain("Start a new one");
  });

  it("disables confirm while a turn is in flight, with no reason to explain", () => {
    expect(confirmState("draft", [], true)).toEqual({ disabled: true, reason: null });
  });

  it("keeps the terminal reason over the busy one, since busy will pass and terminal will not", () => {
    expect(confirmState("confirmed", [], true).reason).toContain("Start a new one");
  });
});

describe("orderedFindings", () => {
  it("puts blocking findings before advisory ones", () => {
    expect(orderedFindings([advisory, blocking])).toEqual([blocking, advisory]);
  });

  it("keeps every finding", () => {
    expect(orderedFindings([advisory, blocking, advisory])).toHaveLength(3);
  });
});

describe("revisionEntries", () => {
  it("numbers revisions from one and lists the newest first", () => {
    const entries = revisionEntries([
      { request: "Draft it", note: "Opening set." },
      { request: "Add value", note: "Added the value." },
    ]);

    expect(entries.map((entry) => entry.index)).toEqual([2, 1]);
    expect(entries[0]!.isCurrent).toBe(true);
    expect(entries[1]!.isCurrent).toBe(false);
  });

  it("marks the only revision of an opening proposal current", () => {
    const entries = revisionEntries([{ request: "Draft it", note: "Opening set." }]);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.isCurrent).toBe(true);
  });
});
