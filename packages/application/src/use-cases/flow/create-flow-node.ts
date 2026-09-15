import type { FlowNode, IFlowNodeRepository, NewFlowNode, Result } from "@wayfinder/domain";

export class CreateFlowNode {
  constructor(private readonly nodes: IFlowNodeRepository) {}

  async execute(input: NewFlowNode): Promise<Result<FlowNode>> {
    return this.nodes.create(input);
  }
}
