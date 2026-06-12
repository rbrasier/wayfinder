import type { Approval, ApprovalUpdate, NewApproval } from "../entities/approval";
import type { Result } from "../result";

export interface IApprovalRepository {
  create(input: NewApproval): Promise<Result<Approval>>;
  findById(id: string): Promise<Result<Approval | null>>;
  // The one open approval gating a node in a session, if any. Used to keep the
  // pending row idempotent — reaching a node twice must not raise two requests.
  findPendingByNode(sessionId: string, nodeId: string): Promise<Result<Approval | null>>;
  listPendingForApprover(approverUserId: string): Promise<Result<Approval[]>>;
  update(id: string, patch: ApprovalUpdate): Promise<Result<Approval>>;
  // True once any approval in the session has recorded a snapshot — the point
  // after which the snapshot, not the live document, is the governed record.
  hasRecordedSnapshot(sessionId: string): Promise<Result<boolean>>;
}
