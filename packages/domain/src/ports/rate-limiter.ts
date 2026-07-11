import type { Result } from "../result";

export interface RateLimitOutcome {
  allowed: boolean;
  // Milliseconds the caller should wait before retrying; 0 when allowed.
  retryAfterMs: number;
}

export interface IRateLimiter {
  // Consume one unit against `key`'s bucket (key = user id or IP). Returns
  // `allowed: false` with a retry hint when the bucket is empty. Async so the
  // infrastructure phase can back this with a shared store (Redis INCR+EXPIRE)
  // behind the same port without changing callers. An error Result signals the
  // limiter itself failed — callers fail open.
  consume(key: string): Promise<Result<RateLimitOutcome>>;
}
