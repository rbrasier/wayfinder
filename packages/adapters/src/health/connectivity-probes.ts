import { Client as MinioClient } from "minio";
import { isEntraConfigured } from "@rbrasier/domain";
import { minioClientOptions } from "../storage/minio-client-options";
import type {
  AiConfig,
  AuthConfig,
  ConnectivityResult,
  EmbeddingsConfig,
  EntraCredentials,
  IEmbeddingsProvider,
  N8nConfig,
  Result,
  StorageConfig,
} from "@rbrasier/domain";

// Default bound for any single probe: short enough that a parallel "Test all"
// stays snappy, long enough for a real TLS/auth handshake.
export const DEFAULT_PROBE_TIMEOUT_MS = 8000;

const ANTHROPIC_VERSION = "2023-06-01";

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// Walk the error/cause chain for a transport code (ENOTFOUND, ECONNREFUSED, …)
// so failures read as a short reason and never echo credentials.
const errorCode = (cause: unknown): string | null => {
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
};

const sanitizeCause = (cause: unknown): string => {
  if ((cause as { name?: unknown } | null)?.name === "TimeoutError") {
    return (cause as Error).message;
  }
  const code = errorCode(cause);
  if (code) return code;
  if (cause instanceof Error && cause.message) return cause.message;
  return "Connection failed";
};

interface HttpProbeOptions {
  url: string;
  headers: Record<string, string>;
  fetchFn: typeof fetch;
  timeoutMs: number;
}

const probeHttp = async (options: HttpProbeOptions): Promise<{ ok: boolean; message?: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchFn(options.url, {
      method: "GET",
      headers: options.headers,
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    // Status only — the response body could echo request context, so it is never read.
    return { ok: false, message: `HTTP ${response.status}` };
  } catch (cause) {
    if (controller.signal.aborted) return { ok: false, message: `Timed out after ${options.timeoutMs}ms` };
    return { ok: false, message: sanitizeCause(cause) };
  } finally {
    clearTimeout(timer);
  }
};

const withMessage = (
  base: { target: ConnectivityResult["target"]; ok: boolean; latencyMs: number },
  message: string | undefined,
): ConnectivityResult => (message ? { ...base, message } : base);

interface HttpProbeDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const AI_HTTP_ENDPOINT: Record<"anthropic" | "openai" | "mistral", (key: string) => Omit<HttpProbeOptions, "fetchFn" | "timeoutMs">> = {
  anthropic: (key) => ({
    url: "https://api.anthropic.com/v1/models?limit=1",
    headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
  }),
  openai: (key) => ({
    url: "https://api.openai.com/v1/models",
    headers: { Authorization: `Bearer ${key}` },
  }),
  mistral: (key) => ({
    url: "https://api.mistral.ai/v1/models",
    headers: { Authorization: `Bearer ${key}` },
  }),
};

export const probeAiConnectivity = async (
  config: AiConfig,
  deps: HttpProbeDeps = {},
): Promise<ConnectivityResult> => {
  const target = "ai" as const;
  const credentials = config.apiKeys[config.provider];
  if (!credentials) {
    return { target, ok: false, skipped: true, message: "No API key configured" };
  }
  if (config.provider === "bedrock") {
    // A live Bedrock check needs SigV4-signed control-plane calls; out of scope
    // for a lightweight probe, so it is reported as unsupported rather than faked.
    return { target, ok: false, skipped: true, message: "Live probe not supported for Bedrock" };
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const endpoint = AI_HTTP_ENDPOINT[config.provider](credentials as string);

  const start = Date.now();
  const outcome = await probeHttp({ ...endpoint, fetchFn, timeoutMs });
  return withMessage({ target, ok: outcome.ok, latencyMs: Date.now() - start }, outcome.message);
};

// Structural minio client so tests can inject a fake without a live endpoint.
interface BucketProbeClient {
  bucketExists(bucket: string): Promise<boolean>;
}

export type MinioClientFactory = (config: StorageConfig) => BucketProbeClient;

export const defaultMinioClientFactory: MinioClientFactory = (config) =>
  new MinioClient(minioClientOptions(config));

export interface StorageProbeDeps {
  clientFactory?: MinioClientFactory;
  timeoutMs?: number;
}

export const probeStorageConnectivity = async (
  config: StorageConfig,
  deps: StorageProbeDeps = {},
): Promise<ConnectivityResult> => {
  const target = "storage" as const;
  if (!config.endpoint || !config.accessKey || !config.secretKey || !config.bucket) {
    return { target, ok: false, skipped: true, message: "Storage is not configured" };
  }

  const clientFactory = deps.clientFactory ?? defaultMinioClientFactory;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const start = Date.now();
  try {
    const client = clientFactory(config);
    const exists = await withTimeout(client.bucketExists(config.bucket), timeoutMs);
    const latencyMs = Date.now() - start;
    return exists
      ? { target, ok: true, latencyMs }
      : { target, ok: false, latencyMs, message: `Bucket '${config.bucket}' not found` };
  } catch (cause) {
    return { target, ok: false, latencyMs: Date.now() - start, message: sanitizeCause(cause) };
  }
};

export const probeN8nConnectivity = async (
  config: N8nConfig,
  deps: HttpProbeDeps = {},
): Promise<ConnectivityResult> => {
  const target = "n8n" as const;
  if (!config.baseUrl || !config.apiKey) {
    return { target, ok: false, skipped: true, message: "n8n is not configured" };
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const start = Date.now();
  const outcome = await probeHttp({
    url: `${config.baseUrl}/api/v1/workflows?limit=1`,
    headers: { "X-N8N-API-KEY": config.apiKey, Accept: "application/json" },
    fetchFn,
    timeoutMs,
  });
  return withMessage({ target, ok: outcome.ok, latencyMs: Date.now() - start }, outcome.message);
};

export interface EmbeddingsProbeDeps {
  embeddingsProvider: IEmbeddingsProvider;
  openaiApiKey: string | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export const probeEmbeddingsConnectivity = async (
  config: EmbeddingsConfig,
  deps: EmbeddingsProbeDeps,
): Promise<ConnectivityResult> => {
  const target = "embeddings" as const;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  if (config.provider === "openai") {
    if (!deps.openaiApiKey) {
      return { target, ok: false, skipped: true, message: "No OpenAI API key configured" };
    }
    const fetchFn = deps.fetchFn ?? globalThis.fetch;
    const start = Date.now();
    const outcome = await probeHttp({
      url: "https://api.openai.com/v1/models",
      headers: { Authorization: `Bearer ${deps.openaiApiKey}` },
      fetchFn,
      timeoutMs,
    });
    return withMessage({ target, ok: outcome.ok, latencyMs: Date.now() - start }, outcome.message);
  }

  // Local provider: an in-process model load/health check by embedding a tiny string.
  const start = Date.now();
  try {
    const result = await withTimeout(deps.embeddingsProvider.embed("connectivity probe"), timeoutMs);
    const latencyMs = Date.now() - start;
    return result.error
      ? { target, ok: false, latencyMs, message: result.error.message }
      : { target, ok: true, latencyMs };
  } catch (cause) {
    return { target, ok: false, latencyMs: Date.now() - start, message: sanitizeCause(cause) };
  }
};

export interface GraphProbe {
  // Async because the directory's credentials are runtime config, resolved per
  // call rather than fixed at construction.
  isConfigured(): Promise<boolean>;
  get<T>(path: string, query?: Record<string, string>): Promise<Result<T>>;
}

export const probeEntraConnectivity = async (
  graph: GraphProbe,
  deps: { timeoutMs?: number } = {},
): Promise<ConnectivityResult> => {
  const target = "entra" as const;
  if (!(await graph.isConfigured())) {
    return { target, ok: false, skipped: true, message: "Microsoft Entra is not configured" };
  }

  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const start = Date.now();
  try {
    // Scoped permission probe: needs a valid token plus User.Read.All.
    const result = await withTimeout(graph.get("/users", { $top: "1", $select: "id" }), timeoutMs);
    const latencyMs = Date.now() - start;
    return result.error
      ? { target, ok: false, latencyMs, message: result.error.message }
      : { target, ok: true, latencyMs };
  } catch (cause) {
    return { target, ok: false, latencyMs: Date.now() - start, message: sanitizeCause(cause) };
  }
};

// ── per-method sign-in probes ────────────────────────────────────────────────
//
// One target per method rather than one aggregate: an operator needs to know
// which sign-in method is broken, not that "authentication" is (ADR-042 §5).
// None of these may put credential material in `message`.

const DEFAULT_ENTRA_AUTHORITY = "https://login.microsoftonline.com";

// The scope a client-credentials token is requested for. Any resource would
// prove the credentials are valid; Graph's default scope needs no application
// permission granted, which is the point — sign-in does not use User.Read.All.
const CLIENT_CREDENTIALS_SCOPE = "https://graph.microsoft.com/.default";

interface EntraProbeDeps extends HttpProbeDeps {
  // Overrides the login.microsoftonline.com host, for sovereign clouds and the
  // local mock. Env-only, exactly as the sign-in provider treats it.
  authority?: string;
}

export const probeAuthEntra = async (
  config: AuthConfig,
  deps: EntraProbeDeps = {},
): Promise<ConnectivityResult> => {
  const target = "auth-entra" as const;
  if (!config.entraEnabled) {
    return { target, ok: false, skipped: true, message: "Entra ID sign-in is not enabled" };
  }
  if (!isEntraConfigured(config.entra)) {
    return { target, ok: false, skipped: true, message: "Entra ID credentials are incomplete" };
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const authority = deps.authority ?? DEFAULT_ENTRA_AUTHORITY;
  const start = Date.now();

  const discovery = await fetchDiscoveryDocument(
    `${authority}/${config.entra.tenantId}/v2.0/.well-known/openid-configuration`,
    { fetchFn, timeoutMs },
  );
  if (!discovery.ok) {
    return { target, ok: false, latencyMs: Date.now() - start, message: discovery.message };
  }

  const token = await requestClientCredentialsToken(discovery.tokenEndpoint, config.entra, {
    fetchFn,
    timeoutMs,
  });
  const latencyMs = Date.now() - start;
  return token.error
    ? { target, ok: false, latencyMs, message: token.error }
    : { target, ok: true, latencyMs, message: "Authority reachable and credentials accepted" };
};

type DiscoveryOutcome = { ok: true; tokenEndpoint: string } | { ok: false; message: string };

const fetchDiscoveryDocument = async (
  url: string,
  deps: { fetchFn: typeof fetch; timeoutMs: number },
): Promise<DiscoveryOutcome> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const response = await deps.fetchFn(url, { method: "GET", signal: controller.signal });
    if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
    const document = (await response.json()) as { token_endpoint?: unknown };
    if (typeof document.token_endpoint !== "string") {
      return { ok: false, message: "Discovery document has no token endpoint" };
    }
    return { ok: true, tokenEndpoint: document.token_endpoint };
  } catch (cause) {
    if (controller.signal.aborted) return { ok: false, message: `Timed out after ${deps.timeoutMs}ms` };
    return { ok: false, message: sanitizeCause(cause) };
  } finally {
    clearTimeout(timer);
  }
};

const requestClientCredentialsToken = async (
  tokenEndpoint: string,
  entra: EntraCredentials,
  deps: { fetchFn: typeof fetch; timeoutMs: number },
): Promise<{ error?: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const response = await deps.fetchFn(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: entra.clientId,
        client_secret: entra.clientSecret,
        grant_type: "client_credentials",
        scope: CLIENT_CREDENTIALS_SCOPE,
      }).toString(),
      signal: controller.signal,
    });
    // Status only. The error body echoes the request context back, so it is
    // never read into a message an admin will see.
    return response.ok ? {} : { error: `HTTP ${response.status}` };
  } catch (cause) {
    if (controller.signal.aborted) return { error: `Timed out after ${deps.timeoutMs}ms` };
    return { error: sanitizeCause(cause) };
  } finally {
    clearTimeout(timer);
  }
};

// Configuration only, and it says so. The application sits behind the mTLS
// proxy and cannot originate a client-certificate handshake, so there is no
// honest way to prove sign-in works from here (ADR-042 §5).
export const probeAuthPki = async (
  config: AuthConfig,
  envHasTrustedProxies: boolean,
): Promise<ConnectivityResult> => {
  const target = "auth-pki" as const;
  if (!config.pkiEnabled) {
    return { target, ok: false, skipped: true, message: "Certificate sign-in is not enabled" };
  }
  if (!envHasTrustedProxies) {
    return {
      target,
      ok: false,
      message: "PKI_TRUSTED_PROXY_IPS is not set to a valid address in the environment",
    };
  }
  return {
    target,
    ok: true,
    message: "Configuration verified — a trusted proxy is set and certificate sign-in is on",
  };
};

export interface CredentialAccountProbe {
  countAccountsWithPassword(): Promise<number>;
}

export const probeAuthEmailPassword = async (
  config: AuthConfig,
  deps: CredentialAccountProbe,
): Promise<ConnectivityResult> => {
  const target = "auth-email-password" as const;
  if (!config.emailPasswordEnabled) {
    return { target, ok: false, skipped: true, message: "Email + password sign-in is not enabled" };
  }

  const start = Date.now();
  try {
    const withPassword = await deps.countAccountsWithPassword();
    const latencyMs = Date.now() - start;
    return withPassword > 0
      ? { target, ok: true, latencyMs, message: "Credential sign-in is on and an account can use it" }
      : {
          target,
          ok: false,
          latencyMs,
          message: "Enabled, but no account has a password set — nobody can sign in this way",
        };
  } catch (cause) {
    return { target, ok: false, latencyMs: Date.now() - start, message: sanitizeCause(cause) };
  }
};

export interface EmailProbe {
  isConfigured(): Promise<boolean>;
  testConnectivity(): Promise<Result<true>>;
}

export const probeEmailConnectivity = async (
  emailSender: EmailProbe,
  deps: { timeoutMs?: number } = {},
): Promise<ConnectivityResult> => {
  const target = "email" as const;
  if (!(await emailSender.isConfigured())) {
    return { target, ok: false, skipped: true, message: "Email is not configured" };
  }

  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const start = Date.now();
  try {
    const result = await withTimeout(emailSender.testConnectivity(), timeoutMs);
    const latencyMs = Date.now() - start;
    return result.error
      ? { target, ok: false, latencyMs, message: result.error.message }
      : { target, ok: true, latencyMs };
  } catch (cause) {
    return { target, ok: false, latencyMs: Date.now() - start, message: sanitizeCause(cause) };
  }
};
