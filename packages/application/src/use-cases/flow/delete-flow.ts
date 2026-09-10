import type { Flow, IFlowRepository, Result } from "@wayfinder/domain";

export class DeleteFlow {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(id: string): Promise<Result<Flow>> {
    return this.flows.softDelete(id);
  }
}
