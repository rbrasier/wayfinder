import { randomBytes } from "node:crypto";
import {
  CompleteCertificateSigning,
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
  DrizzleDrawnSignatureRepository,
  DssSignatureEngine,
  GotenbergPdfConverter,
  HttpSignatureServicesProbe,
  PdfJsAnchorLocator,
  sha256Bytes,
  sha256Hex,
} from "@wayfinder/adapters";
import type { Database } from "@wayfinder/adapters";
import type {
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
  const signatureProbe = new HttpSignatureServicesProbe();
  const pdfConverter = new GotenbergPdfConverter(async () => (await deps.loadSignatureConfig()).gotenbergUrl);
  const testSignatureConfig = new TestSignatureConfig(signatureProbe);

  return {
    drawnSignatures,
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
  "provider" | "engine" | "anchorLocator" | "randomToken" | "sha256Hex" | "hashBytes" | "now"
>;

export const buildCertificateSigning = (wiring: CertificateSigningWiring) => {
  const deps: CertificateSigningDeps = {
    ...wiring,
    provider: new CscRemoteSigningAdapter(),
    engine: new DssSignatureEngine(),
    anchorLocator: new PdfJsAnchorLocator(),
    randomToken: () => randomBytes(24).toString("base64url"),
    sha256Hex,
    hashBytes: sha256Bytes,
    now: () => new Date(),
  };
  return {
    startCertificateSigning: new StartCertificateSigning(deps),
    completeCertificateSigning: new CompleteCertificateSigning(deps),
  };
};
