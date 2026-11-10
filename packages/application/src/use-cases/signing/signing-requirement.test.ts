import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNATURE_CONFIG,
  ok,
  type DrawnSignature,
  type IDrawnSignatureRepository,
  type Result,
  type SignatureMethod,
} from "@wayfinder/domain";
import {
  InMemoryApprovals,
  InMemoryFlowNodes,
  InMemoryMessages,
  InMemoryStepOutputs,
  approvalNode,
} from "../approvals/__fixtures__/approval-doubles";
import { ResolveApprovalSubject } from "../approvals/resolve-approval-subject";
import { GetSigningRequirement } from "./signing-requirement";

class Drawings implements IDrawnSignatureRepository {
  readonly rows = new Map<string, DrawnSignature>();
  async findByUserId(userId: string): Promise<Result<DrawnSignature | null>> {
    return ok(this.rows.get(userId) ?? null);
  }
  async save(signature: DrawnSignature): Promise<Result<void>> {
    this.rows.set(signature.userId, signature);
    return ok(undefined);
  }
}

const build = async (method: SignatureMethod, claimsSlot = true) => {
  const approvals = new InMemoryApprovals();
  const nodes = new InMemoryFlowNodes();
  nodes.add(
    approvalNode({
      id: "node-appr",
      config: {
        approverSource: "first_level_supervisor",
        ...(claimsSlot ? { signatureFieldKey: "delegate_signature" } : {}),
      },
    }),
  );
  const created = await approvals.create({
    sessionId: "session-1",
    flowId: "flow-1",
    nodeId: "node-appr",
    requestedByUserId: "operator-1",
    approverSource: "first_level_supervisor",
    approverUserId: "manager-1",
  });
  const drawings = new Drawings();
  const sut = new GetSigningRequirement(
    approvals,
    nodes,
    new ResolveApprovalSubject(approvals, nodes, new InMemoryStepOutputs(), new InMemoryMessages()),
    async () => ({ ...DEFAULT_SIGNATURE_CONFIG, method }),
    drawings,
  );
  return { sut, drawings, approvalId: created.data!.id };
};

describe("GetSigningRequirement", () => {
  it("asks for nothing under attestation", async () => {
    const { sut, approvalId } = await build("attestation");

    const result = await sut.execute({ approvalId, userId: "manager-1" });

    expect(result.data).toEqual({ method: "attestation", signs: true, needsDrawing: false, hasDrawing: false });
  });

  it("asks the approver to draw when they have no drawing yet", async () => {
    const { sut, approvalId } = await build("drawn");

    const result = await sut.execute({ approvalId, userId: "manager-1" });

    expect(result.data).toMatchObject({ method: "drawn", signs: true, needsDrawing: true, hasDrawing: false });
  });

  it("reports an existing drawing so the pad is skipped", async () => {
    const { sut, drawings, approvalId } = await build("drawn");
    drawings.rows.set("manager-1", { userId: "manager-1", storagePath: "p", updatedAt: new Date() });

    const result = await sut.execute({ approvalId, userId: "manager-1" });

    expect(result.data).toMatchObject({ needsDrawing: false, hasDrawing: true });
  });

  it("reports a step with no slot as not signing at all", async () => {
    const { sut, approvalId } = await build("certificate", false);

    const result = await sut.execute({ approvalId, userId: "manager-1" });

    expect(result.data).toMatchObject({ signs: false, needsDrawing: false });
  });
});
