import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIGNATURE_CONFIG,
  domainError,
  err,
  ok,
  type Approval,
  type SessionDocumentPdf,
  type SignatureMethod,
  type TemplateField,
} from "@wayfinder/domain";
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
  approvalNodeConfig: Record<string, unknown>;
  method: SignatureMethod;
  existingPdf: SessionDocumentPdf | null;
  pdfFails: boolean;
  withPdfRendering: boolean;
}

const build = (overrides: Partial<Fakes> = {}) => {
  const fakes: Fakes = {
    rows: [approval()],
    templateFields,
    documentPath: "generated/sess-1/instrument.docx",
    approvalNodeConfig: { approverSource: "first_level_supervisor" },
    method: "attestation",
    existingPdf: null,
    pdfFails: false,
    withPdfRendering: true,
    ...overrides,
  };

  const approvals = {
    findById: vi.fn(async (id: string) => ok(fakes.rows.find((row) => row.id === id) ?? null)),
    listBySession: vi.fn(async () => ok(fakes.rows)),
  };
  const flowNodes = {
    findById: vi.fn(async (id: string) =>
      ok(id === "node-appr-a" ? { id, config: fakes.approvalNodeConfig } : {
        id: "node-draft",
        config: {
          outputType: "generate_document",
          documentTemplatePath: "templates/instrument.docx",
          documentTemplateFields: fakes.templateFields,
        },
      }),
    ),
  };
  const updatedDocuments: Array<{ messageId: string; storagePath: string; pdf?: SessionDocumentPdf }> = [];
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
                  ...(fakes.existingPdf ? { pdf: fakes.existingPdf } : {}),
                },
              },
            ]
          : [],
      ),
    ),
    updateDocument: vi.fn(async (messageId: string, document: { storagePath: string; pdf?: SessionDocumentPdf }) => {
      updatedDocuments.push({ messageId, storagePath: document.storagePath, pdf: document.pdf });
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
  const renderedImages: Array<Record<string, Buffer> | undefined> = [];
  const documentGenerator = {
    generate: vi.fn((input: { data: Record<string, unknown>; images?: Record<string, Buffer> }) => {
      rendered.push(input.data);
      renderedImages.push(input.images);
      return ok({ bytes: Buffer.from("docx") });
    }),
  };
  const stored: string[] = [];
  const objectStorage = {
    get: vi.fn(async (path: string) => ok(Buffer.from(path.endsWith(".png") ? "drawing" : "template"))),
    put: vi.fn(async (path: string) => {
      stored.push(path);
      return ok(undefined);
    }),
  };

  const converter = {
    convertDocxToPdfA: vi.fn(async () =>
      fakes.pdfFails
        ? err(domainError("INFRA_FAILURE", "Gotenberg is unreachable."))
        : ok(Buffer.from("%PDF-1.7")),
    ),
  };

  const useCase = new ApplyApprovalSignature(
    approvals as never,
    flowNodes as never,
    sessionMessages as never,
    sessionStepOutputs as never,
    documentGenerator as never,
    objectStorage as never,
    fakes.withPdfRendering
      ? {
          converter,
          loadSignatureConfig: async () => ({ ...DEFAULT_SIGNATURE_CONFIG, method: fakes.method }),
          hashBytes: (bytes: Buffer) => `sha-of-${bytes.length}`,
        }
      : undefined,
  );

  return {
    useCase,
    fakes,
    rendered,
    renderedImages,
    stored,
    updatedDocuments,
    sessionMessages,
    documentGenerator,
    converter,
  };
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

  it("passes the deciding approval's frozen drawing to the renderer for its slot", async () => {
    const drawn = approval({
      recordSnapshot: {
        subjectNodeId: "node-draft",
        signatureFieldKey: "delegate_signature",
        attestationText: "Approved by:   Jane Doe",
        drawnSignatureStoragePath: "signatures/drawn/manager-1/1.png",
      },
    });
    const { useCase, renderedImages } = build({ rows: [drawn] });

    await useCase.execute({ approvalId: "approval-a" });

    expect(renderedImages[0]?.delegate_signature?.toString()).toBe("drawing");
  });

  it("renders a PDF beside the signed revision when the approval step converts on signing", async () => {
    const { useCase, stored, updatedDocuments, converter } = build({
      approvalNodeConfig: { approverSource: "first_level_supervisor", convertToPdfOnSigning: true },
    });

    await useCase.execute({ approvalId: "approval-a" });

    expect(converter.convertDocxToPdfA).toHaveBeenCalledTimes(1);
    expect(stored).toContain("generated/sess-1/instrument-r1.pdf");
    expect(updatedDocuments[0]?.pdf).toMatchObject({
      storagePath: "generated/sess-1/instrument-r1.pdf",
      sha256: "sha-of-8",
      status: "rendered",
    });
  });

  it("does not convert when the step leaves the toggle off", async () => {
    const { useCase, converter, updatedDocuments } = build();

    await useCase.execute({ approvalId: "approval-a" });

    expect(converter.convertDocxToPdfA).not.toHaveBeenCalled();
    expect(updatedDocuments[0]?.pdf).toBeUndefined();
  });

  it("keeps an existing rendered PDF current even when this step's toggle is off", async () => {
    const { useCase, converter } = build({
      existingPdf: { storagePath: "generated/sess-1/instrument.pdf", sha256: "x", generatedAt: "t", status: "rendered" },
    });

    await useCase.execute({ approvalId: "approval-a" });

    expect(converter.convertDocxToPdfA).toHaveBeenCalledTimes(1);
  });

  it("records a failed conversion on the document instead of losing the signed docx", async () => {
    const { useCase, updatedDocuments } = build({
      approvalNodeConfig: { approverSource: "first_level_supervisor", convertToPdfOnSigning: true },
      pdfFails: true,
    });

    const result = await useCase.execute({ approvalId: "approval-a" });

    expect(result.data?.applied).toBe(true);
    expect(updatedDocuments[0]?.storagePath).toBe("generated/sess-1/instrument-r1.docx");
    expect(updatedDocuments[0]?.pdf).toMatchObject({
      status: "failed",
      storagePath: null,
      failureReason: "Gotenberg is unreachable.",
    });
  });

  it("never re-renders a document frozen for certificate signing", async () => {
    const { useCase, documentGenerator } = build({
      existingPdf: { storagePath: "generated/sess-1/instrument.pdf", sha256: "x", generatedAt: "t", status: "frozen" },
    });

    const result = await useCase.execute({ approvalId: "approval-a" });

    expect(result.data).toEqual({ applied: false, reason: "frozen" });
    expect(documentGenerator.generate).not.toHaveBeenCalled();
  });
});
