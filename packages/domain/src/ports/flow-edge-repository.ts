import type { FlowEdge, NewFlowEdge } from "../entities/flow-edge";
import type { Result } from "../result";

export interface IFlowEdgeRepository {
  create(input: NewFlowEdge): Promise<Result<FlowEdge>>;
  listByFlow(flowId: string): Promise<Result<FlowEdge[]>>;
  delete(id: string): Promise<Result<true>>;
}
