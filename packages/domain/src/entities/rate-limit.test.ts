import { describe, expect, it } from "vitest";
import { consumeToken, newTokenBucket, type RateLimitConfig } from "./rate-limit";

const config: RateLimitConfig = { capacity: 3, refillPerSecond: 1 };

describe("consumeToken", () => {
  it("allows requests up to capacity, then throttles", () => {
    let bucket = newTokenBucket(config, 0);

    // Three tokens in a full bucket → three allowed at the same instant.
    for (let attempt = 0; attempt < 3; attempt++) {
      const decision = consumeToken(bucket, config, 0);
      expect(decision.allowed).toBe(true);
      bucket = decision.bucket;
    }

    const throttled = consumeToken(bucket, config, 0);
    expect(throttled.allowed).toBe(false);
    expect(throttled.retryAfterMs).toBe(1000);
  });

  it("refills over time so a drained bucket allows again after the interval", () => {
    let bucket = newTokenBucket(config, 0);
    for (let attempt = 0; attempt < 3; attempt++) {
      bucket = consumeToken(bucket, config, 0).bucket;
    }

    // One second later, one token has refilled.
    const decision = consumeToken(bucket, config, 1000);
    expect(decision.allowed).toBe(true);
  });

  it("never refills beyond capacity", () => {
    const bucket = newTokenBucket(config, 0);
    // A long idle period cannot bank more than `capacity` tokens.
    const decision = consumeToken(bucket, config, 60_000);
    expect(decision.bucket.tokens).toBe(config.capacity - 1);
  });

  it("reports an infinite wait when refill is disabled and the bucket is empty", () => {
    const noRefill: RateLimitConfig = { capacity: 1, refillPerSecond: 0 };
    let bucket = newTokenBucket(noRefill, 0);
    bucket = consumeToken(bucket, noRefill, 0).bucket;

    const decision = consumeToken(bucket, noRefill, 10_000);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBe(Number.POSITIVE_INFINITY);
  });
});
