import type { Flow, IFlowRepository, Result } from "@rbrasier/domain";
import { err } from "@rbrasier/domain";

export class GrantFlowOwner {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(flowId: string, userId: string): Promise<Result<Flow>> {
    const flowResult = await this.flows.findById(flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err({ code: "NOT_FOUND", message: `Flow ${flowId} not found.` });

    const withPermission = await this.flows.setPermission(flowId, userId, "owner");
    if (withPermission.error) return withPermission;

    return this.flows.update(flowId, { ownerUserId: userId });
  }
}
