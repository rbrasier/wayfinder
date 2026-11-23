import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  DEFAULT_SIGNATURE_CONFIG,
  ok,
  type DrawnSignature,
  type IDrawnSignatureRepository,
  type Result,
  type SignatureMethod,
} from "@wayfinder/domain";
import { DecideApproval } from "./decide-approval";
import { ResolveApprovalSubject } from "./resolve-approval-subject";
import {
  InMemoryApprovals,
  InMemoryFlowEdges,
  InMemoryFlowNodes,
  InMemoryMessages,
  InMemorySessions,
  InMemoryStepOutputs,
  InMemoryUsers,
  RecordingAuditLogger,
  approvalNode,
  session,
  unitOfWorkFor,
  user,
} from "./__fixtures__/approval-doubles";

const sha256Hex = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex");

class InMemoryDrawnSignatures implements IDrawnSignatureRepository {
  readonly rows = new Map<string, DrawnSignature>();

  async findByUserId(userId: string): Promise<Result<DrawnSignature | null>> {
    return ok(this.rows.get(userId) ?? null);
  }

  async save(signature: DrawnSignature): Promise<Result<void>> {
    this.rows.set(signature.userId, signature);
    return ok(undefined);
  }
}

const seed = async (options: { method: SignatureMethod; slot?: boolean }) => {
  const approvals = new InMemoryApprovals();
  const sessions = new InMemorySessions();
  sessions.add(session());
  const nodes = new InMemoryFlowNodes();
  nodes.add(
    approvalNode({
      id: "node-appr",
      name: "Manager review",
      config: {
        approverSource: "first_level_supervisor",
        ...(options.slot === false ? {} : { signatureFieldKey: "delegate_signature" }),
      },
    }),
  );
  nodes.add(approvalNode({ id: "node-draft", type: "conversational", name: "Prepare instrument" }));
  const stepOutputs = new InMemoryStepOutputs();
  await stepOutputs.create({
    sessionId: "session-1",
    flowId: "flow-1",
    nodeId: "node-draft",
    fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
  });
  const users = new InMemoryUsers();
  users.add({ ...user("manager-1", "manager@corp.test"), name: "Jane Doe" });
  const messages = new InMemoryMessages();
  const drawnSignatures = new InMemoryDrawnSignatures();

  const created = await approvals.create({
    sessionId: "session-1",
    flowId: "flow-1",
    nodeId: "node-appr",
    requestedByUserId: "operator-1",
    approverSource: "first_level_supervisor",
    approverUserId: "manager-1",
  });

  const sut = new DecideApproval(
    unitOfWorkFor(approvals, sessions),
    approvals,
    sessions,
    new InMemoryFlowEdges(),
    stepOutputs,
    new RecordingAuditLogger(),
    undefined,
    messages,
    users,
    nodes,
    sha256Hex,
    new ResolveApprovalSubject(approvals, nodes, stepOutputs, messages),
    undefined,
    {
      loadSignatureConfig: async () => ({ ...DEFAULT_SIGNATURE_CONFIG, method: options.method }),
      drawnSignatures,
    },
  );
  return { sut, approvals, drawnSignatures, approvalId: created.data!.id };
};

const drawing = (userId: string): DrawnSignature => ({
  userId,
  storagePath: `signatures/drawn/${userId}/1.png`,
  updatedAt: new Date("2026-11-01T00:00:00Z"),
});

describe("DecideApproval — signature methods", () => {
  it("decides as before under attestation, recording no drawing", async () => {
    const { sut, approvals, approvalId } = await seed({ method: "attestation" });

    const result = await sut.execute({ approvalId, decidedByUserId: "manager-1", decision: "approved" });

    expect(result.error).toBeUndefined();
    expect(approvals.rows.get(approvalId)!.recordSnapshot!.drawnSignatureStoragePath).toBeUndefined();
  });

  it("refuses to approve a signing step until the approver has drawn a signature", async () => {
    const { sut, approvals, approvalId } = await seed({ method: "drawn" });

    const result = await sut.execute({ approvalId, decidedByUserId: "manager-1", decision: "approved" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toBe("Draw your signature before approving this step.");
    expect(approvals.rows.get(approvalId)!.status).toBe("pending");
  });

  it("freezes the approver's current drawing into the record", async () => {
    const { sut, approvals, drawnSignatures, approvalId } = await seed({ method: "drawn" });
    drawnSignatures.rows.set("manager-1", drawing("manager-1"));

    const result = await sut.execute({ approvalId, decidedByUserId: "manager-1", decision: "approved" });

    expect(result.error).toBeUndefined();
    expect(approvals.rows.get(approvalId)!.recordSnapshot!.drawnSignatureStoragePath).toBe(
      "signatures/drawn/manager-1/1.png",
    );
  });

  it("does not ask for a drawing on a rejection, and places none", async () => {
    const { sut, approvals, approvalId } = await seed({ method: "drawn" });

    const result = await sut.execute({ approvalId, decidedByUserId: "manager-1", decision: "rejected" });

    expect(result.error).toBeUndefined();
    expect(approvals.rows.get(approvalId)!.recordSnapshot!.drawnSignatureStoragePath).toBeUndefined();
  });

  it("does not ask for a drawing on a step that claims no signature slot", async () => {
    const { sut, approvalId } = await seed({ method: "drawn", slot: false });

    const result = await sut.execute({ approvalId, decidedByUserId: "manager-1", decision: "approved" });

    expect(result.error).toBeUndefined();
  });

  it("never places the approver's drawing when an admin decides on their behalf", async () => {
    const { sut, approvals, drawnSignatures, approvalId } = await seed({ method: "drawn" });
    drawnSignatures.rows.set("manager-1", drawing("manager-1"));

    const result = await sut.execute({
      approvalId,
      decidedByUserId: "admin-1",
      decision: "approved",
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
    expect(approvals.rows.get(approvalId)!.recordSnapshot!.drawnSignatureStoragePath).toBeUndefined();
  });

  it("refuses to sign while an admin is viewing as the approver", async () => {
    const { sut, drawnSignatures, approvals, approvalId } = await seed({ method: "drawn" });
    drawnSignatures.rows.set("manager-1", drawing("manager-1"));

    const result = await sut.execute({
      approvalId,
      decidedByUserId: "manager-1",
      decision: "approved",
      impersonatorId: "admin-1",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(approvals.rows.get(approvalId)!.status).toBe("pending");
  });

  it("refuses an ordinary decision on a certificate signing step — it must go through signing", async () => {
    const { sut, approvals, approvalId } = await seed({ method: "certificate" });

    const result = await sut.execute({ approvalId, decidedByUserId: "manager-1", decision: "approved" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toBe("This step needs a digital signature. Use Approve & sign.");
    expect(approvals.rows.get(approvalId)!.status).toBe("pending");
  });

  it("still lets a certificate step be rejected without signing", async () => {
    const { sut, approvalId } = await seed({ method: "certificate" });

    const result = await sut.execute({ approvalId, decidedByUserId: "manager-1", decision: "rejected" });

    expect(result.error).toBeUndefined();
  });
});
