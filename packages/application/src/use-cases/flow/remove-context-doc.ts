import type { Flow, IFlowRepository, Result } from "@rbrasier/domain";

export class RemoveContextDoc {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(flowId: string, docId: string): Promise<Result<Flow>> {
    return this.flows.removeContextDoc(flowId, docId);
  }
}
