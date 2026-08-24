import { domainError, err, ok, type Result } from "@rbrasier/domain";

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  // Host overrides for the two Microsoft endpoints this client talks to. Both
  // are env-only and absent from the admin UI, for the same reason
  // ENTRA_AUTHORITY is: a directory lookup must not be repointable at an
  // arbitrary host from a settings form. Unset, the real hosts are used. The
  // local mock Graph (restart.sh --with-mocks) is what these exist for.
  baseUrl?: string;
  authority?: string;
}

// Where the client gets its configuration. A fixed value pins it for the
// lifetime of the client; a resolver is re-read on every call, which is what
// lets an admin change the app registration from /admin/settings and have the
// next request use it — no redeploy, no container rebuild.
export type GraphConfigSource =
  | GraphConfig
  | null
  | (() => Promise<GraphConfig | null>);

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const DEFAULT_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const DEFAULT_AUTHORITY = "https://login.microsoftonline.com";
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

interface CachedToken {
  value: string;
  expiresAtMs: number;
  // Which configuration the token was issued for. A token minted for one app
  // registration is worthless against another, so a rotated secret or a
  // re-pointed tenant must invalidate the cache rather than keep serving a
  // token nobody granted.
  configurationKey: string;
}

const configurationKeyOf = (config: GraphConfig): string =>
  [config.tenantId, config.clientId, config.clientSecret, config.authority ?? ""].join("|");

const isComplete = (config: GraphConfig | null): config is GraphConfig =>
  Boolean(config?.tenantId && config.clientId && config.clientSecret);

// Thin Microsoft Graph client over the app registration the approver directory
// is configured with (ADR-018 — by default the Email-Notifications M365
// registration, plus User.Read.All + Directory.Read.All). `fetch` is injectable
// so the directory adapters can be unit-tested without the network.
export class GraphClient {
  private token: CachedToken | null = null;

  constructor(
    private readonly configSource: GraphConfigSource,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  private async resolveConfig(): Promise<GraphConfig | null> {
    const config =
      typeof this.configSource === "function" ? await this.configSource() : this.configSource;
    return isComplete(config) ? config : null;
  }

  private baseUrl(config: GraphConfig): string {
    return withoutTrailingSlash(config.baseUrl || DEFAULT_GRAPH_BASE);
  }

  private authority(config: GraphConfig): string {
    return withoutTrailingSlash(config.authority || DEFAULT_AUTHORITY);
  }

  async isConfigured(): Promise<boolean> {
    return (await this.resolveConfig()) !== null;
  }

  async get<T>(
    path: string,
    query: Record<string, string> = {},
    headers: Record<string, string> = {},
  ): Promise<Result<T>> {
    const config = await this.resolveConfig();
    if (!config) {
      return err(domainError("VALIDATION_FAILED", "Microsoft Graph is not configured."));
    }

    const tokenResult = await this.resolveToken(config);
    if (tokenResult.error) return tokenResult;

    const url = new URL(`${this.baseUrl(config)}${path}`);
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

  private async resolveToken(config: GraphConfig): Promise<Result<string>> {
    const configurationKey = configurationKeyOf(config);
    if (
      this.token &&
      this.token.configurationKey === configurationKey &&
      this.token.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > Date.now()
    ) {
      return ok(this.token.value);
    }
    try {
      const response = await this.fetchImplementation(
        `${this.authority(config)}/${config.tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: config.clientId,
            client_secret: config.clientSecret,
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
        configurationKey,
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
