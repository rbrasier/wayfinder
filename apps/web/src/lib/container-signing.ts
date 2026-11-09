import { randomBytes } from "node:crypto";
import {
  CompleteCertificateSigning,
  ExportSignatureMetadata,
  ListSessionSignatures,
  OffSystemSignedEvidence,
  RecordOffSystemApproval,
  RevalidateSessionSignatures,
  GetDrawnSignature,
  GetSignatureConfig,
  SaveDrawnSignature,
  SaveSignatureConfig,
  StartCertificateSigning,
  TestSignatureConfig,
  type CertificateSigningDeps,
} from "@wayfinder/application";
import {
  CscRemoteSigningAdapter,
  CsvWriter,
  DrizzleDrawnSignatureRepository,
  DssSignatureEngine,
  HttpSignatureServicesProbe,
  PdfJsAnchorLocator,
  RoutingPdfConverter,
  createBuiltInEngines,
  sha256Bytes,
  sha256Hex,
} from "@wayfinder/adapters";
import type { Database } from "@wayfinder/adapters";
import type {
  IClock,
  ISessionRepository,
  IAuditLogger,
  IObjectStorage,
  ISystemSettingsRepository,
  SignatureConfig,
} from "@wayfinder/domain";

export interface SigningDeps {
  db: Database;
  systemSettings: ISystemSettingsRepository;
  objectStorage: IObjectStorage;
  auditLogger: IAuditLogger;
  loadSignatureConfig: () => Promise<SignatureConfig>;
}

// Document signatures (ADR-067): the install-wide config, the remembered drawn
// signature, and the PDF converter. Factored out of container.ts to keep it
// under the source-size ceiling.
export const buildSigning = (deps: SigningDeps) => {
  const drawnSignatures = new DrizzleDrawnSignatureRepository(deps.db);
  // One set of built-in engines per web process (ADR-069 §1); the container is
  // a process-wide singleton, so this is too. Nothing starts until used.
  const builtInEngines = createBuiltInEngines();
  process.once("exit", () => builtInEngines.signatureEngine.stop());
  const signatureEngine = new DssSignatureEngine(undefined, undefined, builtInEngines.signatureEngine);
  const signatureProbe = new HttpSignatureServicesProbe(undefined, undefined, builtInEngines);
  const pdfConverter = new RoutingPdfConverter(
    async () => (await deps.loadSignatureConfig()).pdfConverter,
    builtInEngines.pdfConverter,
  );
  const testSignatureConfig = new TestSignatureConfig(signatureProbe);

  return {
    drawnSignatures,
    builtInEngines,
    signatureEngine,
    pdfConverter,
    signatureProbe,
    pdfRendering: {
      converter: pdfConverter,
      loadSignatureConfig: deps.loadSignatureConfig,
      hashBytes: sha256Bytes,
    },
    decisionSigning: {
      loadSignatureConfig: deps.loadSignatureConfig,
      drawnSignatures,
    },
    useCases: {
      testSignatureConfig,
      saveSignatureConfig: new SaveSignatureConfig(deps.systemSettings, testSignatureConfig, deps.auditLogger),
      getSignatureConfig: new GetSignatureConfig(deps.systemSettings),
      saveDrawnSignature: new SaveDrawnSignature(deps.objectStorage, drawnSignatures, deps.auditLogger),
      getDrawnSignature: new GetDrawnSignature(deps.objectStorage, drawnSignatures),
    },
  };
};

// What certificate signing needs beyond the signing services themselves: the
// repositories and the decision it completes. Built after the approval use
// cases, because it finishes by recording an approval decision.
export type CertificateSigningWiring = Omit<
  CertificateSigningDeps,
  "provider" | "anchorLocator" | "randomToken" | "sha256Hex" | "hashBytes" | "now"
>;

// Off-system approvals on a certificate step must carry a validly signed PDF
// (ADR-068 §5), so the recorder is rebuilt here with that check and replaces the
// one the approval cluster built — the spread order in container.ts is what
// makes this one win.
export interface OffSystemWiring {
  sessions: ISessionRepository;
  clock: IClock;
  decideApproval: ConstructorParameters<typeof RecordOffSystemApproval>[5];
}

export const buildCertificateSigning = (wiring: CertificateSigningWiring & OffSystemWiring) => {
  const deps: CertificateSigningDeps = {
    ...wiring,
    provider: new CscRemoteSigningAdapter(),
    anchorLocator: new PdfJsAnchorLocator(),
    randomToken: () => randomBytes(24).toString("base64url"),
    sha256Hex,
    hashBytes: sha256Bytes,
    now: () => new Date(),
  };
  return {
    startCertificateSigning: new StartCertificateSigning(deps),
    completeCertificateSigning: new CompleteCertificateSigning(deps),
    listSessionSignatures: new ListSessionSignatures(deps),
    revalidateSessionSignatures: new RevalidateSessionSignatures(deps),
    exportSignatureMetadata: new ExportSignatureMetadata(deps, new CsvWriter()),
    recordOffSystemApproval: new RecordOffSystemApproval(
      wiring.approvals,
      wiring.sessions,
      wiring.flowNodes,
      wiring.objectStorage,
      wiring.auditLogger,
      wiring.decideApproval,
      wiring.clock,
      new OffSystemSignedEvidence(deps),
    ),
  };
};
