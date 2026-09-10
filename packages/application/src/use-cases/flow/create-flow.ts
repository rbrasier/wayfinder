import type { Flow, IFlowRepository, NewFlow, Result } from "@wayfinder/domain";

export class CreateFlow {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(input: NewFlow): Promise<Result<Flow>> {
    return this.flows.create(input);
  }
}
