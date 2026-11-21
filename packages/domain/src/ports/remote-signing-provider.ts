import type { CscProviderConfig } from "../entities/signature-config";
import type { Result } from "../result";

export type RemoteSigningScope = "service" | "credential";

export interface AuthorizationRequest {
  scope: RemoteSigningScope;
  redirectUri: string;
  state: string;
  // Credential scope only: the credential and the one hash being authorised.
  credentialId?: string;
  hash?: string;
}

// A CSC v2 remote-signing provider (ETSI TS 119 432; ADR-067 §4). The signer's
// key never leaves the provider: Wayfinder sends a SHA-256 hash and receives a
// signature value. Two OAuth legs: `service` to read the signer's certificate,
// `credential` to authorise one specific hash.
export interface IRemoteSigningProvider {
  authorizationUrl(config: CscProviderConfig, request: AuthorizationRequest): Promise<Result<string>>;
  exchangeCode(config: CscProviderConfig, code: string, redirectUri: string): Promise<Result<string>>;
  firstCredential(config: CscProviderConfig, accessToken: string): Promise<Result<string>>;
  // Base64 DER, signing certificate first.
  certificateChain(config: CscProviderConfig, accessToken: string, credentialId: string): Promise<Result<string[]>>;
  // Base64 signature value over the base64 SHA-256 hash.
  signHash(config: CscProviderConfig, accessToken: string, credentialId: string, hash: string): Promise<Result<string>>;
}
