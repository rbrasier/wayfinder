import { describe, expect, it } from "vitest";
import {
  appendProposalRevision,
  confirmProposal,
  currentProposalFields,
  currentProposalOutputInstruction,
  hasBlockingFinding,
  startSchemaProposal,
  type SchemaProposalFinding,
  type SchemaProposalRevision,
} from "./schema-proposal";
import type { ExtractionFieldDraft } from "./extraction-schema";

const draft = (label: string, annotation = `${label} (text)`): ExtractionFieldDraft => ({
  label,
  annotation,
  instruction: `Pull the ${label.toLowerCase()}.`,
  doneWhen: null,
});

const revision = (
  fields: ExtractionFieldDraft[],
  request = "Draft a schema",
  note = "Proposed a starting set.",
  outputInstruction = "One row per supplier.",
): SchemaProposalRevision => ({ fields, outputInstruction, request, note });

const blocking: SchemaProposalFinding = {
  severity: "blocking",
  fieldLabel: "Supplier",
  message: "Two fields resolve to the same key.",
};

const advisory: SchemaProposalFinding = {
  severity: "advisory",
  fieldLabel: "Summary",
  message: "A narrative field composes prose rather than copying it.",
};

describe("startSchemaProposal", () => {
  it("opens in draft with the opening revision as its only history", () => {
    const proposal = startSchemaProposal(revision([draft("Supplier")]));

    expect(proposal.status).toBe("draft");
    expect(proposal.revisions).toHaveLength(1);
  });

  it("reads the current field set from the opening revision", () => {
    const proposal = startSchemaProposal(revision([draft("Supplier"), draft("Value")]));

    expect(currentProposalFields(proposal).map((field) => field.label)).toEqual([
      "Supplier",
      "Value",
    ]);
  });
});

describe("currentProposalOutputInstruction", () => {
  it("reads the newest revision's drafted output instructions", () => {
    const first = startSchemaProposal(
      revision([draft("Supplier")], "Draft a schema", "Opened.", "One row per file."),
    );
    const second = appendProposalRevision(
      first,
      revision([draft("Supplier")], "Add the value", "Added.", "One row per supplier, by value."),
    );

    expect(currentProposalOutputInstruction(first)).toBe("One row per file.");
    expect(currentProposalOutputInstruction(second.data!)).toBe(
      "One row per supplier, by value.",
    );
  });
});

describe("appendProposalRevision", () => {
  it("preserves earlier revisions in order and makes the newest current", () => {
    const first = startSchemaProposal(revision([draft("Supplier")]));
    const second = appendProposalRevision(first, revision([draft("Supplier"), draft("Value")]));

    expect(second.error).toBeUndefined();
    expect(second.data!.revisions).toHaveLength(2);
    expect(second.data!.revisions[0]!.fields.map((field) => field.label)).toEqual(["Supplier"]);
    expect(currentProposalFields(second.data!).map((field) => field.label)).toEqual([
      "Supplier",
      "Value",
    ]);
  });

  it("leaves the proposal it was given untouched", () => {
    const first = startSchemaProposal(revision([draft("Supplier")]));
    appendProposalRevision(first, revision([draft("Supplier"), draft("Value")]));

    expect(first.revisions).toHaveLength(1);
  });

  it("refuses to refine a confirmed proposal", () => {
    const proposal = startSchemaProposal(revision([draft("Supplier")]));
    const confirmed = confirmProposal(proposal, []);
    const refined = appendProposalRevision(confirmed.data!, revision([draft("Value")]));

    expect(refined.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("confirmProposal", () => {
  it("confirms a draft with no blocking finding", () => {
    const proposal = startSchemaProposal(revision([draft("Supplier")]));

    const confirmed = confirmProposal(proposal, [advisory]);

    expect(confirmed.error).toBeUndefined();
    expect(confirmed.data!.status).toBe("confirmed");
  });

  it("refuses confirmation while a blocking finding is open", () => {
    const proposal = startSchemaProposal(revision([draft("Supplier")]));

    const confirmed = confirmProposal(proposal, [advisory, blocking]);

    expect(confirmed.error?.code).toBe("VALIDATION_FAILED");
    expect(confirmed.error?.message).toContain("Two fields resolve to the same key.");
  });

  it("is terminal — a second confirm is refused rather than re-materialising", () => {
    // The whole reason the status exists: a second confirm would write the
    // proposal's fields over a set the author may have hand-edited since.
    const proposal = startSchemaProposal(revision([draft("Supplier")]));
    const once = confirmProposal(proposal, []);

    const twice = confirmProposal(once.data!, []);

    expect(twice.error?.code).toBe("VALIDATION_FAILED");
    expect(twice.error?.message).toContain("already been confirmed");
  });

  it("keeps the full revision history on the confirmed proposal", () => {
    const first = startSchemaProposal(revision([draft("Supplier")]));
    const second = appendProposalRevision(first, revision([draft("Supplier"), draft("Value")]));

    const confirmed = confirmProposal(second.data!, []);

    expect(confirmed.data!.revisions).toHaveLength(2);
  });
});

describe("hasBlockingFinding", () => {
  it("is false for an empty set and for advisories alone", () => {
    expect(hasBlockingFinding([])).toBe(false);
    expect(hasBlockingFinding([advisory])).toBe(false);
  });

  it("is true when any finding blocks", () => {
    expect(hasBlockingFinding([advisory, blocking])).toBe(true);
  });
});
