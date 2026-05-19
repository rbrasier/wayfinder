import type { Flow, FlowUpdate, IFlowRepository, Result } from "@rbrasier/domain";

export class UpdateFlow {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(id: string, patch: FlowUpdate): Promise<Result<Flow>> {
    return this.flows.update(id, patch);
  }
}
