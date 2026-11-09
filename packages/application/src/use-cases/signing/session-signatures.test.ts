import { describe, expect, it } from "vitest";
import { ok, type CsvTable, type DigitalSignatureRecord, type ICsvWriter } from "@wayfinder/domain";
import { ExportSignatureMetadata, ListSessionSignatures, RevalidateSessionSignatures } from "./session-signatures";
import { passedReport, seed, type SigningContext } from "./__fixtures__/certificate-signing-doubles";

const signedRecord = (overrides: Partial<DigitalSignatureRecord> = {}): DigitalSignatureRecord => ({
  status: "signed",
  method: "certificate",
  certificate: passedReport.certificate!,
  signedAt: "2026-11-08T10:00:00Z",
  timestampTime: "2026-11-08T10:00:01Z",
  level: "PAdES_BASELINE_LTA",
  pdfStoragePath: "generated/session-1/instrument-signed-r1.pdf",
  validation: { badge: "valid", reason: null, checkedAt: "2026-11-08T10:00:02Z" },
  ...overrides,
});

const withSignedDocument = async (context: SigningContext, record = signedRecord()) => {
  await context.approvals.update(context.approvalId, { status: "approved", digitalSignature: record });
  await context.storage.put("generated/session-1/instrument-signed-r1.pdf", Buffer.from("%PDF-signed"), "application/pdf");
  const message = context.messages.rows[0]!;
  message.document = {
    ...message.document!,
    pdf: { storagePath: "generated/session-1/instrument-signed-r1.pdf", sha256: "x", generatedAt: "t", status: "frozen" },
  };
};

const capturingCsv = (): ICsvWriter & { tables: CsvTable[] } => {
  const tables: CsvTable[] = [];
  return {
    tables,
    write: (table) => {
      tables.push(table);
      return ok({ bytes: Buffer.from(table.rows.map((row) => Object.values(row).join(",")).join("\n")) });
    },
  };
};

describe("ListSessionSignatures", () => {
  it("lists each signature with its signer, certificate, time and badge", async () => {
    const context = await seed();
    await withSignedDocument(context);

    const result = await new ListSessionSignatures(context.deps).execute("session-1");

    expect(result.data).toEqual([
      {
        approvalId: context.approvalId,
        stepName: "Manager sign-off",
        status: "signed",
        method: "certificate",
        signedBy: "Jane Doe",
        certificate: passedReport.certificate,
        signedAt: "2026-11-08T10:00:00Z",
        timestampTime: "2026-11-08T10:00:01Z",
        level: "PAdES_BASELINE_LTA",
        validation: { badge: "valid", reason: null, checkedAt: "2026-11-08T10:00:02Z" },
        rejectionReason: null,
      },
    ]);
  });

  it("includes a refused attempt with its reason, and leaves out approvals that never signed", async () => {
    const context = await seed();
    await context.approvals.update(context.approvalId, {
      digitalSignature: { status: "rejected", method: "certificate", rejection: { reason: "revoked", at: "t" } },
    });

    const result = await new ListSessionSignatures(context.deps).execute("session-1");

    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toMatchObject({ status: "rejected", rejectionReason: "revoked", validation: null });
  });
});

describe("RevalidateSessionSignatures", () => {
  it("re-checks the current signed PDF and records the fresh verdict", async () => {
    const context = await seed();
    await withSignedDocument(context);
    context.engine.report = { ...passedReport, certificate: { ...passedReport.certificate!, notAfter: "2026-01-01T00:00:00Z" } };

    const result = await new RevalidateSessionSignatures(context.deps).execute({ sessionId: "session-1", actorId: "auditor-1" });

    expect(result.error).toBeUndefined();
    const validation = context.approvals.rows.get(context.approvalId)!.digitalSignature!.validation!;
    expect(validation).toMatchObject({ badge: "valid-but-expired", reason: "expired", checkedAt: "2026-11-08T10:00:00.000Z" });
    expect(context.audit.entries.find((entry) => entry.action === "signature.validated")).toMatchObject({
      actorId: "auditor-1",
      resourceId: context.approvalId,
      metadata: { badge: "valid-but-expired", reason: "expired" },
    });
  });

  it("marks a signature unverifiable rather than stale-valid when the engine cannot be reached", async () => {
    const context = await seed();
    await withSignedDocument(context);
    context.engine.validate = async () => ({ error: { code: "INFRA_FAILURE", message: "The signature engine is unreachable." } });

    await new RevalidateSessionSignatures(context.deps).execute({ sessionId: "session-1", actorId: "auditor-1" });

    expect(context.approvals.rows.get(context.approvalId)!.digitalSignature!.validation).toMatchObject({
      badge: "unverifiable",
      reason: "unavailable",
    });
  });

  it("reports a signature missing from the current PDF as modified", async () => {
    const context = await seed();
    await withSignedDocument(context);
    context.engine.report = { ...passedReport, certificate: { ...passedReport.certificate!, sha256: "someone-else" } };

    await new RevalidateSessionSignatures(context.deps).execute({ sessionId: "session-1", actorId: "auditor-1" });

    expect(context.approvals.rows.get(context.approvalId)!.digitalSignature!.validation).toMatchObject({
      badge: "invalid-modified",
      reason: "modified",
    });
  });
});

describe("ExportSignatureMetadata", () => {
  it("writes one row per signature with stable columns, as CSV and as records", async () => {
    const context = await seed();
    await withSignedDocument(context);
    const csv = capturingCsv();

    const result = await new ExportSignatureMetadata(context.deps, csv).execute("session-1");

    expect(csv.tables[0]!.columns.map((column) => column.key)).toEqual([
      "session_id",
      "approval_id",
      "step",
      "status",
      "method",
      "signed_by",
      "certificate_subject",
      "certificate_issuer",
      "certificate_serial",
      "certificate_sha256",
      "certificate_not_after",
      "signed_at",
      "timestamp_time",
      "level",
      "badge",
      "reason",
      "checked_at",
    ]);
    expect(result.data!.records[0]).toMatchObject({
      session_id: "session-1",
      approval_id: context.approvalId,
      signed_by: "Jane Doe",
      certificate_serial: "4096",
      badge: "valid",
    });
    expect(result.data!.csv.length).toBeGreaterThan(0);
  });
});
