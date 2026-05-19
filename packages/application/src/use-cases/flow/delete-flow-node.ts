import type { IFlowNodeRepository, Result } from "@rbrasier/domain";

export class DeleteFlowNode {
  constructor(private readonly nodes: IFlowNodeRepository) {}

  async execute(id: string): Promise<Result<true>> {
    return this.nodes.delete(id);
  }
}
