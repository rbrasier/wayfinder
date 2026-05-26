import type { Flow, IFlowRepository, Result } from "@rbrasier/domain";

export class DeleteFlow {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(id: string): Promise<Result<Flow>> {
    return this.flows.softDelete(id);
  }
}
