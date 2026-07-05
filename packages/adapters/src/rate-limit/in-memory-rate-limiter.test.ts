import { describe, expect, it } from "vitest";
import type { IClock } from "@rbrasier/domain";
import { InMemoryRateLimiter } from "./in-memory-rate-limiter";

// A clock the test advances by hand so refill behaviour is deterministic.
class FakeClock implements IClock {
  constructor(private ms: number = 0) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

describe("InMemoryRateLimiter", () => {
  it("allows a burst up to capacity then returns not-allowed with a retry hint", async () => {
    const clock = new FakeClock();
    const limiter = new InMemoryRateLimiter({ capacity: 2, refillPerSecond: 1 }, 100, clock);

    expect((await limiter.consume("ip-1")).data?.allowed).toBe(true);
    expect((await limiter.consume("ip-1")).data?.allowed).toBe(true);

    const throttled = await limiter.consume("ip-1");
    expect(throttled.data?.allowed).toBe(false);
    expect(throttled.data?.retryAfterMs).toBeGreaterThan(0);
  });

  it("keeps separate buckets per key", async () => {
    const clock = new FakeClock();
    const limiter = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 1 }, 100, clock);

    expect((await limiter.consume("user-a")).data?.allowed).toBe(true);
    // A different key has its own full bucket.
    expect((await limiter.consume("user-b")).data?.allowed).toBe(true);
    // The first key is now empty.
    expect((await limiter.consume("user-a")).data?.allowed).toBe(false);
  });

  it("allows again once enough time has passed to refill", async () => {
    const clock = new FakeClock();
    const limiter = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 1 }, 100, clock);

    expect((await limiter.consume("ip-1")).data?.allowed).toBe(true);
    expect((await limiter.consume("ip-1")).data?.allowed).toBe(false);

    clock.advance(1000);
    expect((await limiter.consume("ip-1")).data?.allowed).toBe(true);
  });

  it("is disabled when capacity is non-positive — every request passes", async () => {
    const clock = new FakeClock();
    const limiter = new InMemoryRateLimiter({ capacity: 0, refillPerSecond: 0 }, 100, clock);

    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await limiter.consume("ip-1")).data?.allowed).toBe(true);
    }
  });
});
