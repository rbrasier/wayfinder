import {
  domainError,
  err,
  ok,
  type ApprovalNodeConfig,
  type IApprovalRepository,
  type IDrawnSignatureRepository,
  type IFlowNodeRepository,
  type Result,
  type SignatureConfig,
  type SignatureMethod,
} from "@wayfinder/domain";
import type { ResolveApprovalSubject } from "../approvals/resolve-approval-subject";
import { loneSignatureSlot } from "../approvals/signature-slot";

export interface SigningRequirement {
  method: SignatureMethod;
  // Whether this approval fills a signature slot at all. A step that signs
  // nothing decides the ordinary way under every method.
  signs: boolean;
  needsDrawing: boolean;
  hasDrawing: boolean;
}

// What the decision UI must collect before an approval can go through: a
// drawing, a certificate signature, or nothing. The server still enforces the
// same rule at decision time; this only lets the UI ask first.
export class GetSigningRequirement {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly approvalSubject: ResolveApprovalSubject,
    private readonly loadSignatureConfig: () => Promise<SignatureConfig>,
    private readonly drawnSignatures: IDrawnSignatureRepository,
  ) {}

  async execute(input: { approvalId: string; userId: string }): Promise<Result<SigningRequirement>> {
    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    if (!found.data) return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));

    const { method } = await this.loadSignatureConfig();
    const signs = await this.claimsSlot(input.approvalId, found.data.flowId, found.data.nodeId);
    const drawing = await this.drawnSignatures.findByUserId(input.userId);
    if (drawing.error) return drawing;
    const hasDrawing = drawing.data !== null;

    const drawingApplies = signs && method !== "attestation";
    return ok({ method, signs, needsDrawing: drawingApplies && method === "drawn" && !hasDrawing, hasDrawing });
  }

  private async claimsSlot(approvalId: string, flowId: string, nodeId: string): Promise<boolean> {
    const nodes = await this.flowNodes.listByFlow(flowId);
    if (nodes.error) return false;
    const config = (nodes.data.find((node) => node.id === nodeId)?.config ?? {}) as unknown as ApprovalNodeConfig;
    if (config.signatureFieldKey) return true;
    const subject = await this.approvalSubject.execute({ approvalId });
    const subjectNodeId = subject.error ? null : subject.data.subjectNodeId;
    return loneSignatureSlot(nodes.data, subjectNodeId) !== null;
  }
}
