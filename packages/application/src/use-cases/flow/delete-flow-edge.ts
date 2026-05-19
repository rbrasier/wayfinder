import type { IFlowEdgeRepository, Result } from "@rbrasier/domain";

export class DeleteFlowEdge {
  constructor(private readonly edges: IFlowEdgeRepository) {}

  async execute(id: string): Promise<Result<true>> {
    return this.edges.delete(id);
  }
}
