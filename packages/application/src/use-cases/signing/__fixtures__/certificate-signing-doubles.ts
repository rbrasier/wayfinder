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
} from "../../approvals/__fixtures__/approval-doubles";
import { InMemoryObjectStorage } from "../../__fixtures__/presentation-doubles";
import { ResolveApprovalSubject } from "../../approvals/resolve-approval-subject";
import type { DecideApprovalInput } from "../../approvals/decide-approval";
import type { CertificateSigningDeps } from "../certificate-signing-deps";

// In-memory doubles for every certificate-signing port, shared by the signing
// and signature-record specs.

// Deterministic and distinct per input — all the signing specs need of a hash.
// node:crypto is off limits in this package, fixtures included.
export const sha256Hex = (input: string) => `hash(${input})`;

export const CERTIFICATE_CONFIG: SignatureConfig = {
  ...DEFAULT_SIGNATURE_CONFIG,
  method: "certificate",
  gotenbergUrl: "http://gotenberg",
  dssUrl: "http://dss",
  tsaUrl: "http://tsa",
  csc: { baseUrl: "http://csc/v2", clientId: "wayfinder", clientSecret: "secret" },
};

export const passedCheck: CertificateCheck = {
  keyUsageAllowsSigning: true,
  validNow: true,
  revoked: false,
  indication: "PASSED",
  subIndication: null,
};

export const passedReport: EngineSignatureReport = {
  id: "S-1",
  indication: "TOTAL_PASSED",
  subIndication: null,
  signedBy: "Jane Doe",
  signingTime: "2026-11-08T10:00:00Z",
  level: "PAdES_BASELINE_LTA",
  timestampTimes: ["2026-11-08T10:00:01Z"],
  certificate: { subject: "CN=Jane Doe", issuer: "CN=Root", serialNumber: "4096", notAfter: "2027-11-08T00:00:00Z", sha256: "ab" },
};

export class FakeProvider implements IRemoteSigningProvider {
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

export class FakeEngine implements ISignatureEngine {
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

export const converter: IPdfConverter = { convertDocxToPdfA: async () => ok(Buffer.from("%PDF-frozen")) };
export const locator: IPdfAnchorLocator = {
  locate: async (_pdf, markers) =>
    ok(Object.fromEntries(markers.map((marker) => [marker, { page: 1, x: 72, y: 500, width: 100, height: 12 }]))),
};

export const seed = async () => {
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

export type SigningContext = Awaited<ReturnType<typeof seed>>;
