export interface RateLimitConfig {
  // Maximum tokens the bucket holds — the largest burst allowed before requests
  // start being throttled.
  capacity: number;
  // Tokens replenished per second once the bucket has drained.
  refillPerSecond: number;
}

export interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  // Milliseconds until a token is available again; 0 when the request is allowed.
  retryAfterMs: number;
  bucket: TokenBucket;
}

export const newTokenBucket = (config: RateLimitConfig, nowMs: number): TokenBucket => ({
  tokens: config.capacity,
  lastRefillMs: nowMs,
});

// Pure token-bucket step: refill by the time elapsed since the last read (capped
// at capacity), then take one token if at least one is available. Returns the
// decision and the next bucket state so the caller can persist it. Assumes
// `config.capacity >= 1`; a disabled limiter is handled by the caller.
export const consumeToken = (
  bucket: TokenBucket,
  config: RateLimitConfig,
  nowMs: number,
): RateLimitDecision => {
  const elapsedMs = Math.max(0, nowMs - bucket.lastRefillMs);
  const refilled = Math.min(
    config.capacity,
    bucket.tokens + (elapsedMs / 1000) * config.refillPerSecond,
  );

  if (refilled >= 1) {
    return { allowed: true, retryAfterMs: 0, bucket: { tokens: refilled - 1, lastRefillMs: nowMs } };
  }

  const missing = 1 - refilled;
  const retryAfterMs =
    config.refillPerSecond > 0
      ? Math.ceil((missing / config.refillPerSecond) * 1000)
      : Number.POSITIVE_INFINITY;
  return { allowed: false, retryAfterMs, bucket: { tokens: refilled, lastRefillMs: nowMs } };
};
