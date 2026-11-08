import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  DEFAULT_SIGNATURE_CONFIG,
  domainError,
  err,
  ok,
  type CertificateCheck,
  type EngineSignatureReport,
  type IPdfAnchorLocator,
  type IPdfConverter,
  type IRemoteSigningProvider,
  type ISignatureEngine,
  type Result,
  type SignatureConfig,
} from "@wayfinder/domain";
import {
  InMemoryApprovals,
  InMemoryFlowNodes,
  InMemoryMessages,
  InMemoryStepOutputs,
  InMemoryUsers,
  RecordingAuditLogger,
  approvalNode,
  user,
} from "../approvals/__fixtures__/approval-doubles";
import { InMemoryObjectStorage } from "../__fixtures__/presentation-doubles";
import { ResolveApprovalSubject } from "../approvals/resolve-approval-subject";
import type { DecideApprovalInput } from "../approvals/decide-approval";
import { StartCertificateSigning } from "./start-certificate-signing";
import { CompleteCertificateSigning } from "./complete-certificate-signing";
import type { CertificateSigningDeps } from "./certificate-signing-deps";

const sha256Hex = (input: string) => createHash("sha256").update(input, "utf8").digest("hex");

const CERTIFICATE_CONFIG: SignatureConfig = {
  ...DEFAULT_SIGNATURE_CONFIG,
  method: "certificate",
  gotenbergUrl: "http://gotenberg",
  dssUrl: "http://dss",
  tsaUrl: "http://tsa",
  csc: { baseUrl: "http://csc/v2", clientId: "wayfinder", clientSecret: "secret" },
};

const passedCheck: CertificateCheck = {
  keyUsageAllowsSigning: true,
  validNow: true,
  revoked: false,
  indication: "PASSED",
  subIndication: null,
};

const passedReport: EngineSignatureReport = {
  id: "S-1",
  indication: "TOTAL_PASSED",
  subIndication: null,
  signedBy: "Jane Doe",
  signingTime: "2026-11-08T10:00:00Z",
  level: "PAdES_BASELINE_LTA",
  timestampTimes: ["2026-11-08T10:00:01Z"],
  certificate: { subject: "CN=Jane Doe", issuer: "CN=Root", serialNumber: "4096", notAfter: "2027-11-08T00:00:00Z", sha256: "ab" },
};

class FakeProvider implements IRemoteSigningProvider {
  readonly signed: string[] = [];
  async authorizationUrl(_config: unknown, request: { scope: string; state: string; hash?: string }) {
    return ok(`http://csc/authorize?scope=${request.scope}&state=${encodeURIComponent(request.state)}&hash=${request.hash ?? ""}`);
  }
  async exchangeCode(_config: unknown, code: string) {
    return code === "bad" ? err(domainError("INFRA_FAILURE", "The signing provider refused: invalid_grant")) : ok(`token-${code}`);
  }
  async firstCredential() {
    return ok("valid");
  }
  async certificateChain() {
    return ok(["c2lnbmVy", "cm9vdA=="]);
  }
  async signHash(_config: unknown, _token: string, _credential: string, hash: string) {
    this.signed.push(hash);
    return ok("c2lnbmF0dXJl");
  }
}

class FakeEngine implements ISignatureEngine {
  check: CertificateCheck = passedCheck;
  report: EngineSignatureReport = passedReport;
  prepared: Array<{ signingTime: string; appearance: unknown }> = [];
  signedWith: Array<{ signingTime: string; appearance: unknown; signatureValue: string }> = [];
  async prepare(parameters: { signingTime: string; appearance: unknown }) {
    this.prepared.push(parameters);
    return ok({ dataToSignDigest: "ZGlnZXN0", certificateCheck: this.check });
  }
  async sign(parameters: { pdf: Buffer; signingTime: string; appearance: unknown; signatureValue: string }) {
    this.signedWith.push(parameters);
    return ok(Buffer.concat([parameters.pdf, Buffer.from("\n%signed")]));
  }
  async validate(): Promise<Result<EngineSignatureReport[]>> {
    return ok([this.report]);
  }
}

const converter: IPdfConverter = { convertDocxToPdfA: async () => ok(Buffer.from("%PDF-frozen")) };
const locator: IPdfAnchorLocator = {
  locate: async (_pdf, markers) =>
    ok(Object.fromEntries(markers.map((marker) => [marker, { page: 1, x: 72, y: 500, width: 100, height: 12 }]))),
};

const seed = async () => {
  const approvals = new InMemoryApprovals();
  const nodes = new InMemoryFlowNodes();
  nodes.add(approvalNode({ id: "node-appr", config: { approverSource: "first_level_supervisor", signatureFieldKey: "delegate_signature" } }));
  nodes.add(
    approvalNode({
      id: "node-draft",
      type: "conversational",
      name: "Prepare instrument",
      config: {
        outputType: "generate_document",
        documentTemplatePath: "templates/instrument.docx",
        documentTemplateFields: [
          { key: "delegate_signature", label: "Delegate Signature", type: "signature", optional: true, raw: "x" },
        ],
      },
    }),
  );
  const messages = new InMemoryMessages();
  await messages.create({
    sessionId: "session-1",
    role: "assistant",
    content: "Generated",
    stepNodeId: "node-draft",
    document: { filename: "instrument.docx", storagePath: "generated/session-1/instrument.docx", summary: null, generatedAt: "2026-11-08T09:00:00Z" },
  });
  const storage = new InMemoryObjectStorage();
  await storage.put("templates/instrument.docx", Buffer.from("template"), "application/octet-stream");
  const users = new InMemoryUsers();
  users.add({ ...user("manager-1", "manager@corp.test"), name: "Jane Doe" });
  const created = await approvals.create({
    sessionId: "session-1",
    flowId: "flow-1",
    nodeId: "node-appr",
    requestedByUserId: "operator-1",
    approverSource: "first_level_supervisor",
    approverUserId: "manager-1",
    recordSnapshot: { subjectNodeId: "node-draft", subjectDescription: "The instrument" },
  });

  const provider = new FakeProvider();
  const engine = new FakeEngine();
  const decisions: DecideApprovalInput[] = [];
  const audit = new RecordingAuditLogger();
  let config = CERTIFICATE_CONFIG;
  let tokenCounter = 0;
  const stepOutputs = new InMemoryStepOutputs();

  const deps: CertificateSigningDeps = {
    approvals,
    flowNodes: nodes,
    sessionMessages: messages,
    sessionStepOutputs: stepOutputs,
    objectStorage: storage,
    users,
    documentGenerator: {
      extractTags: () => ok({ tags: [] }),
      extractFields: () => ok({ fields: [] }),
      extractFullText: () => ok({ text: "" }),
      annotate: () => ok({ bytes: Buffer.alloc(0), appliedCount: 0, unmatched: [] }),
      generate: (input) => ok({ bytes: Buffer.from(JSON.stringify(input.data)) }),
    },
    drawnSignatures: { findByUserId: async () => ok(null), save: async () => ok(undefined) },
    loadSignatureConfig: async () => config,
    provider,
    engine,
    pdfConverter: converter,
    anchorLocator: locator,
    resolveSubject: new ResolveApprovalSubject(approvals, nodes, stepOutputs, messages),
    decide: {
      execute: async (input: DecideApprovalInput) => {
        decisions.push(input);
        await approvals.update(input.approvalId, { status: "approved", digitalSignature: input.digitalSignature });
        return ok({ approval: approvals.rows.get(input.approvalId)!, advanced: true, newNodeId: null, sessionCompleted: false });
      },
    },
    auditLogger: audit,
    randomToken: () => `random-${(tokenCounter += 1)}`,
    sha256Hex,
    hashBytes: (bytes: Buffer) => `sha-${bytes.length}`,
    now: () => new Date("2026-11-08T10:00:00.000Z"),
  };

  return {
    deps,
    approvals,
    messages,
    storage,
    provider,
    engine,
    decisions,
    audit,
    approvalId: created.data!.id,
    setConfig: (next: SignatureConfig) => {
      config = next;
    },
  };
};

const REDIRECT = "http://app/api/signing/csc/callback";

const stateFrom = (url: string) => new URL(url).searchParams.get("state")!;

const startAndReturnState = async (context: Awaited<ReturnType<typeof seed>>) => {
  const started = await new StartCertificateSigning(context.deps).execute({
    approvalId: context.approvalId,
    userId: "manager-1",
    impersonatorId: null,
    comment: "Within delegated authority.",
    redirectUri: REDIRECT,
  });
  return stateFrom(started.data!.redirectUrl);
};

describe("StartCertificateSigning", () => {
  it("sends the approver to the provider for a service token and records the attempt", async () => {
    const context = await seed();

    const result = await new StartCertificateSigning(context.deps).execute({
      approvalId: context.approvalId,
      userId: "manager-1",
      impersonatorId: null,
      comment: "Within delegated authority.",
      redirectUri: REDIRECT,
    });

    expect(result.data!.redirectUrl).toContain("scope=service");
    const state = stateFrom(result.data!.redirectUrl);
    expect(state.startsWith(`${context.approvalId}.`)).toBe(true);
    const record = context.approvals.rows.get(context.approvalId)!.digitalSignature!;
    expect(record.status).toBe("pending");
    expect(record.pending).toMatchObject({
      stage: "service",
      stateHash: sha256Hex(state),
      startedByUserId: "manager-1",
      comment: "Within delegated authority.",
      slotKey: "delegate_signature",
      subjectNodeId: "node-draft",
      signerName: "Jane Doe",
    });
  });

  it("refuses anyone but the assigned approver", async () => {
    const context = await seed();

    const result = await new StartCertificateSigning(context.deps).execute({
      approvalId: context.approvalId,
      userId: "someone-else",
      impersonatorId: null,
      comment: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses while an admin is viewing as the approver", async () => {
    const context = await seed();

    const result = await new StartCertificateSigning(context.deps).execute({
      approvalId: context.approvalId,
      userId: "manager-1",
      impersonatorId: "admin-1",
      comment: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses when the install does not sign with certificates", async () => {
    const context = await seed();
    context.setConfig({ ...DEFAULT_SIGNATURE_CONFIG });

    const result = await new StartCertificateSigning(context.deps).execute({
      approvalId: context.approvalId,
      userId: "manager-1",
      impersonatorId: null,
      comment: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("CompleteCertificateSigning — service leg", () => {
  it("freezes the document, prepares the signature and asks the signer to authorise its hash", async () => {
    const context = await seed();
    const state = await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toMatchObject({ outcome: "authorise" });
    if (result.data?.outcome !== "authorise") throw new Error("expected authorise");
    expect(result.data.redirectUrl).toContain("scope=credential");
    expect(result.data.redirectUrl).toContain("hash=ZGlnZXN0");
    const document = context.messages.rows[0]!.document!;
    expect(document.pdf).toMatchObject({ status: "frozen", sha256: "sha-11" });
    expect(document.pdf!.slotAnchors).toEqual({ delegate_signature: { page: 1, x: 72, y: 500 } });
    expect(context.engine.prepared[0]).toMatchObject({
      signingTime: "2026-11-08T10:00:00.000Z",
      appearance: { page: 1, x: 72, y: 500 },
    });
    const pending = context.approvals.rows.get(context.approvalId)!.digitalSignature!.pending!;
    expect(pending).toMatchObject({ stage: "credential", credentialId: "valid", dataToSignDigest: "ZGlnZXN0" });
  });

  it("refuses a certificate the engine finds revoked, before anything is signed", async () => {
    const context = await seed();
    context.engine.check = { ...passedCheck, revoked: true, indication: "INDETERMINATE", subIndication: "REVOKED_NO_POE" };
    const state = await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toEqual({ outcome: "rejected", approvalId: context.approvalId, reason: "revoked" });
    const approval = context.approvals.rows.get(context.approvalId)!;
    expect(approval.status).toBe("pending");
    expect(approval.digitalSignature).toMatchObject({ status: "rejected", rejection: { reason: "revoked" } });
    expect(context.audit.entries.map((entry) => entry.action)).toContain("signature.rejected");
  });

  it("fails closed when the provider cannot be reached, leaving the approval pending", async () => {
    const context = await seed();
    const state = await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "bad",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toMatchObject({ outcome: "rejected", reason: "unavailable" });
    expect(context.approvals.rows.get(context.approvalId)!.status).toBe("pending");
    expect(context.decisions).toEqual([]);
  });

  it("refuses a state that does not match the attempt in flight", async () => {
    const context = await seed();
    await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state: `${context.approvalId}.forged`,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a callback completed by someone other than who started it", async () => {
    const context = await seed();
    const state = await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "service-code",
      userId: "intruder",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });
});

describe("CompleteCertificateSigning — credential leg", () => {
  const throughServiceLeg = async (context: Awaited<ReturnType<typeof seed>>) => {
    const state = await startAndReturnState(context);
    const authorise = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });
    if (authorise.data?.outcome !== "authorise") throw new Error("expected authorise");
    return stateFrom(authorise.data.redirectUrl);
  };

  it("signs the authorised hash, incorporates it, validates it and records the decision", async () => {
    const context = await seed();
    const state = await throughServiceLeg(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "credential-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toEqual({ outcome: "signed", approvalId: context.approvalId, sessionId: "session-1" });
    expect(context.provider.signed).toEqual(["ZGlnZXN0"]);
    expect(context.engine.signedWith[0]).toMatchObject({
      signingTime: context.engine.prepared[0]!.signingTime,
      appearance: context.engine.prepared[0]!.appearance,
      signatureValue: "c2lnbmF0dXJl",
    });
    expect(context.decisions[0]).toMatchObject({
      approvalId: context.approvalId,
      decidedByUserId: "manager-1",
      decision: "approved",
      comment: "Within delegated authority.",
      digitalSignature: {
        status: "signed",
        method: "certificate",
        certificate: passedReport.certificate,
        level: "PAdES_BASELINE_LTA",
        validation: { badge: "valid", reason: null },
      },
    });
    const pdf = context.messages.rows[0]!.document!.pdf!;
    expect(pdf.status).toBe("frozen");
    expect(pdf.storagePath).toBe("generated/session-1/instrument-signed-r1.pdf");
    expect(context.storage.objects.get(pdf.storagePath!)!.data.toString()).toContain("%signed");
    expect(context.audit.entries.map((entry) => entry.action)).toContain("signature.signed");
  });

  it("refuses a signature the engine does not validate, and records no decision", async () => {
    const context = await seed();
    const state = await throughServiceLeg(context);
    context.engine.report = { ...passedReport, indication: "INDETERMINATE", subIndication: "NO_CERTIFICATE_CHAIN_FOUND" };

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "credential-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toMatchObject({ outcome: "rejected", reason: "untrusted" });
    expect(context.decisions).toEqual([]);
  });

  it("will not reuse a service-leg state for the credential leg", async () => {
    const context = await seed();
    const serviceState = await startAndReturnState(context);
    await new CompleteCertificateSigning(context.deps).execute({
      state: serviceState,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    const replay = await new CompleteCertificateSigning(context.deps).execute({
      state: serviceState,
      code: "credential-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(replay.error?.code).toBe("FORBIDDEN");
  });
});
