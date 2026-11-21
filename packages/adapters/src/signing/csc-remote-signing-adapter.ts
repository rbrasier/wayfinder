import {
  domainError,
  err,
  ok,
  type AuthorizationRequest,
  type CscProviderConfig,
  type IRemoteSigningProvider,
  type Result,
} from "@wayfinder/domain";

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const SHA256_WITH_RSA_OID = "1.2.840.113549.1.1.11";
const DEFAULT_TIMEOUT_MS = 15_000;

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

interface ProviderError {
  error?: string;
  error_description?: string;
}

// CSC v2 (ETSI TS 119 432) over its OAuth 2.0 authorisation-code flow
// (ADR-067 §4). Hashes go on the authorize URL base64url-encoded, as the spec
// requires, and in API bodies as standard base64.
export class CscRemoteSigningAdapter implements IRemoteSigningProvider {
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async authorizationUrl(config: CscProviderConfig, request: AuthorizationRequest): Promise<Result<string>> {
    const oauthBase = await this.oauthBase(config);
    if (oauthBase.error) return oauthBase;

    const url = new URL(`${oauthBase.data}/oauth2/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("scope", request.scope);
    url.searchParams.set("state", request.state);
    if (request.scope === "credential" && request.credentialId && request.hash) {
      url.searchParams.set("credentialID", request.credentialId);
      url.searchParams.set("numSignatures", "1");
      url.searchParams.set("hashes", Buffer.from(request.hash, "base64").toString("base64url"));
      url.searchParams.set("hashAlgorithmOID", SHA256_OID);
    }
    return ok(url.toString());
  }

  async exchangeCode(config: CscProviderConfig, code: string, redirectUri: string): Promise<Result<string>> {
    const oauthBase = await this.oauthBase(config);
    if (oauthBase.error) return oauthBase;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
    });
    const response = await this.call<{ access_token?: string }>(`${oauthBase.data}/oauth2/token`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (response.error) return response;
    if (!response.data.access_token) return err(domainError("INFRA_FAILURE", "The signing provider issued no token."));
    return ok(response.data.access_token);
  }

  async firstCredential(config: CscProviderConfig, accessToken: string): Promise<Result<string>> {
    const response = await this.api<{ credentialIDs?: string[] }>(config, "credentials/list", accessToken, {});
    if (response.error) return response;
    const credentialId = response.data.credentialIDs?.[0];
    if (!credentialId) {
      return err(domainError("VALIDATION_FAILED", "The signing provider has no digital ID for this signer."));
    }
    return ok(credentialId);
  }

  async certificateChain(config: CscProviderConfig, accessToken: string, credentialId: string): Promise<Result<string[]>> {
    const response = await this.api<{ cert?: { certificates?: string[] } }>(config, "credentials/info", accessToken, {
      credentialID: credentialId,
      certificates: "chain",
    });
    if (response.error) return response;
    const chain = response.data.cert?.certificates ?? [];
    if (chain.length === 0) return err(domainError("INFRA_FAILURE", "The signing provider returned no certificate."));
    return ok(chain);
  }

  async signHash(config: CscProviderConfig, accessToken: string, credentialId: string, hash: string): Promise<Result<string>> {
    const response = await this.api<{ signatures?: string[] }>(config, "signatures/signHash", accessToken, {
      credentialID: credentialId,
      hashes: [hash],
      hashAlgorithmOID: SHA256_OID,
      signAlgo: SHA256_WITH_RSA_OID,
    });
    if (response.error) return response;
    const signature = response.data.signatures?.[0];
    if (!signature) return err(domainError("INFRA_FAILURE", "The signing provider returned no signature."));
    return ok(signature);
  }

  // The OAuth server may live apart from the API; `info` says where.
  private async oauthBase(config: CscProviderConfig): Promise<Result<string>> {
    const response = await this.call<{ oauth2?: string }>(`${trimSlash(config.baseUrl)}/info`, {
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (response.error) return response;
    return ok(trimSlash(response.data.oauth2 ?? trimSlash(config.baseUrl)));
  }

  private api<T>(config: CscProviderConfig, path: string, accessToken: string, body: unknown): Promise<Result<T>> {
    return this.call<T>(`${trimSlash(config.baseUrl)}/${path}`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
  }

  private async call<T>(url: string, init: { headers: Record<string, string>; body: string }): Promise<Result<T>> {
    let response: Response;
    try {
      response = await this.fetchFn(url, { method: "POST", ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "The signing provider is unreachable.", cause));
    }
    const body = (await response.json().catch(() => null)) as (T & ProviderError) | null;
    if (!response.ok) {
      const reason = body?.error_description ?? body?.error ?? `HTTP ${response.status}`;
      return err(domainError("INFRA_FAILURE", `The signing provider refused: ${reason}`));
    }
    if (!body) return err(domainError("INFRA_FAILURE", "The signing provider's reply is not JSON."));
    return ok(body);
  }
}
