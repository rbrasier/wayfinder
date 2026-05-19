import type { FlowNode, IFlowNodeRepository, Result } from "@rbrasier/domain";

export class UpdateFlowNodePosition {
  constructor(private readonly nodes: IFlowNodeRepository) {}

  async execute(id: string, x: number, y: number): Promise<Result<FlowNode>> {
    return this.nodes.updatePosition(id, x, y);
  }
}
