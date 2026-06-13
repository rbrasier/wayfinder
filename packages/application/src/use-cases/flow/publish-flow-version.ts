import {
  buildFlowSnapshot,
  domainError,
  err,
  ok,
  type FlowVersion,
  type IAuditLogger,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
  type IFlowVersionRepository,
  type Result,
} from "@rbrasier/domain";

export interface PublishFlowVersionInput {
  flowId: string;
  publishedByUserId: string;
  changeSummary?: string | null;
}

// Promotes the flow's open draft (or records a fresh published version) by
// assembling an immutable snapshot of the current live definition. Hooked into
// the `status:"published"` transition on flow.update (ADR-015).
export class PublishFlowVersion {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly flowVersions: IFlowVersionRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: PublishFlowVersionInput): Promise<Result<FlowVersion>> {
    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));

    const [nodesResult, edgesResult] = await Promise.all([
      this.flowNodes.listByFlow(input.flowId),
      this.flowEdges.listByFlow(input.flowId),
    ]);
    if (nodesResult.error) return nodesResult;
    if (edgesResult.error) return edgesResult;

    const snapshot = buildFlowSnapshot(flowResult.data, nodesResult.data, edgesResult.data);
    const published = await this.flowVersions.createPublished({
      flowId: input.flowId,
      snapshot,
      publishedByUserId: input.publishedByUserId,
      changeSummary: input.changeSummary ?? null,
    });
    if (published.error) return published;

    await this.auditLogger.log({
      actorId: input.publishedByUserId,
      action: "flow.version.published",
      resourceType: "flow",
      resourceId: input.flowId,
      metadata: {
        versionId: published.data.id,
        versionNumber: published.data.versionNumber,
        changeSummary: published.data.changeSummary,
      },
    });

    return ok(published.data);
  }
}
