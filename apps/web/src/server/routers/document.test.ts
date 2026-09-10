import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { documentRouter } from "./document";
import { documentEditability } from "./document";

const createCaller = createCallerFactory(router({ document: documentRouter }));

const message = {
  id: "msg-1",
  sessionId: "sess-1",
  stepNodeId: "node-1",
  document: {
    filename: "rft.docx",
    storagePath: "generated/sess-1/rft.docx",
    summary: "s",
    generatedAt: "2026-06-01T00:00:00.000Z",
    editedAt: null,
    editedByUserId: null,
  },
};

const stepOutput = {
  id: "step-1",
  fields: [
    { key: "supplier_name", label: "Supplier Name", type: "text", value: "Acme Ltd" },
    { key: "amount", label: "Amount", type: "currency", value: "$1,000.00" },
  ],
};

const node = {
  id: "node-1",
  config: {
    outputType: "generate_document",
    documentTemplateFields: [
      { key: "supplier_name", label: "Supplier Name", type: "text", optional: false, raw: "Supplier Name" },
      { key: "amount", label: "Amount", type: "currency", optional: false, raw: "Amount" },
    ],
  },
};

const session = { id: "sess-1", status: "active", userId: "user-1" };

const flow = { id: "flow-1", ownerUserId: "user-1", visibility: { kind: "private" } };

const makeContainer = (overrides: Record<string, unknown> = {}): Container =>
  ({
    services: { errorLogger: { log: async () => undefined } },
    repos: {
      sessionMessages: { findById: vi.fn().mockResolvedValue(ok(message)) },
      sessions: { findById: vi.fn().mockResolvedValue(ok(session)) },
      flowNodes: { findById: vi.fn().mockResolvedValue(ok(node)) },
      sessionStepOutputs: { findByMessageId: vi.fn().mockResolvedValue(ok(stepOutput)) },
      approvals: {
        hasRecordedSnapshot: vi.fn().mockResolvedValue(ok(false)),
        listBySession: vi.fn().mockResolvedValue(ok([])),
      },
      users: { findById: vi.fn().mockResolvedValue(ok({ id: "user-1", email: "a@b.c" })) },
    },
    useCases: {
      getSession: { execute: vi.fn().mockResolvedValue(ok({ session, flow, messages: [] })) },
      resolveSessionAccess: {
        execute: vi.fn().mockResolvedValue(ok({ role: "owner", canSend: true, readOnly: false })),
      },
      updateDocumentFields: {
        execute: vi.fn().mockResolvedValue(ok({ document: message.document })),
      },
      approverEditSubjectFields: {
        execute: vi.fn().mockResolvedValue(ok({ document: message.document })),
      },
    },
    ...overrides,
  }) as unknown as Container;

// Simulates a caller the session does not admit at all: no participant access,
// and no pending approval to give them the scoped approver edit right either.
const denyAccess = (container: Container): void => {
  (container.useCases.resolveSessionAccess.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
    err(domainError("FORBIDDEN", "You do not have access to this session.")),
  );
  (
    container.useCases.approverEditSubjectFields.execute as ReturnType<typeof vi.fn>
  ).mockResolvedValue(
    err(domainError("FORBIDDEN", "You may only edit the step your own pending approval is about.")),
  );
};

const contextWith = (container: Container): TrpcContext => ({
  container,
  userId: "user-1",
  isAdmin: false,
  permissions: new Set(),
  headers: new Headers(),
});

describe("documentEditability", () => {
  const editable = {
    sessionStatus: "active" as const,
    allowManualEdit: true,
    hasSnapshot: false,
    hasPendingApproval: false,
    sessionIsOnStep: false,
  };

  it("is editable on an active session, edit allowed, no snapshot", () => {
    expect(documentEditability(editable)).toEqual({ editable: true, reason: null });
  });

  it("blocks a non-active session", () => {
    const result = documentEditability({ ...editable, sessionStatus: "complete" });
    expect(result.editable).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("blocks when the node disables manual editing", () => {
    const result = documentEditability({ ...editable, allowManualEdit: false });
    expect(result.editable).toBe(false);
  });

  it("blocks once the approval chain has settled", () => {
    const result = documentEditability({ ...editable, hasSnapshot: true });
    expect(result.editable).toBe(false);
  });

  // The affordance and the server guard have to agree. They did not: the server
  // let a pending approver edit their own subject step while this reported the
  // document locked, so the dialog refused an edit that would have succeeded.
  it("stays editable while an approval is still pending", () => {
    const result = documentEditability({
      ...editable,
      hasSnapshot: true,
      hasPendingApproval: true,
    });
    expect(result).toEqual({ editable: true, reason: null });
  });

  it("stays editable on the step the session has been routed back to", () => {
    const result = documentEditability({ ...editable, hasSnapshot: true, sessionIsOnStep: true });
    expect(result).toEqual({ editable: true, reason: null });
  });
});

describe("document field authorisation", () => {
  it("rejects getFields for a caller with no access to the message's session", async () => {
    const container = makeContainer();
    denyAccess(container);
    const caller = createCaller(contextWith(container));

    await expect(
      caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects updateFields for a caller with no access to the message's session", async () => {
    const container = makeContainer();
    denyAccess(container);
    const caller = createCaller(contextWith(container));

    await expect(
      caller.document.updateFields({
        messageId: "11111111-1111-1111-1111-111111111111",
        values: { supplier_name: "New Co" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(container.useCases.updateDocumentFields.execute).not.toHaveBeenCalled();
  });

  it("allows getFields for a read-only participant", async () => {
    const container = makeContainer();
    (container.useCases.resolveSessionAccess.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ role: "viewer", canSend: false, readOnly: true }),
    );
    const caller = createCaller(contextWith(container));

    const result = await caller.document.getFields({
      messageId: "11111111-1111-1111-1111-111111111111",
    });

    expect(result.fields).toHaveLength(2);
  });

  it("routes a read-only caller's edit through the scoped approver path", async () => {
    const container = makeContainer();
    (container.useCases.resolveSessionAccess.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ role: "viewer", canSend: false, readOnly: true }),
    );
    const caller = createCaller(contextWith(container));

    await caller.document.updateFields({
      messageId: "11111111-1111-1111-1111-111111111111",
      values: { supplier_name: "New Co" },
    });

    // The scoped path checks the caller holds a pending approval whose subject
    // is this step; the ordinary edit path must not run for a read-only caller.
    expect(container.useCases.approverEditSubjectFields.execute).toHaveBeenCalled();
    expect(container.useCases.updateDocumentFields.execute).not.toHaveBeenCalled();
  });

  it("surfaces the approver path's refusal when the step is not their subject", async () => {
    const container = makeContainer();
    (container.useCases.resolveSessionAccess.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ role: "viewer", canSend: false, readOnly: true }),
    );
    (
      container.useCases.approverEditSubjectFields.execute as ReturnType<typeof vi.fn>
    ).mockResolvedValue(err(domainError("FORBIDDEN", "Not your subject step.")));
    const caller = createCaller(contextWith(container));

    await expect(
      caller.document.updateFields({
        messageId: "11111111-1111-1111-1111-111111111111",
        values: { supplier_name: "New Co" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("document.getFields", () => {
  it("returns each field pre-filled from the step output and editable=true", async () => {
    const caller = createCaller(contextWith(makeContainer()));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.editable).toBe(true);
    expect(result.fields).toEqual([
      expect.objectContaining({ key: "supplier_name", value: "Acme Ltd" }),
      expect.objectContaining({ key: "amount", value: "$1,000.00" }),
    ]);
  });

  it("reports editable=false with a reason once the approval chain has settled", async () => {
    const container = makeContainer();
    (container.repos.approvals.hasRecordedSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(true),
    );
    const caller = createCaller(contextWith(container));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.editable).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("reports editable=true for an approver whose approval is still pending", async () => {
    const container = makeContainer();
    (container.repos.approvals.hasRecordedSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(true),
    );
    (container.repos.approvals.listBySession as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([{ id: "appr-2", status: "pending" }]),
    );
    const caller = createCaller(contextWith(container));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.editable).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("reports editable=true once a change request has routed the session back to the step", async () => {
    const container = makeContainer();
    (container.repos.approvals.hasRecordedSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(true),
    );
    (container.repos.sessions.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ ...session, currentNodeId: "node-1" }),
    );
    const caller = createCaller(contextWith(container));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.editable).toBe(true);
  });

  it("attaches a group field's current items so the editor can seed them", async () => {
    const groupNode = {
      id: "node-1",
      config: {
        outputType: "generate_document",
        documentTemplateFields: [
          {
            key: "suppliers",
            label: "Suppliers",
            type: "group",
            optional: true,
            raw: "#Suppliers (repeat)",
            itemFields: [{ key: "name", label: "Name", type: "text", optional: false, raw: "Name" }],
          },
        ],
      },
    };
    const groupStepOutput = {
      id: "step-1",
      fields: [
        { key: "suppliers", label: "Suppliers", type: "group", value: "", items: [{ name: "Acme" }] },
      ],
    };
    const container = makeContainer();
    (container.repos.flowNodes.findById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(groupNode));
    (container.repos.sessionStepOutputs.findByMessageId as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(groupStepOutput),
    );
    const caller = createCaller(contextWith(container));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.fields).toEqual([
      expect.objectContaining({ key: "suppliers", type: "group", items: [{ name: "Acme" }] }),
    ]);
  });

  it("throws NOT_FOUND when the message has no document", async () => {
    const container = makeContainer();
    (container.repos.sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ ...message, document: null }),
    );
    const caller = createCaller(contextWith(container));

    await expect(caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("document.getFields edit summary", () => {
  const editedMessage = {
    ...message,
    document: {
      ...message.document,
      editedAt: "2026-06-02T09:00:00.000Z",
      editedByUserId: "user-9",
      editHistory: [
        {
          editedAt: "2026-06-02T09:00:00.000Z",
          editedByUserId: "user-9",
          storagePath: "generated/sess-1/rft-r1.docx",
          changes: [{ key: "amount", previousValue: "$1,000.00", newValue: "$1,200.00" }],
        },
      ],
    },
  };

  it("reports no edits for a document nobody has changed", async () => {
    const caller = createCaller(contextWith(makeContainer()));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.editSummary.edits).toEqual([]);
    expect(result.editSummary.untouched.map((field) => field.key)).toEqual([
      "supplier_name",
      "amount",
    ]);
  });

  it("returns each edit with its before and after values and the editor's name", async () => {
    const container = makeContainer();
    (container.repos.sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(editedMessage),
    );
    (container.repos.users.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ id: "user-9", name: "Priya Raman", email: "priya@example.com" }),
    );
    const caller = createCaller(contextWith(container));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.editSummary.edits).toEqual([
      {
        editedAt: "2026-06-02T09:00:00.000Z",
        editedBy: "Priya Raman",
        changes: [
          {
            key: "amount",
            label: "Amount",
            previousValue: "$1,000.00",
            newValue: "$1,200.00",
          },
        ],
      },
    ]);
    expect(result.editSummary.untouched.map((field) => field.key)).toEqual(["supplier_name"]);
  });

  it("falls back to the editor's email when they have no name", async () => {
    const container = makeContainer();
    (container.repos.sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(editedMessage),
    );
    (container.repos.users.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ id: "user-9", name: null, email: "priya@example.com" }),
    );
    const caller = createCaller(contextWith(container));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.editSummary.edits[0]!.editedBy).toBe("priya@example.com");
  });

  // A deleted account must not cost the originator the record of what changed.
  it("still returns the changes when the editor can no longer be resolved", async () => {
    const container = makeContainer();
    (container.repos.sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(editedMessage),
    );
    (container.repos.users.findById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(null));
    const caller = createCaller(contextWith(container));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.editSummary.edits[0]!.editedBy).toBeNull();
    expect(result.editSummary.edits[0]!.changes).toHaveLength(1);
  });
});

describe("document.updateFields", () => {
  it("returns the updated document on success", async () => {
    const caller = createCaller(contextWith(makeContainer()));

    const result = await caller.document.updateFields({
      messageId: "11111111-1111-1111-1111-111111111111",
      values: { supplier_name: "New Co", amount: "$2.00" },
    });

    expect(result.ok).toBe(true);
    expect(result.document?.filename).toBe("rft.docx");
  });

  it("returns per-field errors without throwing when validation fails", async () => {
    const container = makeContainer();
    (container.useCases.updateDocumentFields.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ fieldErrors: [{ key: "amount", message: "Amount must be a number." }] }),
    );
    const caller = createCaller(contextWith(container));

    const result = await caller.document.updateFields({
      messageId: "11111111-1111-1111-1111-111111111111",
      values: { amount: "x" },
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual([{ key: "amount", message: "Amount must be a number." }]);
  });

  it("passes the authenticated user as the editor", async () => {
    const container = makeContainer();
    const caller = createCaller(contextWith(container));

    await caller.document.updateFields({ messageId: "11111111-1111-1111-1111-111111111111", values: { supplier_name: "X" } });

    expect(container.useCases.updateDocumentFields.execute).toHaveBeenCalledWith(
      expect.objectContaining({ editedByUserId: "user-1", messageId: "11111111-1111-1111-1111-111111111111" }),
    );
  });

  it("forwards edited group items to the use case", async () => {
    const container = makeContainer();
    const caller = createCaller(contextWith(container));

    const groupItems = { suppliers: [{ name: "Acme" }, { name: "Globex" }] };
    await caller.document.updateFields({
      messageId: "11111111-1111-1111-1111-111111111111",
      values: { supplier_name: "X" },
      groupItems,
    });

    expect(container.useCases.updateDocumentFields.execute).toHaveBeenCalledWith(
      expect.objectContaining({ groupItems }),
    );
  });
});
