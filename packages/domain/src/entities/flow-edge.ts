export interface FlowEdge {
  id: string;
  flowId: string;
  fromNodeId: string;
  toNodeId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFlowEdge {
  flowId: string;
  fromNodeId: string;
  toNodeId: string;
}
