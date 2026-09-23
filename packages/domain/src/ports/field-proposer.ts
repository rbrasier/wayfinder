import type { ExtractionFieldDraft } from "../entities/extraction-schema";
import type { Result } from "../result";

// One input document offered to the proposer: its filename, so the proposal can
// name where a field came from, and its extracted text. A document the extractor
// could not read never reaches here — it is counted as unreadable instead.
export interface ProposalDocument {
  filename: string;
  text: string;
}

export interface FieldProposalRequest {
  documents: ProposalDocument[];
  // The author's own words about what these documents are, when they have
  // written any. Empty on the default path, where the whole point is that the
  // author has said nothing yet.
  guidance: string;
  // Fields already in the draft. The proposer is told about them so it proposes
  // what is missing rather than restating what is there; the merge drops any
  // duplicate it returns regardless (ADR-059 §3).
  existingLabels: string[];
}

// Proposes an extraction field set from the documents themselves (ADR-059).
// Mirrors ISeedProposer: propose, validate against the declared field model,
// report rejects rather than materialise. The drafts come back in the pre-parse
// author shape, so a proposed field and a hand-typed one reach the schema by the
// same buildExtractionField path and are indistinguishable afterwards.
export interface IFieldProposer {
  propose(request: FieldProposalRequest): Promise<Result<ExtractionFieldDraft[]>>;
}
