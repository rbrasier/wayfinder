import { describe, expect, it, vi } from "vitest";
import { ok, type Approval } from "@rbrasier/domain";
import { ApproverEditSubjectFields } from "./approver-edit-subject-fields";

const at = (iso: string) => new Date(iso);

const approval = (overrides: Partial<Approval> = {}): Approval =>
  ({
    id: "approval-a",
    sessionId: "sess-1",
    flowId: "flow-1",
    nodeId: "node-appr-a",
    messageId: null,
    requestedByUserId: "operator-1",
    approverSource: "first_level_supervisor",
    suggestedApproverUserId: null,
    approverUserId: "manager-1",
    approverEmail: null,
    isOverride: false,
    status: "pending",
    decidedByUserId: null,
    decidedAt: null,
    comment: null,
    recordSnapshot: { subjectNodeId: "node-draft" },
    createdAt: at("2026-08-01T12:00:00Z"),
    updatedAt: at("2026-08-01T12:00:00Z"),
    ...overrides,
  }) as Approval;

// The subject step's declared field set, so a changed key resolves to the label
// the originator actually reads.
const draftNode = {
  id: "node-draft",
  flowId: "flow-1",
  type: "conversational",
  name: "Draft the instrument",
  config: {
    aiInstruction: "Draft it.",
    doneWhen: "Drafted.",
    outputType: "generate_document",
    documentTemplateFields: [
      {
        key: "commencement_date",
        label: "Commencement date",
        type: "date",
        optional: false,
        raw: "",
      },
    ],
  },
};

const build = (rows: Approval[] = [approval()], node: unknown = draftNode) => {
  const approvals = { listBySession: vi.fn(async () => ok(rows)) };
  const users = {
    findById: vi.fn(async () =>
      ok({ id: "manager-1", email: "manager@corp.test", name: "Jane Doe" }),
    ),
  };
  const sessionMessages = {
    findById: vi.fn(async () => ok({ id: "msg-1", sessionId: "sess-1", stepNodeId: "node-draft" })),
    create: vi.fn(async () => ok({ id: "msg-2" })),
  };
  const updateDocumentFields = {
    execute: vi.fn(async () =>
      ok({
        document: {
          filename: "instrument.docx",
          storagePath: "generated/sess-1/instrument-r1.docx",
          summary: null,
          generatedAt: "2026-08-01T11:00:00.000Z",
          editHistory: [
            {
              editedAt: "2026-08-01T13:00:00.000Z",
              editedByUserId: "manager-1",
              storagePath: "generated/sess-1/instrument-r1.docx",
              changes: [
                { key: "commencement_date", previousValue: "01-09-2026", newValue: "01-10-2026" },
              ],
            },
          ],
        },
      }),
    ),
  };

  const flowNodes = { findById: vi.fn(async () => ok(node)) };

  const useCase = new ApproverEditSubjectFields(
    approvals as never,
    users as never,
    sessionMessages as never,
    updateDocumentFields as never,
    flowNodes as never,
  );

  return { useCase, approvals, users, sessionMessages, updateDocumentFields, flowNodes };
};

const edit = { messageId: "msg-1", editedByUserId: "manager-1", values: { commencement_date: "01-10-2026" } };

describe("ApproverEditSubjectFields", () => {
  it("lets a pending approver edit their own approval's subject step", async () => {
    const { useCase, updateDocumentFields } = build();

    const result = await useCase.execute(edit);

    expect(result.error).toBeUndefined();
    expect(updateDocumentFields.execute).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "msg-1", editedByUserId: "manager-1" }),
    );
  });

  it("attributes the edit to the approver so it is not an anonymous mutation", async () => {
    const { useCase, updateDocumentFields } = build();

    await useCase.execute(edit);

    const call = updateDocumentFields.execute.mock.calls[0]![0] as { editedByUserId: string };
    expect(call.editedByUserId).toBe("manager-1");
  });

  it("announces the edit in the thread, naming the approver and the changed fields", async () => {
    const { useCase, sessionMessages } = build();

    await useCase.execute(edit);

    const posted = sessionMessages.create.mock.calls[0]![0] as {
      role: string;
      content: string;
      stepNodeId: string;
    };
    expect(posted.role).toBe("system");
    expect(posted.content).toContain("Jane Doe");
    // Regression guard: the notice named the raw field key, which the
    // originator has never been shown anywhere else in the product.
    expect(posted.content).toContain("Commencement date");
    expect(posted.content).not.toContain("commencement_date");
    expect(posted.stepNodeId).toBe("node-draft");
  });

  it("round-trips into the shape the chat feed parses", async () => {
    const { useCase, sessionMessages } = build();

    await useCase.execute(edit);

    const posted = sessionMessages.create.mock.calls[0]![0] as { content: string };
    // The feed matches this to decide whether to render the changed document
    // beneath the notice; a drift here silently loses that card.
    expect(posted.content).toBe(
      "Jane Doe edited this step before deciding the approval: Commencement date.",
    );
  });

  it("falls back to the raw key when the field has since been removed", async () => {
    const { useCase, sessionMessages } = build([approval()], {
      ...draftNode,
      config: { ...draftNode.config, documentTemplateFields: [] },
    });

    await useCase.execute(edit);

    const posted = sessionMessages.create.mock.calls[0]![0] as { content: string };
    // A changed value the originator is not told about is the one outcome this
    // must never produce, so an unresolvable label degrades to the key.
    expect(posted.content).toContain("commencement_date");
  });

  it("refuses an approver editing a step that is not their subject", async () => {
    const { useCase, updateDocumentFields } = build([
      approval({ recordSnapshot: { subjectNodeId: "node-other" } }),
    ]);

    const result = await useCase.execute(edit);

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(updateDocumentFields.execute).not.toHaveBeenCalled();
  });

  it("refuses once their approval has been decided", async () => {
    const { useCase, updateDocumentFields } = build([approval({ status: "approved" })]);

    const result = await useCase.execute(edit);

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(updateDocumentFields.execute).not.toHaveBeenCalled();
  });

  it("refuses a user holding no pending approval on the session", async () => {
    const { useCase } = build([approval({ approverUserId: "someone-else" })]);

    const result = await useCase.execute(edit);

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses another approver whose own subject is a different step", async () => {
    const { useCase } = build([
      approval(),
      approval({
        id: "approval-b",
        nodeId: "node-appr-b",
        approverUserId: "finance-1",
        recordSnapshot: { subjectNodeId: "node-other" },
      }),
    ]);

    const result = await useCase.execute({ ...edit, editedByUserId: "finance-1" });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("matches an approval assigned by email before the recipient had an account", async () => {
    const { useCase, users, updateDocumentFields } = build([
      approval({ approverUserId: null, approverEmail: "manager@corp.test" }),
    ]);
    users.findById.mockResolvedValue(
      ok({ id: "manager-1", email: "manager@corp.test", name: "Jane Doe" }) as never,
    );

    const result = await useCase.execute(edit);

    expect(result.error).toBeUndefined();
    expect(updateDocumentFields.execute).toHaveBeenCalled();
  });

  it("returns field errors without announcing anything", async () => {
    const { useCase, updateDocumentFields, sessionMessages } = build();
    updateDocumentFields.execute.mockResolvedValue(
      ok({ fieldErrors: [{ key: "commencement_date", message: "Must be a date." }] }) as never,
    );

    const result = await useCase.execute(edit);

    expect(result.data).toMatchObject({ fieldErrors: [{ key: "commencement_date" }] });
    expect(sessionMessages.create).not.toHaveBeenCalled();
  });
});

// An AI task's output (and any structured step's) is a record with no document:
// the approver's correction rewrites the step output instead (ADR-065 §3).
describe("ApproverEditSubjectFields on a structured record", () => {
  const aiTaskNode = {
    id: "node-ai",
    flowId: "flow-1",
    type: "ai_task",
    name: "Summarise hearing",
    config: {
      instruction: "Summarise.",
      outputType: "structured",
      structuredFields: [{ key: "summary", label: "Summary", type: "narrative", optional: false, raw: "" }],
      confidenceThreshold: 80,
      reviewer: { mode: "user", userId: "manager-1" },
    },
  };

  const buildStructured = (structuredResult: unknown = ok({ ok: true })) => {
    const approvals = {
      listBySession: vi.fn(async () =>
        ok([approval({ nodeId: "node-ai", recordSnapshot: { subjectNodeId: "node-ai" } })]),
      ),
    };
    const users = {
      findById: vi.fn(async () => ok({ id: "manager-1", email: "manager@corp.test", name: "Jane Doe" })),
    };
    const sessionMessages = {
      findById: vi.fn(async () =>
        ok({ id: "msg-ai", sessionId: "sess-1", stepNodeId: "node-ai", document: null }),
      ),
      create: vi.fn(async () => ok({ id: "msg-2" })),
    };
    const updateDocumentFields = { execute: vi.fn() };
    const flowNodes = { findById: vi.fn(async () => ok(aiTaskNode)) };
    const sessionStepOutputs = {
      findByMessageId: vi.fn(async () =>
        ok({ fields: [{ key: "summary", label: "Summary", type: "narrative", value: "Partial." }] }),
      ),
    };
    const updateStructuredStepOutput = { execute: vi.fn(async () => structuredResult) };

    const useCase = new ApproverEditSubjectFields(
      approvals as never,
      users as never,
      sessionMessages as never,
      updateDocumentFields as never,
      flowNodes as never,
      { sessionStepOutputs: sessionStepOutputs as never, updateStructuredStepOutput: updateStructuredStepOutput as never },
    );
    return { useCase, sessionMessages, updateDocumentFields, updateStructuredStepOutput };
  };

  const structuredEdit = { messageId: "msg-ai", editedByUserId: "manager-1", values: { summary: "Full summary." } };

  it("rewrites the record through the structured path, not the document path", async () => {
    const { useCase, updateDocumentFields, updateStructuredStepOutput } = buildStructured();

    const result = await useCase.execute(structuredEdit);

    expect(result.error).toBeUndefined();
    expect(updateStructuredStepOutput.execute).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "msg-ai", editedByUserId: "manager-1" }),
    );
    expect(updateDocumentFields.execute).not.toHaveBeenCalled();
  });

  it("announces the fields whose values the approver changed", async () => {
    const { useCase, sessionMessages } = buildStructured();

    await useCase.execute(structuredEdit);

    const posted = sessionMessages.create.mock.calls[0]![0] as { content: string };
    expect(posted.content).toBe("Jane Doe edited this step before deciding the approval: Summary.");
  });

  it("returns the record's field errors without announcing anything", async () => {
    const { useCase, sessionMessages } = buildStructured(
      ok({ ok: false, fieldErrors: [{ key: "summary", message: "Required." }] }),
    );

    const result = await useCase.execute(structuredEdit);

    expect(result.data).toMatchObject({ fieldErrors: [{ key: "summary" }] });
    expect(sessionMessages.create).not.toHaveBeenCalled();
  });
});
