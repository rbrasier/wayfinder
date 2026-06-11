// An approval request raised when a session reaches an `approval` node. The row
// is the source of truth for the decision; the resolver only ever *suggests* an
// approver, and the operator must confirm (or override) before it is sent.

export type ApproverSource =
  | "first_level_supervisor"
  | "second_level_supervisor"
  | "dynamic";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "changes_requested";

// The three terminal decisions an approver can record. `pending` is excluded —
// a decision always moves the row out of `pending`.
export type ApprovalDecision = "approved" | "rejected" | "changes_requested";

export interface Approval {
  readonly id: string;
  readonly sessionId: string;
  readonly flowId: string;
  readonly nodeId: string;
  readonly messageId: string | null;
  readonly requestedByUserId: string;
  readonly approverSource: ApproverSource;
  readonly suggestedApproverUserId: string | null;
  readonly approverUserId: string | null;
  readonly approverEmail: string | null;
  readonly isOverride: boolean;
  readonly status: ApprovalStatus;
  readonly decidedByUserId: string | null;
  readonly decidedAt: Date | null;
  readonly comment: string | null;
  readonly recordSnapshot: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewApproval {
  sessionId: string;
  flowId: string;
  nodeId: string;
  messageId?: string | null;
  requestedByUserId: string;
  approverSource: ApproverSource;
  suggestedApproverUserId?: string | null;
  approverUserId?: string | null;
  approverEmail?: string | null;
  isOverride?: boolean;
  status?: ApprovalStatus;
  recordSnapshot?: Record<string, unknown> | null;
}

export interface ApprovalUpdate {
  approverUserId?: string | null;
  approverEmail?: string | null;
  isOverride?: boolean;
  status?: ApprovalStatus;
  decidedByUserId?: string | null;
  decidedAt?: Date | null;
  comment?: string | null;
  recordSnapshot?: Record<string, unknown> | null;
}
