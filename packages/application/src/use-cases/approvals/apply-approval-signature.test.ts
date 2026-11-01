import { describe, expect, it, vi } from "vitest";
import { ok, type Approval, type TemplateField } from "@wayfinder/domain";
import { ApplyApprovalSignature } from "./apply-approval-signature";

const at = (iso: string) => new Date(iso);

const field = (key: string, type: TemplateField["type"] = "text"): TemplateField => ({
  key,
  label: key,
  type,
  optional: type === "signature",
  raw: key,
});

const templateFields = [
  field("amount"),
  field("delegate_signature", "signature"),
  field("finance_signature", "signature"),
];

const approval = (overrides: Partial<Approval> = {}): Approval =>
  ({
    id: "approval-a",
    sessionId: "sess-1",
    flowId: "flow-1",
    nodeId: "node-appr-a",
    messageId: null,
    requestedByUserId: "user-1",
    approverSource: "first_level_supervisor",
    suggestedApproverUserId: null,
    approverUserId: "manager-1",
    approverEmail: null,
    isOverride: false,
    status: "approved",
    decidedByUserId: "manager-1",
    decidedAt: at("2026-08-01T14:32:00Z"),
    comment: null,
    recordSnapshot: {
      subjectNodeId: "node-draft",
      signatureFieldKey: "delegate_signature",
      attestationText: "Approved by:   Jane Doe\nDecision:      Approved",
    },
    createdAt: at("2026-08-01T12:00:00Z"),
    updatedAt: at("2026-08-01T14:32:00Z"),
    ...overrides,
  }) as Approval;

interface Fakes {
  rows: Approval[];
  templateFields: TemplateField[];
  documentPath: string | null;
}

const build = (overrides: Partial<Fakes> = {}) => {
  const fakes: Fakes = {
    rows: [approval()],
    templateFields,
    documentPath: "generated/sess-1/instrument.docx",
    ...overrides,
  };

  const approvals = {
    findById: vi.fn(async (id: string) => ok(fakes.rows.find((row) => row.id === id) ?? null)),
    listBySession: vi.fn(async () => ok(fakes.rows)),
  };
  const flowNodes = {
    findById: vi.fn(async () =>
      ok({
        id: "node-draft",
        config: {
          outputType: "generate_document",
          documentTemplatePath: "templates/instrument.docx",
          documentTemplateFields: fakes.templateFields,
        },
      }),
    ),
  };
  const updatedDocuments: Array<{ messageId: string; storagePath: string }> = [];
  const sessionMessages = {
    listBySession: vi.fn(async () =>
      ok(
        fakes.documentPath
          ? [
              {
                id: "msg-1",
                stepNodeId: "node-draft",
                createdAt: at("2026-08-01T11:00:00Z"),
                document: {
                  filename: "instrument.docx",
                  storagePath: fakes.documentPath,
                  summary: "s",
                  generatedAt: "2026-08-01T11:00:00.000Z",
                },
              },
            ]
          : [],
      ),
    ),
    updateDocument: vi.fn(async (messageId: string, document: { storagePath: string }) => {
      updatedDocuments.push({ messageId, storagePath: document.storagePath });
      return ok({ id: messageId });
    }),
  };
  const sessionStepOutputs = {
    findByMessageId: vi.fn(async () =>
      ok({
        id: "out-1",
        fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
      }),
    ),
  };
  const rendered: Array<Record<string, unknown>> = [];
  const documentGenerator = {
    generate: vi.fn((input: { data: Record<string, unknown> }) => {
      rendered.push(input.data);
      return ok({ bytes: Buffer.from("docx") });
    }),
  };
  const stored: string[] = [];
  const objectStorage = {
    get: vi.fn(async () => ok(Buffer.from("template"))),
    put: vi.fn(async (path: string) => {
      stored.push(path);
      return ok(undefined);
    }),
  };

  const useCase = new ApplyApprovalSignature(
    approvals as never,
    flowNodes as never,
    sessionMessages as never,
    sessionStepOutputs as never,
    documentGenerator as never,
    objectStorage as never,
  );

  return { useCase, fakes, rendered, stored, updatedDocuments, sessionMessages, documentGenerator };
};

describe("ApplyApprovalSignature", () => {
  it("renders the deciding approval's attestation into its own slot", async () => {
    const { useCase, rendered } = build();

    const result = await useCase.execute({ approvalId: "approval-a" });

    expect(result.data).toMatchObject({ applied: true });
    expect(rendered[0]!.delegate_signature).toContain("Jane Doe");
  });

  it("leaves an undecided slot empty rather than implying an approval", async () => {
    const { useCase, rendered } = build();

    await useCase.execute({ approvalId: "approval-a" });

    expect(rendered[0]!.finance_signature).toBe("");
  });

  it("keeps the gathered values on the re-rendered document", async () => {
    const { useCase, rendered } = build();

    await useCase.execute({ approvalId: "approval-a" });

    expect(rendered[0]!.amount).toBe("$1,200");
  });

  it("writes a new revision and repoints the message so later steps see the signed copy", async () => {
    const { useCase, stored, updatedDocuments } = build();

    await useCase.execute({ approvalId: "approval-a" });

    expect(stored).toEqual(["generated/sess-1/instrument-r1.docx"]);
    expect(updatedDocuments).toEqual([
      { messageId: "msg-1", storagePath: "generated/sess-1/instrument-r1.docx" },
    ]);
  });

  it("carries an earlier approval's signature into a later one's revision", async () => {
    const finance = approval({
      id: "approval-b",
      nodeId: "node-appr-b",
      recordSnapshot: {
        subjectNodeId: "node-draft",
        signatureFieldKey: "finance_signature",
        attestationText: "Approved by:   Sam Patel\nDecision:      Approved",
      },
    });
    const { useCase, rendered } = build({ rows: [approval(), finance] });

    await useCase.execute({ approvalId: "approval-b" });

    expect(rendered[0]!.delegate_signature).toContain("Jane Doe");
    expect(rendered[0]!.finance_signature).toContain("Sam Patel");
  });

  it("ignores a still-pending approval's slot", async () => {
    const pending = approval({
      id: "approval-b",
      nodeId: "node-appr-b",
      status: "pending",
      recordSnapshot: {
        subjectNodeId: "node-draft",
        signatureFieldKey: "finance_signature",
        attestationText: "should never be rendered",
      },
    });
    const { useCase, rendered } = build({ rows: [approval(), pending] });

    await useCase.execute({ approvalId: "approval-a" });

    expect(rendered[0]!.finance_signature).toBe("");
  });

  it("does nothing when the approval targets no signature slot", async () => {
    const { useCase, documentGenerator } = build({
      rows: [approval({ recordSnapshot: { subjectNodeId: "node-draft" } })],
    });

    const result = await useCase.execute({ approvalId: "approval-a" });

    expect(result.data).toEqual({ applied: false, reason: "no_signature_slot" });
    expect(documentGenerator.generate).not.toHaveBeenCalled();
  });

  it("does nothing when the subject step produced no document", async () => {
    const { useCase, documentGenerator } = build({ documentPath: null });

    const result = await useCase.execute({ approvalId: "approval-a" });

    expect(result.data).toEqual({ applied: false, reason: "no_document" });
    expect(documentGenerator.generate).not.toHaveBeenCalled();
  });

  it("does nothing when the template no longer declares the configured slot", async () => {
    const { useCase, documentGenerator } = build({ templateFields: [field("amount")] });

    const result = await useCase.execute({ approvalId: "approval-a" });

    expect(result.data).toEqual({ applied: false, reason: "no_signature_slot" });
    expect(documentGenerator.generate).not.toHaveBeenCalled();
  });

  it("reports NOT_FOUND for an approval that does not exist", async () => {
    const { useCase } = build();

    const result = await useCase.execute({ approvalId: "missing" });

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
