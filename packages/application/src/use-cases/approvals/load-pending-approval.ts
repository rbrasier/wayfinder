import {
  ok,
  type Approval,
  type IApprovalRepository,
  type IUserRepository,
  type Result,
} from "@wayfinder/domain";
import {
  describeApprover,
  describeAssignedApprover,
  type AssignedApprover,
  type SuggestedApprover,
} from "./approver-identity";

export interface LoadPendingApprovalInput {
  sessionId: string;
  nodeId: string;
}

export interface LoadPendingApprovalOutput {
  approval: Approval;
  suggestedApprover: SuggestedApprover | null;
  assignedApprover: AssignedApprover | null;
}

// Reads the pending row gating a node, and never creates one.
//
// `SuggestApprover` has to be a mutation because it raises the row when none
// exists, which means a UI reading through it can never refetch — React Query
// does not refetch mutations. That is what left the originator's gate showing
// "Choose the approver" for a request the previous approver had already sent:
// the gate latched what it saw at mount and nothing re-read it.
//
// Splitting the read out gives the gate something it can poll and invalidate,
// so the card follows the row instead of remembering it.
export class LoadPendingApproval {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly users: IUserRepository,
  ) {}

  async execute(input: LoadPendingApprovalInput): Promise<Result<LoadPendingApprovalOutput | null>> {
    const found = await this.approvals.findPendingByNode(input.sessionId, input.nodeId);
    if (found.error) return found;
    if (!found.data) return ok(null);

    const approval = found.data;
    return ok({
      approval,
      suggestedApprover: await describeApprover(this.users, approval.suggestedApproverUserId),
      assignedApprover: await describeAssignedApprover(this.users, approval),
    });
  }
}
