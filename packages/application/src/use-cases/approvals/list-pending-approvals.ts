import type { Approval, IApprovalRepository, Result } from "@rbrasier/domain";

export class ListPendingApprovals {
  constructor(private readonly approvals: IApprovalRepository) {}

  async execute(approverUserId: string): Promise<Result<Approval[]>> {
    return this.approvals.listPendingForApprover(approverUserId);
  }
}
