import type {
  Approval,
  ApprovalListScope,
  IApprovalRepository,
  Result,
} from "@wayfinder/domain";

export interface ListApprovalsInput {
  approverUserId: string;
  approverEmail: string | null;
  // Defaults to the approver's queue, which is what every caller wanted before
  // history existed.
  scope?: ApprovalListScope;
}

export class ListApprovals {
  constructor(private readonly approvals: IApprovalRepository) {}

  async execute(input: ListApprovalsInput): Promise<Result<Approval[]>> {
    return this.approvals.listForApprover({
      approverUserId: input.approverUserId,
      approverEmail: input.approverEmail,
      scope: input.scope ?? "pending",
    });
  }
}
