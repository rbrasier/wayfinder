import type { Flow, IFlowRepository, Result } from "@rbrasier/domain";

export class ListFlows {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(): Promise<Result<Flow[]>> {
    return this.flows.list();
  }
}

export class ListFlowsForUser {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(userId: string): Promise<Result<Flow[]>> {
    return this.flows.listForUser(userId);
  }
}
