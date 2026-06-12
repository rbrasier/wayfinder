import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
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

const session = { id: "sess-1", status: "active" };

const makeContainer = (overrides: Record<string, unknown> = {}): Container =>
  ({
    services: { errorLogger: { log: async () => undefined } },
    repos: {
      sessionMessages: { findById: vi.fn().mockResolvedValue(ok(message)) },
      sessions: { findById: vi.fn().mockResolvedValue(ok(session)) },
      flowNodes: { findById: vi.fn().mockResolvedValue(ok(node)) },
      sessionStepOutputs: { findByMessageId: vi.fn().mockResolvedValue(ok(stepOutput)) },
      approvals: { hasRecordedSnapshot: vi.fn().mockResolvedValue(ok(false)) },
    },
    useCases: {
      updateDocumentFields: {
        execute: vi.fn().mockResolvedValue(ok({ document: message.document })),
      },
    },
    ...overrides,
  }) as unknown as Container;

const contextWith = (container: Container): TrpcContext => ({
  container,
  userId: "user-1",
  isAdmin: false,
  permissions: new Set(),
  headers: new Headers(),
});

describe("documentEditability", () => {
  it("is editable on an active session, edit allowed, no snapshot", () => {
    expect(
      documentEditability({ sessionStatus: "active", allowManualEdit: true, hasSnapshot: false }),
    ).toEqual({ editable: true, reason: null });
  });

  it("blocks a non-active session", () => {
    const result = documentEditability({
      sessionStatus: "complete",
      allowManualEdit: true,
      hasSnapshot: false,
    });
    expect(result.editable).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("blocks when the node disables manual editing", () => {
    const result = documentEditability({
      sessionStatus: "active",
      allowManualEdit: false,
      hasSnapshot: false,
    });
    expect(result.editable).toBe(false);
  });

  it("blocks once an approval snapshot exists", () => {
    const result = documentEditability({
      sessionStatus: "active",
      allowManualEdit: true,
      hasSnapshot: true,
    });
    expect(result.editable).toBe(false);
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

  it("reports editable=false with a reason when a snapshot exists", async () => {
    const container = makeContainer();
    (container.repos.approvals.hasRecordedSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(true),
    );
    const caller = createCaller(contextWith(container));

    const result = await caller.document.getFields({ messageId: "11111111-1111-1111-1111-111111111111" });

    expect(result.editable).toBe(false);
    expect(result.reason).toBeTruthy();
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
});
