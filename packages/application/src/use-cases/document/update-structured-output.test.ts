import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@wayfinder/domain";
import type {
  IApprovalRepository,
  IAuditLogger,
  IFlowNodeRepository,
  ISessionMessageRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  SessionStepOutput,
  StepOutputField,
} from "@wayfinder/domain";
import { UpdateStructuredStepOutput } from "./update-structured-output";

const structuredFields = [
  { key: "decision", label: "Decision", type: "text", optional: false, raw: "Decision" },
  { key: "amount", label: "Amount", type: "currency", optional: false, raw: "Amount" },
];

interface Fakes {
  sessionStatus?: "active" | "completed";
  allowManualEdit?: boolean;
  hasSnapshot?: boolean;
  hasMessage?: boolean;
  hasStepOutput?: boolean;
  hasPendingApproval?: boolean;
  currentNodeId?: string;
}

const makeUseCase = (fakes: Fakes = {}) => {
  const {
    sessionStatus = "active",
    allowManualEdit = true,
    hasSnapshot = false,
    hasMessage = true,
    hasStepOutput = true,
    hasPendingApproval = false,
    currentNodeId = "node-later",
  } = fakes;

  const updatedFields: StepOutputField[][] = [];
  const auditPayloads: unknown[] = [];

  const sessionMessages: ISessionMessageRepository = {
    findById: vi.fn().mockResolvedValue(
      ok(hasMessage ? { id: "message-1", sessionId: "session-1", stepNodeId: "node-1" } : null),
    ),
  } as unknown as ISessionMessageRepository;

  const sessionStepOutputs: ISessionStepOutputRepository = {
    findByMessageId: vi.fn().mockResolvedValue(
      ok(
        hasStepOutput
          ? ({
              id: "out-1",
              fields: [
                { key: "decision", label: "Decision", type: "text", value: "Approved" },
                { key: "amount", label: "Amount", type: "currency", value: "$100.00" },
              ],
            } as unknown as SessionStepOutput)
          : null,
      ),
    ),
    updateFields: vi.fn().mockImplementation(async (_id: string, fields: StepOutputField[]) => {
      updatedFields.push(fields);
      return ok({ id: "out-1", fields } as unknown as SessionStepOutput);
    }),
    create: vi.fn(),
    listByFlow: vi.fn(),
    listBySession: vi.fn(),
  };

  const sessions: ISessionRepository = {
    findById: vi
      .fn()
      .mockResolvedValue(ok({ id: "session-1", status: sessionStatus, currentNodeId })),
  } as unknown as ISessionRepository;

  const flowNodes: IFlowNodeRepository = {
    findById: vi.fn().mockResolvedValue(
      ok({
        id: "node-1",
        config: { outputType: "structured", allowManualEdit, structuredFields },
      }),
    ),
  } as unknown as IFlowNodeRepository;

  const approvals: IApprovalRepository = {
    hasRecordedSnapshot: vi.fn().mockResolvedValue(ok(hasSnapshot)),
    listBySession: vi
      .fn()
      .mockResolvedValue(ok(hasPendingApproval ? [{ id: "appr-1", status: "pending" }] : [])),
  } as unknown as IApprovalRepository;

  const auditLogger: IAuditLogger = {
    log: vi.fn().mockImplementation(async (payload: unknown) => {
      auditPayloads.push(payload);
      return ok(true);
    }),
  } as unknown as IAuditLogger;

  const useCase = new UpdateStructuredStepOutput(
    sessionMessages,
    sessionStepOutputs,
    sessions,
    flowNodes,
    approvals,
    auditLogger,
  );

  return { useCase, updatedFields, auditPayloads, sessionStepOutputs };
};

describe("UpdateStructuredStepOutput", () => {
  it("validates and persists edited field values, and audits the change", async () => {
    const { useCase, updatedFields, auditPayloads } = makeUseCase();

    const result = await useCase.execute({
      messageId: "message-1",
      editedByUserId: "user-1",
      values: { decision: "Rejected", amount: "$250.00" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({ ok: true });
    expect(updatedFields[0]).toEqual([
      { key: "decision", label: "Decision", type: "text", value: "Rejected" },
      { key: "amount", label: "Amount", type: "currency", value: "$250.00" },
    ]);
    expect(auditPayloads).toHaveLength(1);
  });

  it("returns field errors without persisting when a value is invalid", async () => {
    const { useCase, sessionStepOutputs } = makeUseCase();

    const result = await useCase.execute({
      messageId: "message-1",
      editedByUserId: "user-1",
      values: { decision: "Rejected", amount: "not-a-number" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({ ok: false });
    if (result.data && result.data.ok === false) {
      expect(result.data.fieldErrors.map((error) => error.key)).toContain("amount");
    }
    expect(sessionStepOutputs.updateFields).not.toHaveBeenCalled();
  });

  it("rejects editing when manual edit is disabled", async () => {
    const { useCase } = makeUseCase({ allowManualEdit: false });
    const result = await useCase.execute({
      messageId: "message-1",
      editedByUserId: "user-1",
      values: { decision: "Rejected", amount: "$1.00" },
    });
    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("rejects editing once the approval chain has settled", async () => {
    const { useCase } = makeUseCase({ hasSnapshot: true });
    const result = await useCase.execute({
      messageId: "message-1",
      editedByUserId: "user-1",
      values: { decision: "Rejected", amount: "$1.00" },
    });
    expect(result.error?.code).toBe("FORBIDDEN");
  });

  // ADR-045 §5: an approver still deciding must be able to fix their own subject.
  it("allows editing while another approval is still pending", async () => {
    const { useCase } = makeUseCase({ hasSnapshot: true, hasPendingApproval: true });
    const result = await useCase.execute({
      messageId: "message-1",
      editedByUserId: "user-1",
      values: { decision: "Rejected", amount: "$1.00" },
    });
    expect(result.error).toBeUndefined();
  });

  // ADR-044 §1: a change request routes work back to a step meant to be changed.
  it("allows editing the step the session has been routed back to", async () => {
    const { useCase } = makeUseCase({ hasSnapshot: true, currentNodeId: "node-1" });
    const result = await useCase.execute({
      messageId: "message-1",
      editedByUserId: "user-1",
      values: { decision: "Rejected", amount: "$1.00" },
    });
    expect(result.error).toBeUndefined();
  });

  it("rejects editing on an inactive session", async () => {
    const { useCase } = makeUseCase({ sessionStatus: "completed" });
    const result = await useCase.execute({
      messageId: "message-1",
      editedByUserId: "user-1",
      values: { decision: "Rejected", amount: "$1.00" },
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("errors when the message has no step output", async () => {
    const { useCase } = makeUseCase({ hasStepOutput: false });
    const result = await useCase.execute({
      messageId: "message-1",
      editedByUserId: "user-1",
      values: { decision: "Rejected", amount: "$1.00" },
    });
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
