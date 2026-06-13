import type {
  FlowVersionSummary,
  IFlowVersionRepository,
  Result,
} from "@rbrasier/domain";

// History metadata, newest first — never carries the heavy snapshot payload.
export class ListFlowVersions {
  constructor(private readonly flowVersions: IFlowVersionRepository) {}

  async execute(flowId: string): Promise<Result<FlowVersionSummary[]>> {
    return this.flowVersions.listForFlow(flowId);
  }
}
