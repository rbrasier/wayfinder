import type { ExtractionFieldDraft } from "../entities/extraction-schema";
import type { Result } from "../result";

// One sample document the proposer may read to work out what fields the source
// material actually carries.
export interface SchemaProposalSample {
  filename: string;
  text: string;
}

// Both the opening proposal and every refinement turn are the same call. An
// opening proposal has an empty `currentFields`; a refinement passes the set as
// it stands plus what the author asked to change about it, so the proposer
// always sees the state it is amending rather than being asked to remember it.
export interface SchemaProposalRequest {
  flowName: string;
  // What the author says the schema needs to capture.
  intent: string;
  samples: SchemaProposalSample[];
  currentFields: ExtractionFieldDraft[];
  instruction: string;
  // Carried so the call is attributed and the generation budget caps apply, the
  // same way the extraction paths pass them.
  userId?: string | null;
  flowId?: string | null;
}

export interface SchemaProposalOutput {
  fields: ExtractionFieldDraft[];
  // The proposer's own account of what it changed, shown against the previous
  // revision so a reviewer can see the argument rather than only its result.
  note: string;
}

// Proposes an extraction field set from conversation context and sample data,
// mirroring `ISeedProposer`: propose, validate against the declared field model,
// report findings rather than materialise. The proposer emits the annotation
// language authors already write (`Label (date) (optional)`), so a proposal is
// reviewable as text and reuses the one parser (ADR-052 §2).
//
// There is deliberately no repository port beside this one. A proposal is never
// stored (ADR-052 §1).
export interface ISchemaProposer {
  propose(request: SchemaProposalRequest): Promise<Result<SchemaProposalOutput>>;
}
