import {
  domainError,
  err,
  withBranchRule,
  type FlowEdge,
  type IFlowEdgeRepository,
  type Result,
} from "@wayfinder/domain";

export interface SetFlowEdgeBranchRuleInput {
  edgeId: string;
  // Null or blank clears the rule; the edge then falls back to the destination
  // step's own description when the model chooses a branch.
  rule: string | null;
}

export class SetFlowEdgeBranchRule {
  constructor(private readonly edges: IFlowEdgeRepository) {}

  async execute(input: SetFlowEdgeBranchRuleInput): Promise<Result<FlowEdge>> {
    const existing = await this.edges.findById(input.edgeId);
    if (existing.error) return existing;
    if (!existing.data) return err(domainError("NOT_FOUND", "Flow edge not found."));

    // Read-modify-write on the whole config rather than a targeted key update:
    // the edge may carry other authoring data, and only the domain helper knows
    // how a cleared rule is represented.
    return this.edges.updateConfig(
      input.edgeId,
      withBranchRule(existing.data.config, input.rule),
    );
  }
}
