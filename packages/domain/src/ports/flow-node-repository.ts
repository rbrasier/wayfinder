import type { FlowNode, NewFlowNode } from "../entities/flow-node";
import type { Result } from "../result";

export interface FlowNodeUpdate {
  name?: string;
  colour?: string | null;
  config?: Record<string, unknown>;
}

export interface IFlowNodeRepository {
  create(input: NewFlowNode): Promise<Result<FlowNode>>;
  findById(id: string): Promise<Result<FlowNode | null>>;
  listByFlow(flowId: string): Promise<Result<FlowNode[]>>;
  update(id: string, patch: FlowNodeUpdate): Promise<Result<FlowNode>>;
  updatePosition(id: string, x: number, y: number): Promise<Result<FlowNode>>;
  delete(id: string): Promise<Result<true>>;
}
