import {
  consumeToken,
  newTokenBucket,
  ok,
  type IClock,
  type IRateLimiter,
  type RateLimitConfig,
  type RateLimitOutcome,
  type Result,
  type TokenBucket,
} from "@rbrasier/domain";

/**
 * Per-instance token-bucket rate limiter. Correct for a single instance; when
 * more than one instance runs, promote to a shared store (Redis INCR+EXPIRE)
 * behind this same `IRateLimiter` port — see the scaling-new-infrastructure
 * phase doc. Keys are insertion-ordered so eviction drops the least-recently
 * created bucket, bounding memory under a flood of distinct keys (many IPs or
 * users). Mirrors the in-process `TtlCache` shape and lifecycle.
 */
export class InMemoryRateLimiter implements IRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly maxKeys: number,
    private readonly clock: IClock,
  ) {}

  async consume(key: string): Promise<Result<RateLimitOutcome>> {
    // A non-positive capacity disables the limiter — every request passes, no
    // state retained. Lets a deployment turn a limiter off via config.
    if (this.config.capacity <= 0) return ok({ allowed: true, retryAfterMs: 0 });

    const nowMs = this.clock.now().getTime();
    const existing = this.buckets.get(key) ?? newTokenBucket(this.config, nowMs);
    const decision = consumeToken(existing, this.config, nowMs);

    // Re-insert so the key moves to the most-recent position for eviction order.
    this.buckets.delete(key);
    this.buckets.set(key, decision.bucket);
    if (this.buckets.size > this.maxKeys) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey !== undefined) this.buckets.delete(oldestKey);
    }

    return ok({ allowed: decision.allowed, retryAfterMs: decision.retryAfterMs });
  }
}
