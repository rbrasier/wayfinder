import {
  buildFlowSnapshot,
  domainError,
  err,
  ok,
  type FlowVersion,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
  type IFlowVersionRepository,
  type Result,
} from "@rbrasier/domain";

// Opens (or refreshes) the single draft version that captures edits diverging
// from the published baseline. Only published flows accrue a draft — an
// unpublished flow's live rows ARE its working copy until its first publish, so
// there is nothing to diverge from yet. Returns null in that no-op case.
export class SyncFlowDraft {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly flowVersions: IFlowVersionRepository,
  ) {}

  async execute(flowId: string): Promise<Result<FlowVersion | null>> {
    const flowResult = await this.flows.findById(flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));
    if (flowResult.data.status !== "published") return ok(null);

    const [nodesResult, edgesResult] = await Promise.all([
      this.flowNodes.listByFlow(flowId),
      this.flowEdges.listByFlow(flowId),
    ]);
    if (nodesResult.error) return nodesResult;
    if (edgesResult.error) return edgesResult;

    const snapshot = buildFlowSnapshot(flowResult.data, nodesResult.data, edgesResult.data);
    return this.flowVersions.upsertDraft({ flowId, snapshot });
  }
}
