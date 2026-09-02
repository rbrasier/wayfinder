import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  domainError,
  err,
  ok,
  type IObjectStorage,
  type NewApproval,
  type Result,
} from "@rbrasier/domain";
import { DecideApproval } from "./decide-approval";
import { RecordOffSystemApproval } from "./record-off-system-approval";
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

const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

class FakeObjectStorage implements IObjectStorage {
  objects = new Map<string, Buffer>();
  failPut = false;

  async put(key: string, data: Buffer): Promise<Result<{ key: string }>> {
    if (this.failPut) return err(domainError("INFRA_FAILURE", "Storage is down."));
    this.objects.set(key, data);
    return ok({ key });
  }
  async get(key: string): Promise<Result<Buffer>> {
    const bytes = this.objects.get(key);
    if (!bytes) return err(domainError("NOT_FOUND", `No object at ${key}.`));
    return ok(bytes);
  }
  async delete(key: string): Promise<Result<void>> {
    this.objects.delete(key);
    return ok(undefined);
  }
  async exists(key: string): Promise<Result<boolean>> {
    return ok(this.objects.has(key));
  }
  async initialise(): Promise<void> {}
}

const sessionStarted = new Date("2026-08-01T09:30:00.000Z");
const today = new Date("2026-08-20T14:00:00.000Z");

const evidence = () => ({
  filename: "signed memo.pdf",
  mimeType: "application/pdf",
  bytes: Buffer.from("a scan of the signed memo", "utf8"),
});

describe("RecordOffSystemApproval", () => {
  const build = async (options: {
    approval?: Partial<NewApproval>;
    allowOffSystemApproval?: boolean;
  } = {}) => {
    const approvals = new InMemoryApprovals();
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
      ...options.approval,
    });
    const approval = created.data!;

    const sessions = new InMemorySessions();
    sessions.add(session({ createdAt: sessionStarted }));
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const flowNodes = new InMemoryFlowNodes();
    flowNodes.add(
      approvalNode({
        config: {
          approverSource: "first_level_supervisor",
          ...(options.allowOffSystemApproval === undefined
            ? {}
            : { allowOffSystemApproval: options.allowOffSystemApproval }),
        },
      }),
    );
    const users = new InMemoryUsers();
    users.add(user("manager-1", "manager@example.gov"));
    users.add(user("operator-1", "operator@example.gov"));
    const audit = new RecordingAuditLogger();
    const storage = new FakeObjectStorage();

    const decide = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      edges,
      new InMemoryStepOutputs(),
      audit,
      undefined,
      new InMemoryMessages(),
      users,
      flowNodes,
      sha256Hex,
    );
    const sut = new RecordOffSystemApproval(approvals, sessions, flowNodes, storage, audit, decide, {
      now: () => today,
    });

    return { approval, approvals, audit, storage, sut };
  };

  const validInput = (approvalId: string) => ({
    approvalId,
    nominatedByUserId: "operator-1",
    approvedOn: "2026-08-14",
    comment: "Signed at the delegation committee.",
    evidence: evidence(),
  });

  it("records the approval and advances the session", async () => {
    const { approval, approvals, sut } = await build();

    const result = await sut.execute(validInput(approval.id));

    expect(result.error).toBeUndefined();
    expect(result.data?.advanced).toBe(true);
    expect(approvals.rows.get(approval.id)!.status).toBe("approved");
  });

  it("files the evidence under the approval, with the filename made safe", async () => {
    const { approval, approvals, storage, sut } = await build();

    await sut.execute(validInput(approval.id));

    const storedPath = approvals.rows.get(approval.id)!.offSystemEvidenceStoragePath!;
    expect(storedPath).toContain(`approval-evidence/${approval.id}/`);
    expect(storedPath).not.toContain(" ");
    expect(storage.objects.has(storedPath)).toBe(true);
  });

  it("keeps the filename the person recognises on the row, not the sanitised key", async () => {
    const { approval, approvals, sut } = await build();

    await sut.execute(validInput(approval.id));

    expect(approvals.rows.get(approval.id)!.offSystemEvidenceFilename).toBe("signed memo.pdf");
  });

  it("names the nominator in an audit entry of its own", async () => {
    const { approval, audit, sut } = await build();

    await sut.execute(validInput(approval.id));

    const entry = audit.entries.find((row) => row.action === "approval.recorded_off_system");
    expect(entry?.actorId).toBe("operator-1");
    expect(entry?.metadata).toMatchObject({
      approvedOn: "2026-08-14",
      evidenceFilename: "signed memo.pdf",
    });
  });

  it("refuses an approval step whose author turned off-system recording off", async () => {
    const { approval, approvals, storage, sut } = await build({ allowOffSystemApproval: false });

    const result = await sut.execute(validInput(approval.id));

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(approvals.rows.get(approval.id)!.status).toBe("pending");
    expect(storage.objects.size).toBe(0);
  });

  it("allows a step authored before the setting existed", async () => {
    const { approval, sut } = await build();

    const result = await sut.execute(validInput(approval.id));

    expect(result.error).toBeUndefined();
  });

  it("refuses a date in the future and stores nothing", async () => {
    const { approval, storage, sut } = await build();

    const result = await sut.execute({ ...validInput(approval.id), approvedOn: "2026-08-21" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("future");
    expect(storage.objects.size).toBe(0);
  });

  it("refuses a date from before the work being approved existed", async () => {
    const { approval, sut } = await build();

    const result = await sut.execute({ ...validInput(approval.id), approvedOn: "2026-07-30" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses an empty evidence file", async () => {
    const { approval, storage, sut } = await build();

    const result = await sut.execute({
      ...validInput(approval.id),
      evidence: { ...evidence(), bytes: Buffer.alloc(0) },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(storage.objects.size).toBe(0);
  });

  it("reports a storage failure without recording a decision", async () => {
    const { approval, approvals, storage, sut } = await build();
    storage.failPut = true;

    const result = await sut.execute(validInput(approval.id));

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(approvals.rows.get(approval.id)!.status).toBe("pending");
  });

  it("refuses a nominator who neither owns the session nor raised the request", async () => {
    const { approval, sut } = await build();

    const result = await sut.execute({
      ...validInput(approval.id),
      nominatedByUserId: "bystander-1",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("cleans up the stored evidence when the decision is refused", async () => {
    const { approval, storage, sut } = await build();

    await sut.execute({ ...validInput(approval.id), nominatedByUserId: "bystander-1" });

    // The object was written before the decision was attempted, so a refusal
    // must not leave it behind referenced by nothing.
    expect(storage.objects.size).toBe(0);
  });

  it("refuses a row somebody has already decided", async () => {
    const { approval, approvals, storage, sut } = await build();
    await approvals.update(approval.id, { status: "approved", decidedByUserId: "manager-1" });

    const result = await sut.execute(validInput(approval.id));

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(storage.objects.size).toBe(0);
  });

  it("reports an approval that does not exist", async () => {
    const { sut } = await build();

    const result = await sut.execute(validInput("00000000-0000-0000-0000-000000000000"));

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("carries the nominator's note through as the decision comment", async () => {
    const { approval, approvals, sut } = await build();

    await sut.execute(validInput(approval.id));

    expect(approvals.rows.get(approval.id)!.comment).toBe(
      "Signed at the delegation committee.",
    );
  });
});
