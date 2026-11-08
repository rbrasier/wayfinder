import {
  GetDrawnSignature,
  GetSignatureConfig,
  SaveDrawnSignature,
  SaveSignatureConfig,
  TestSignatureConfig,
} from "@wayfinder/application";
import {
  DrizzleDrawnSignatureRepository,
  GotenbergPdfConverter,
  HttpSignatureServicesProbe,
  sha256Bytes,
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
