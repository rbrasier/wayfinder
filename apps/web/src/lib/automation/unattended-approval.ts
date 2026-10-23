import { ok, type FlowNode, type FlowNodeType, type Result, type Session } from "@rbrasier/domain";
import type { ConfirmAndSend, SuggestApprover } from "@rbrasier/application";

const STEP_FLAGS: Partial<Record<FlowNodeType, string>> = {
  ai_task: "ai_task_node",
  email: "email_node",
  auto: "auto_node",
  mcp: "mcp",
  scheduled: "scheduled_node",
};

export const flagForStep = (type: FlowNodeType): string | null => STEP_FLAGS[type] ?? null;

export interface ApprovalRaising {
  suggest: SuggestApprover["execute"];
  confirm: ConfirmAndSend["execute"];
}

// An approval step reached with nobody at the keyboard (ADR-065 §5). In a chat
// the operator confirms the suggested approver; here the suggestion is confirmed
// directly, and with no suggestion the request waits for a person to pick.
export const raiseUnattendedApproval = async (
  raising: ApprovalRaising,
  session: Session,
  node: FlowNode,
): Promise<Result<{ approverAssigned: boolean }>> => {
  const suggested = await raising.suggest({
    sessionId: session.id,
    flowId: session.flowId,
    nodeId: node.id,
    requestedByUserId: session.userId,
  });
  if (suggested.error) return suggested;
  const { approval } = suggested.data;
  if (approval.approverUserId || approval.approverEmail) return ok({ approverAssigned: true });
  if (!approval.suggestedApproverUserId) return ok({ approverAssigned: false });

  const confirmed = await raising.confirm({
    approvalId: approval.id,
    approverUserId: approval.suggestedApproverUserId,
    isOverride: false,
  });
  return confirmed.error ? confirmed : ok({ approverAssigned: true });
};
