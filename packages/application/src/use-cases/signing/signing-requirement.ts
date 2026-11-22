import {
  domainError,
  err,
  ok,
  type IApprovalRepository,
  type IDrawnSignatureRepository,
  type IFlowNodeRepository,
  type Result,
  type SignatureConfig,
  type SignatureMethod,
} from "@wayfinder/domain";
import type { ResolveApprovalSubject } from "../approvals/resolve-approval-subject";
import { resolveSigningSlot } from "./signing-slot";

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
    const signs = (await resolveSigningSlot(this.flowNodes, this.approvalSubject, found.data)) !== null;
    const drawing = await this.drawnSignatures.findByUserId(input.userId);
    if (drawing.error) return drawing;
    const hasDrawing = drawing.data !== null;

    const drawingApplies = signs && method !== "attestation";
    return ok({ method, signs, needsDrawing: drawingApplies && method === "drawn" && !hasDrawing, hasDrawing });
  }
}
