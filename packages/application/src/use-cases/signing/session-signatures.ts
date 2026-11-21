import {
  badgeForReport,
  ok,
  SIGNATURE_FAILURE_MESSAGES,
  type Approval,
  type DigitalSignatureRecord,
  type EngineSignatureReport,
  type ICsvWriter,
  type Result,
  type SignatureFailureReason,
  type SignatureValidation,
  type SignerCertificate,
} from "@wayfinder/domain";
import type { CertificateSigningDeps } from "./certificate-signing-deps";

export interface SessionSignature {
  approvalId: string;
  stepName: string;
  status: DigitalSignatureRecord["status"];
  method: DigitalSignatureRecord["method"];
  signedBy: string | null;
  certificate: SignerCertificate | null;
  signedAt: string | null;
  timestampTime: string | null;
  level: string | null;
  validation: SignatureValidation | null;
  rejectionReason: SignatureFailureReason | null;
}

const commonName = (distinguishedName: string | undefined): string | null =>
  distinguishedName ? (/CN=([^,]+)/.exec(distinguishedName)?.[1]?.trim() ?? null) : null;

const signedApprovals = async (deps: CertificateSigningDeps, sessionId: string): Promise<Result<Approval[]>> => {
  const approvals = await deps.approvals.listBySession(sessionId);
  if (approvals.error) return approvals;
  return ok(approvals.data.filter((approval) => approval.digitalSignature));
};

// Every signature on a session's documents, and every refused attempt — what
// the Signatures panel shows (PRD §3).
export class ListSessionSignatures {
  constructor(private readonly deps: CertificateSigningDeps) {}

  async execute(sessionId: string): Promise<Result<SessionSignature[]>> {
    const found = await signedApprovals(this.deps, sessionId);
    if (found.error) return found;
    const entries: SessionSignature[] = [];
    for (const approval of found.data) {
      const record = approval.digitalSignature!;
      const node = await this.deps.flowNodes.findById(approval.nodeId);
      entries.push({
        approvalId: approval.id,
        stepName: node.error ? "" : (node.data?.name ?? ""),
        status: record.status,
        method: record.method,
        signedBy: commonName(record.certificate?.subject),
        certificate: record.certificate ?? null,
        signedAt: record.signedAt ?? null,
        timestampTime: record.timestampTime ?? null,
        level: record.level ?? null,
        validation: record.validation ?? null,
        rejectionReason: record.rejection?.reason ?? null,
      });
    }
    return ok(entries);
  }
}

const sameSecond = (first: string | null | undefined, second: string | null | undefined): boolean =>
  Boolean(first && second && first.slice(0, 19) === second.slice(0, 19));

const reportFor = (record: DigitalSignatureRecord, reports: EngineSignatureReport[]): EngineSignatureReport | null =>
  reports.find(
    (report) =>
      report.certificate?.sha256 === record.certificate?.sha256 &&
      (!record.signedAt || sameSecond(report.signingTime, record.signedAt)),
  ) ?? null;

// Re-checks every signature against the document as it stands now (PRD §3).
// A signature missing from the current PDF reads as modified; an engine that
// cannot be reached reads as unverifiable — never as the last good result.
export class RevalidateSessionSignatures {
  constructor(private readonly deps: CertificateSigningDeps) {}

  async execute(input: { sessionId: string; actorId: string }): Promise<Result<void>> {
    const found = await signedApprovals(this.deps, input.sessionId);
    if (found.error) return found;
    const signed = found.data.filter((approval) => approval.digitalSignature?.status === "signed");
    if (signed.length === 0) return ok(undefined);

    const reports = await this.currentReports(input.sessionId);
    const checkedAt = this.deps.now().toISOString();
    for (const approval of signed) {
      const record = approval.digitalSignature!;
      const validation = this.verdict(record, reports, checkedAt);
      await this.deps.approvals.update(approval.id, { digitalSignature: { ...record, validation } });
      await this.deps.auditLogger.log({
        actorId: input.actorId,
        action: "signature.validated",
        resourceType: "approval",
        resourceId: approval.id,
        metadata: { badge: validation.badge, reason: validation.reason },
      });
    }
    return ok(undefined);
  }

  private verdict(record: DigitalSignatureRecord, reports: EngineSignatureReport[] | null, checkedAt: string): SignatureValidation {
    if (!reports) return { badge: "unverifiable", reason: "unavailable", checkedAt };
    const report = reportFor(record, reports);
    if (!report) return { badge: "invalid-modified", reason: "modified", checkedAt };
    return { ...badgeForReport(report, this.deps.now()), checkedAt };
  }

  // Reports for every frozen PDF in the session, or null when any of them
  // could not be checked.
  private async currentReports(sessionId: string): Promise<EngineSignatureReport[] | null> {
    const config = await this.deps.loadSignatureConfig();
    const messages = await this.deps.sessionMessages.listBySession(sessionId);
    if (messages.error) return null;
    const reports: EngineSignatureReport[] = [];
    for (const message of messages.data) {
      const pdf = message.document?.pdf;
      if (pdf?.status !== "frozen" || !pdf.storagePath) continue;
      const bytes = await this.deps.objectStorage.get(pdf.storagePath);
      if (bytes.error) return null;
      const validated = await this.deps.engine.validate(config.signatureEngine, bytes.data);
      if (validated.error) return null;
      reports.push(...validated.data);
    }
    return reports;
  }
}

const EXPORT_COLUMNS = [
  ["session_id", "Session"],
  ["approval_id", "Approval"],
  ["step", "Step"],
  ["status", "Status"],
  ["method", "Method"],
  ["signed_by", "Signed by"],
  ["certificate_subject", "Certificate subject"],
  ["certificate_issuer", "Certificate issuer"],
  ["certificate_serial", "Certificate serial"],
  ["certificate_sha256", "Certificate SHA-256"],
  ["certificate_not_after", "Certificate expires"],
  ["signed_at", "Signed at"],
  ["timestamp_time", "Timestamp"],
  ["level", "Signature level"],
  ["badge", "Validation"],
  ["reason", "Reason"],
  ["checked_at", "Checked at"],
] as const;

export type SignatureMetadataRow = Record<(typeof EXPORT_COLUMNS)[number][0], string>;

// Signature metadata for audit (PRD §3), as CSV through the CSV writer port
// (ADR-054) and as records for a JSON download. Column order is fixed, so two
// exports are comparable line by line.
export class ExportSignatureMetadata {
  constructor(
    private readonly deps: CertificateSigningDeps,
    private readonly csvWriter: ICsvWriter,
  ) {}

  async execute(sessionId: string): Promise<Result<{ csv: Buffer; records: SignatureMetadataRow[] }>> {
    const listed = await new ListSessionSignatures(this.deps).execute(sessionId);
    if (listed.error) return listed;
    const records: SignatureMetadataRow[] = listed.data.map((entry) => ({
      session_id: sessionId,
      approval_id: entry.approvalId,
      step: entry.stepName,
      status: entry.status,
      method: entry.method,
      signed_by: entry.signedBy ?? "",
      certificate_subject: entry.certificate?.subject ?? "",
      certificate_issuer: entry.certificate?.issuer ?? "",
      certificate_serial: entry.certificate?.serialNumber ?? "",
      certificate_sha256: entry.certificate?.sha256 ?? "",
      certificate_not_after: entry.certificate?.notAfter ?? "",
      signed_at: entry.signedAt ?? "",
      timestamp_time: entry.timestampTime ?? "",
      level: entry.level ?? "",
      badge: entry.validation?.badge ?? "",
      reason: entry.validation?.reason
        ? SIGNATURE_FAILURE_MESSAGES[entry.validation.reason]
        : entry.rejectionReason
          ? SIGNATURE_FAILURE_MESSAGES[entry.rejectionReason]
          : "",
      checked_at: entry.validation?.checkedAt ?? "",
    }));
    const written = this.csvWriter.write({
      columns: EXPORT_COLUMNS.map(([key, label]) => ({ key, label })),
      rows: records,
    });
    if (written.error) return written;
    return ok({ csv: written.data.bytes, records });
  }
}
