import type { FlowEdge, IFlowEdgeRepository, NewFlowEdge, Result } from "@rbrasier/domain";

export class CreateFlowEdge {
  constructor(private readonly edges: IFlowEdgeRepository) {}

  async execute(input: NewFlowEdge): Promise<Result<FlowEdge>> {
    return this.edges.create(input);
  }
}
