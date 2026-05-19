import type { FlowNode, FlowNodeUpdate, IFlowNodeRepository, Result } from "@rbrasier/domain";

export class UpdateFlowNode {
  constructor(private readonly nodes: IFlowNodeRepository) {}

  async execute(id: string, patch: FlowNodeUpdate): Promise<Result<FlowNode>> {
    return this.nodes.update(id, patch);
  }
}
