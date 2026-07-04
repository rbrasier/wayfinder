// Per-instance governance for provider (LLM) calls: a concurrency limiter plus
// retry-with-backoff that honours provider rate-limit headers (scaling wall #5).
// A single conversational turn can issue up to six model calls, so 500 concurrent
// turns mean thousands of in-flight provider requests — enough to trip TPM/RPM
// limits long before the DB hurts. This bounds in-flight calls per web instance
// and backs off politely instead of hammering a throttled provider.

// Bounds how many tasks run at once. A non-positive limit means "unlimited",
// which is the zero-overhead disabled path.
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.maxConcurrent <= 0) return;
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    if (this.maxConcurrent <= 0) return;
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const readStatusCode = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { statusCode?: unknown; status?: unknown };
  const value = candidate.statusCode ?? candidate.status;
  return typeof value === "number" ? value : undefined;
};

// Duck-typed so it works across AI SDK provider error shapes without importing a
// specific error class (those change between SDK versions). Rate limits (429) and
// server/transient errors (5xx) are worth retrying; client errors (4xx) are not.
export const isRetryableProviderError = (error: unknown): boolean => {
  if (typeof error === "object" && error !== null && "isRetryable" in error) {
    const flag = (error as { isRetryable?: unknown }).isRetryable;
    if (typeof flag === "boolean") return flag;
  }
  const status = readStatusCode(error);
  if (status === undefined) return false;
  return status === 429 || (status >= 500 && status <= 599);
};

// Provider errors may carry a Retry-After (seconds) telling us exactly how long
// to wait. Respect it rather than guessing when present.
const readRetryAfterMs = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const headers = (error as { responseHeaders?: Record<string, string> }).responseHeaders;
  const raw =
    headers?.["retry-after"] ?? headers?.["Retry-After"] ??
    (error as { retryAfter?: unknown }).retryAfter;
  const seconds = typeof raw === "string" ? Number.parseFloat(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const DEFAULTS = { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 20_000 } as const;

export async function withRetry<T>(call: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const isRetryable = options.isRetryable ?? isRetryableProviderError;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await call();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      // Full jitter spreads retries so a fleet of instances does not resynchronise
      // into a thundering herd against the provider.
      const jittered = exponential * (0.5 + random() * 0.5);
      const retryAfter = readRetryAfterMs(error);
      await sleep(Math.max(jittered, retryAfter ?? 0));
    }
  }
}

export interface LlmCallGovernorOptions extends RetryOptions {
  maxConcurrent?: number;
}

// Composes the limiter and the retry policy: bound concurrency on the outside so
// a retrying call keeps holding its slot (a retry is the same logical request),
// and back off within it.
export class LlmCallGovernor {
  private readonly limiter: ConcurrencyLimiter;
  private readonly retryOptions: RetryOptions;

  constructor(options: LlmCallGovernorOptions = {}) {
    this.limiter = new ConcurrencyLimiter(options.maxConcurrent ?? 0);
    this.retryOptions = options;
  }

  run<T>(call: () => Promise<T>): Promise<T> {
    return this.limiter.run(() => withRetry(call, this.retryOptions));
  }
}
