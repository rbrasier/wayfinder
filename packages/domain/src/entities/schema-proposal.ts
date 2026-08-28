import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import type { ExtractionFieldDraft } from "./extraction-schema";

// A proposal is thread-scoped scratchpad state and nothing else (ADR-052 §1).
// It has no table, no row, no repository and no place in the flow snapshot: it
// lives for the conversation it is being argued out in, and when that ends it is
// gone. Everything in this file is a pure transition over a value the caller
// holds — nothing here reads or writes storage, and nothing should be added that
// does.
export type SchemaProposalStatus = "draft" | "confirmed";

// One turn of the argument. `request` is what the human asked for and `note` is
// the proposer's own account of what it changed, so a reviewer can read how the
// field set arrived at its current state rather than only what it now says.
export interface SchemaProposalRevision {
  fields: ExtractionFieldDraft[];
  request: string;
  note: string;
}

export interface SchemaProposal {
  status: SchemaProposalStatus;
  // Oldest first, never empty — the opening proposal is revision one.
  revisions: SchemaProposalRevision[];
}

export type SchemaProposalFindingSeverity = "blocking" | "advisory";

// A coherence finding the field model can actually decide (ADR-052 §4).
// `fieldLabel` is null for a finding about the set rather than one field.
export interface SchemaProposalFinding {
  severity: SchemaProposalFindingSeverity;
  fieldLabel: string | null;
  message: string;
}

export const hasBlockingFinding = (findings: SchemaProposalFinding[]): boolean =>
  findings.some((finding) => finding.severity === "blocking");

export const startSchemaProposal = (opening: SchemaProposalRevision): SchemaProposal => ({
  status: "draft",
  revisions: [opening],
});

// The newest revision is the current state. Revisions are never empty, so this
// always has an answer.
export const currentProposalFields = (proposal: SchemaProposal): ExtractionFieldDraft[] =>
  proposal.revisions[proposal.revisions.length - 1]?.fields ?? [];

// Refinement appends rather than overwrites, so the history that makes the
// interaction reviewable stays readable (ADR-052 §5).
export const appendProposalRevision = (
  proposal: SchemaProposal,
  revision: SchemaProposalRevision,
): Result<SchemaProposal> => {
  if (proposal.status === "confirmed") {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "This schema proposal has already been confirmed. Start a new proposal to keep refining.",
      ),
    );
  }
  return ok({ status: proposal.status, revisions: [...proposal.revisions, revision] });
};

// `confirmed` is terminal (ADR-052 §3). The guard is not about storage — there
// is none — it is about a second confirm re-materialising the proposal's fields
// over a set the author may have hand-edited in the editor since the first one.
export const confirmProposal = (
  proposal: SchemaProposal,
  findings: SchemaProposalFinding[],
): Result<SchemaProposal> => {
  if (proposal.status === "confirmed") {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "This schema proposal has already been confirmed. Start a new proposal to propose again.",
      ),
    );
  }

  const blocking = findings.filter((finding) => finding.severity === "blocking");
  if (blocking.length > 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `This proposal cannot be confirmed yet: ${blocking.map((finding) => finding.message).join(" ")}`,
      ),
    );
  }

  return ok({ status: "confirmed", revisions: proposal.revisions });
};
