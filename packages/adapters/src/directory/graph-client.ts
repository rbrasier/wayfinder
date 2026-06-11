import { domainError, err, ok, type Result } from "@rbrasier/domain";

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

interface CachedToken {
  value: string;
  expiresAtMs: number;
}

// Thin Microsoft Graph client over the Email-Notifications M365 app registration
// (ADR-018 reuses it, adding User.Read.All + Directory.Read.All). `fetch` is
// injectable so the directory adapters can be unit-tested without the network.
export class GraphClient {
  private token: CachedToken | null = null;

  constructor(
    private readonly config: GraphConfig | null,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config?.tenantId && this.config.clientId && this.config.clientSecret,
    );
  }

  async get<T>(
    path: string,
    query: Record<string, string> = {},
    headers: Record<string, string> = {},
  ): Promise<Result<T>> {
    const tokenResult = await this.resolveToken();
    if (tokenResult.error) return tokenResult;

    const url = new URL(`${GRAPH_BASE}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    try {
      const response = await this.fetchImplementation(url.toString(), {
        headers: { Authorization: `Bearer ${tokenResult.data}`, ...headers },
      });
      if (!response.ok) {
        return err(domainError("INFRA_FAILURE", `Graph request failed (${response.status}).`));
      }
      return ok((await response.json()) as T);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Graph request failed.", cause));
    }
  }

  private async resolveToken(): Promise<Result<string>> {
    if (!this.config) {
      return err(domainError("VALIDATION_FAILED", "Microsoft Graph is not configured."));
    }
    if (this.token && this.token.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > Date.now()) {
      return ok(this.token.value);
    }
    try {
      const response = await this.fetchImplementation(
        `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            scope: GRAPH_SCOPE,
          }).toString(),
        },
      );
      if (!response.ok) {
        return err(domainError("INFRA_FAILURE", `Graph token request failed (${response.status}).`));
      }
      const payload = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!payload.access_token) {
        return err(domainError("INFRA_FAILURE", "Graph token response had no access_token."));
      }
      this.token = {
        value: payload.access_token,
        expiresAtMs: Date.now() + (payload.expires_in ?? 0) * 1000,
      };
      return ok(this.token.value);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to fetch a Graph access token.", cause));
    }
  }
}

export interface GraphUser {
  id: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
}
