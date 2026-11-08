import type { CertificateCheck, EngineSignatureReport } from "../entities/digital-signature";
import type { Result } from "../result";

// Where and how a signature is drawn on the page (ADR-068 §2). Coordinates are
// PDF points from the top-left corner of the page, the engine's convention.
export interface SignatureAppearance {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imagePng: Buffer | null;
  text: string;
}

export interface SigningParameters {
  engineUrl: string;
  pdf: Buffer;
  // Base64 DER, signing certificate first.
  certificateChain: string[];
  // Prepare and sign must agree exactly, so the time is fixed by the caller.
  signingTime: string;
  reason: string | null;
  appearance: SignatureAppearance | null;
}

export interface PreparedSignature {
  dataToSignDigest: string;
  certificateCheck: CertificateCheck;
}

// The PAdES engine — the DSS sidecar (ADR-067 §4). Never holds a key.
export interface ISignatureEngine {
  prepare(parameters: SigningParameters): Promise<Result<PreparedSignature>>;
  sign(parameters: SigningParameters & { signatureValue: string; tsaUrl: string }): Promise<Result<Buffer>>;
  validate(engineUrl: string, pdf: Buffer): Promise<Result<EngineSignatureReport[]>>;
}
