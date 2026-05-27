import type { Flow, FlowContextDoc, FlowPermissionRole, FlowStatus, FlowVisibility, NewFlow } from "../entities/flow";
import type { Result } from "../result";

export interface FlowUpdate {
  name?: string;
  description?: string | null;
  icon?: string | null;
  expertRole?: string | null;
  status?: FlowStatus;
  visibility?: FlowVisibility;
  ownerUserId?: string;
}

export interface IFlowRepository {
  create(input: NewFlow): Promise<Result<Flow>>;
  findById(id: string): Promise<Result<Flow | null>>;
  list(): Promise<Result<Flow[]>>;
  listForUser(userId: string): Promise<Result<Flow[]>>;
  update(id: string, patch: FlowUpdate): Promise<Result<Flow>>;
  softDelete(id: string): Promise<Result<Flow>>;
  addContextDoc(flowId: string, doc: FlowContextDoc): Promise<Result<Flow>>;
  removeContextDoc(flowId: string, docId: string): Promise<Result<Flow>>;
  setPermission(flowId: string, userId: string, role: FlowPermissionRole): Promise<Result<Flow>>;
}
