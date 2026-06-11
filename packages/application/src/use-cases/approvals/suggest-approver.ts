import {
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalNodeConfig,
  type IApprovalRepository,
  type IFlowNodeRepository,
  type IReportingLineResolver,
  type IUserRepository,
  type Result,
} from "@rbrasier/domain";

export interface SuggestApproverInput {
  sessionId: string;
  flowId: string;
  nodeId: string;
  requestedByUserId: string;
}

export interface SuggestedApprover {
  userId: string;
  name: string | null;
  email: string;
}

export interface SuggestApproverOutput {
  approval: Approval;
  suggestedApprover: SuggestedApprover | null;
}

// Reaching an approval node: compute a *suggested* approver from the node's
// `approverSource` and write (or return) the single pending row that gates it.
// Idempotent — reaching the node twice must not raise two requests.
export class SuggestApprover {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly resolver: IReportingLineResolver,
    private readonly users: IUserRepository,
  ) {}

  async execute(input: SuggestApproverInput): Promise<Result<SuggestApproverOutput>> {
    const existing = await this.approvals.findPendingByNode(input.sessionId, input.nodeId);
    if (existing.error) return existing;
    if (existing.data) {
      const suggestedApprover = await this.describe(existing.data.suggestedApproverUserId);
      return ok({ approval: existing.data, suggestedApprover });
    }

    const nodeResult = await this.flowNodes.findById(input.nodeId);
    if (nodeResult.error) return nodeResult;
    const node = nodeResult.data;
    if (!node || node.type !== "approval") {
      return err(domainError("VALIDATION_FAILED", "Node is not an approval node."));
    }
    const config = node.config as unknown as ApprovalNodeConfig;

    const suggestedUserId = await this.resolveSuggestion(config, input.requestedByUserId);

    const created = await this.approvals.create({
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      requestedByUserId: input.requestedByUserId,
      approverSource: config.approverSource,
      suggestedApproverUserId: suggestedUserId,
      status: "pending",
    });
    if (created.error) return created;

    const suggestedApprover = await this.describe(suggestedUserId);
    return ok({ approval: created.data, suggestedApprover });
  }

  private async resolveSuggestion(
    config: ApprovalNodeConfig,
    userId: string,
  ): Promise<string | null> {
    if (config.approverSource === "dynamic") {
      const holders = await this.resolver.findPositionHolder({ role: config.roleHint });
      if (holders.error) return null;
      const withAccount = holders.data.filter((person) => person.userId);
      // Only an unambiguous single holder is auto-suggested; zero or several
      // leave the operator to pick via "Someone else".
      return withAccount.length === 1 ? withAccount[0]!.userId : null;
    }

    const level: 1 | 2 = config.approverSource === "second_level_supervisor" ? 2 : 1;
    const suggestion = await this.resolver.suggest({ level, userId });
    if (suggestion.error) return null;
    if ("unresolved" in suggestion.data) return null;
    return suggestion.data.suggestedApproverUserId;
  }

  private async describe(userId: string | null): Promise<SuggestedApprover | null> {
    if (!userId) return null;
    const userResult = await this.users.findById(userId);
    if (userResult.error || !userResult.data) return null;
    return { userId: userResult.data.id, name: userResult.data.name, email: userResult.data.email };
  }
}
