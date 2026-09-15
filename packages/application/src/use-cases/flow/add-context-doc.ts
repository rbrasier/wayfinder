import type { Flow, FlowContextDoc, IFlowRepository, Result } from "@wayfinder/domain";

export class AddContextDoc {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(flowId: string, doc: FlowContextDoc): Promise<Result<Flow>> {
    return this.flows.addContextDoc(flowId, doc);
  }
}
