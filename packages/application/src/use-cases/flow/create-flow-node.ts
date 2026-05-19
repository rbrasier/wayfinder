import type { FlowNode, IFlowNodeRepository, NewFlowNode, Result } from "@rbrasier/domain";

export class CreateFlowNode {
  constructor(private readonly nodes: IFlowNodeRepository) {}

  async execute(input: NewFlowNode): Promise<Result<FlowNode>> {
    return this.nodes.create(input);
  }
}
