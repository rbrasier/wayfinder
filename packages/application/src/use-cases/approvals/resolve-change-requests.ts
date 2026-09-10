import {
  outstandingChangeRequests,
  type ApprovalChangeRequest,
  type IApprovalRepository,
  type IFlowNodeRepository,
} from "@wayfinder/domain";

// The change requests a session is still carrying, ready to be handed to
// whichever path is about to re-derive the step's field values.
//
// Never fails. Every caller is a generation path, and a document that will not
// render because the approval table could not be read is a worse outcome than
// one rendered exactly as it is rendered today. A failure here therefore
// degrades to "no outstanding requests", which is the pre-fix behaviour.
export const resolveChangeRequests = async (
  approvals: IApprovalRepository,
  flowNodes: IFlowNodeRepository,
  input: { sessionId: string; flowId: string },
): Promise<ApprovalChangeRequest[]> => {
  const rows = await approvals.listBySession(input.sessionId);
  if (rows.error) return [];

  // Names are cosmetic — an unnamed step still yields an actionable
  // instruction, so a failed node read degrades rather than discarding it.
  const nodes = await flowNodes.listByFlow(input.flowId);
  const nodeNames = new Map(
    nodes.error ? [] : nodes.data.map((node) => [node.id, node.name] as const),
  );

  return outstandingChangeRequests({ approvals: rows.data, nodeNames });
};
