import type {
  Flow,
  FlowEdge,
  FlowNode,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  Result,
} from "@rbrasier/domain";
import { ok } from "@rbrasier/domain";

export interface FlowCanvas {
  flow: Flow;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export class GetFlowCanvas {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly nodes: IFlowNodeRepository,
    private readonly edges: IFlowEdgeRepository,
  ) {}

  async execute(flowId: string): Promise<Result<FlowCanvas | null>> {
    const flowResult = await this.flows.findById(flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return ok(null);

    const [nodesResult, edgesResult] = await Promise.all([
      this.nodes.listByFlow(flowId),
      this.edges.listByFlow(flowId),
    ]);
    if (nodesResult.error) return nodesResult;
    if (edgesResult.error) return edgesResult;

    return ok({ flow: flowResult.data, nodes: nodesResult.data, edges: edgesResult.data });
  }
}
