import { Client as MinioClient } from "minio";
import type {
  AiConfig,
  ConnectivityResult,
  EmbeddingsConfig,
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
  new MinioClient({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    pathStyle: true,
  });

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
  isConfigured(): boolean;
  get<T>(path: string, query?: Record<string, string>): Promise<Result<T>>;
}

export const probeEntraConnectivity = async (
  graph: GraphProbe,
  deps: { timeoutMs?: number } = {},
): Promise<ConnectivityResult> => {
  const target = "entra" as const;
  if (!graph.isConfigured()) {
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
