import type { FlowTestSeed } from "../entities/flow-test-fixture";
import type { TemplateField } from "../entities/template-field";
import type { Result } from "../result";

// One prior step the proposer is being asked to invent plausible values for.
export interface SeedProposalNode {
  nodeId: string;
  nodeName: string;
  // What the step is trying to achieve, so invented values are coherent with it
  // rather than merely type-correct.
  aiInstruction: string;
  fields: TemplateField[];
}

export interface SeedProposalRequest {
  flowName: string;
  nodes: SeedProposalNode[];
}

// Proposes prior-step data for a flow with no real sessions to clone — the
// "brand-new flow" case in the PRD's user story 5. The proposal is validated
// against the declared field types before anything is materialised, so a
// proposer that invents a key or breaks a constraint produces a reported reject
// rather than a test that quietly measures the wrong thing.
export interface ISeedProposer {
  propose(request: SeedProposalRequest): Promise<Result<FlowTestSeed>>;
}
