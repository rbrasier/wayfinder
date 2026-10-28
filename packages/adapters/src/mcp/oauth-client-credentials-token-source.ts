import { createHash } from "node:crypto";
import { domainError, err, ok, type McpOAuthSettings, type Result } from "@rbrasier/domain";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// A token this close to expiry is replaced rather than sent, so it cannot lapse
// between being read here and the MCP server checking it.
const REFRESH_MARGIN_MS = 60_000;
// RFC 6749 makes `expires_in` optional; without it a token is trusted this long.
const DEFAULT_TOKEN_LIFETIME_MS = 5 * 60_000;
const TOKEN_REQUEST_TIMEOUT_MS = 8_000;

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

interface CacheEntry {
  // Changing the settings or the secret changes this, which retires the token.
  readonly fingerprint: string;
  readonly pending: Promise<Result<CachedToken>>;
}

interface TokenResponseBody {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

// RFC 6749 §2.3.1: the client ID and secret are form-encoded before Basic encoding.
const formEncode = (value: string): string => new URLSearchParams([["", value]]).toString().slice(1);

const fingerprintOf = (settings: McpOAuthSettings, clientSecret: string): string =>
  createHash("sha256").update(JSON.stringify([settings, clientSecret])).digest("hex");

const hostOf = (tokenUrl: string): string => {
  try {
    return new URL(tokenUrl).host;
  } catch {
    return tokenUrl;
  }
};

const readBody = async (response: Response): Promise<TokenResponseBody> => {
  try {
    return (await response.json()) as TokenResponseBody;
  } catch {
    return {};
  }
};

const describeOAuthError = (body: TokenResponseBody, status: number): string => {
  if (typeof body.error !== "string") return `HTTP ${status}.`;
  return typeof body.error_description === "string"
    ? `${body.error} — ${body.error_description}`
    : body.error;
};

// Fetches OAuth 2.0 client-credentials access tokens for MCP servers that sign in
// as a service account (issue #361), and keeps each in memory until shortly
// before it expires. A restart simply fetches a new one from the stored client
// credentials, so tokens are never written anywhere.
export class OAuthClientCredentialsTokenSource {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetchToken: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async accessToken(
    serverId: string,
    settings: McpOAuthSettings,
    clientSecret: string,
  ): Promise<Result<string>> {
    const fingerprint = fingerprintOf(settings, clientSecret);
    const cached = this.cache.get(serverId);
    if (cached && cached.fingerprint === fingerprint) {
      const reused = await cached.pending;
      if (reused.data && reused.data.expiresAt - this.now() >= REFRESH_MARGIN_MS) {
        return ok(reused.data.accessToken);
      }
    }

    // Concurrent callers for the same server share this one request.
    const pending = this.requestToken(settings, clientSecret);
    this.cache.set(serverId, { fingerprint, pending });
    const fetched = await pending;
    if (fetched.error) {
      if (this.cache.get(serverId)?.pending === pending) this.cache.delete(serverId);
      return fetched;
    }
    return ok(fetched.data.accessToken);
  }

  private async requestToken(
    settings: McpOAuthSettings,
    clientSecret: string,
  ): Promise<Result<CachedToken>> {
    const failure = (reason: string) =>
      err(domainError("INFRA_FAILURE", `Couldn't get an access token from ${hostOf(settings.tokenUrl)}: ${reason}`));

    const body = new URLSearchParams({ grant_type: "client_credentials" });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
    if (settings.clientAuthMethod === "client_secret_post") {
      body.set("client_id", settings.clientId);
      body.set("client_secret", clientSecret);
    } else {
      const pair = `${formEncode(settings.clientId)}:${formEncode(clientSecret)}`;
      headers.Authorization = `Basic ${Buffer.from(pair).toString("base64")}`;
    }
    if (settings.scope) body.set("scope", settings.scope);
    // Providers disagree on the name: Auth0 reads `audience`, RFC 8707 (which the
    // MCP authorization spec adopts) reads `resource`.
    if (settings.audience) {
      body.set("audience", settings.audience);
      body.set("resource", settings.audience);
    }

    let response: Response;
    try {
      response = await this.fetchToken(settings.tokenUrl, {
        method: "POST",
        headers,
        body: body.toString(),
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      return failure(cause instanceof Error ? cause.message : "the token endpoint did not answer.");
    }

    const parsed = await readBody(response);
    if (!response.ok) return failure(describeOAuthError(parsed, response.status));
    if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
      return failure("the response had no access_token.");
    }
    if (typeof parsed.token_type === "string" && parsed.token_type.toLowerCase() !== "bearer") {
      return failure(`token type "${parsed.token_type}" is not supported.`);
    }

    const lifetimeSeconds = Number(parsed.expires_in);
    const lifetimeMs =
      Number.isFinite(lifetimeSeconds) && lifetimeSeconds > 0 ? lifetimeSeconds * 1000 : DEFAULT_TOKEN_LIFETIME_MS;
    return ok({ accessToken: parsed.access_token, expiresAt: this.now() + lifetimeMs });
  }
}
