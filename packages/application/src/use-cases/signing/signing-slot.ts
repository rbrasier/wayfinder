import type { Approval, ApprovalNodeConfig, IFlowNodeRepository } from "@wayfinder/domain";
import type { ResolveApprovalSubject } from "../approvals/resolve-approval-subject";
import { loneSignatureSlot } from "../approvals/signature-slot";

export interface SigningSlot {
  slotKey: string;
  // Null when the subject step cannot be resolved yet. Enough to say the step
  // signs; not enough to sign it.
  subjectNodeId: string | null;
}

// The signature slot a pending approval will fill, resolved the way the
// decision resolves it: the node's chosen slot, or the template's only one
// (ADR-043 §5). Null when the approval signs nothing.
export const resolveSigningSlot = async (
  flowNodes: IFlowNodeRepository,
  resolveSubject: ResolveApprovalSubject,
  approval: Approval,
): Promise<SigningSlot | null> => {
  const nodes = await flowNodes.listByFlow(approval.flowId);
  if (nodes.error) return null;
  const subject = await resolveSubject.execute({ approvalId: approval.id });
  const subjectNodeId = subject.error ? null : subject.data.subjectNodeId;

  const config = (nodes.data.find((node) => node.id === approval.nodeId)?.config ?? {}) as unknown as ApprovalNodeConfig;
  const slotKey = config.signatureFieldKey ?? loneSignatureSlot(nodes.data, subjectNodeId);
  return slotKey ? { slotKey, subjectNodeId } : null;
};
