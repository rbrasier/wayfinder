import type { ConnectivityResult, ConnectivityTarget } from "../entities/connectivity";
import type { SignatureConfig } from "../entities/signature-config";

export type SignatureServiceTarget = Extract<
  ConnectivityTarget,
  "pdf-converter" | "signature-engine" | "timestamp-authority" | "signing-provider"
>;

// Probes a signing service against a *candidate* config, so the admin Test runs
// on the values about to be saved rather than whatever is already stored
// (ADR-067 §6). Never sends a real document or produces a real signature.
export interface ISignatureServicesProbe {
  probe(target: SignatureServiceTarget, config: SignatureConfig): Promise<ConnectivityResult>;
}
