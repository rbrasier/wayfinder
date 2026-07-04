import { describe, expect, it, vi } from "vitest";
import { ConcurrencyLimiter, LlmCallGovernor, isRetryableProviderError, withRetry } from "./llm-concurrency";

const immediateSleep = () => Promise.resolve();

describe("ConcurrencyLimiter", () => {
  it("never runs more than the configured number of tasks at once", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;
    const gate: (() => void)[] = [];
    const started: Promise<void>[] = [];

    const makeTask = () => {
      let signalStarted!: () => void;
      started.push(new Promise<void>((resolve) => (signalStarted = resolve)));
      return limiter.run(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            peak = Math.max(peak, active);
            signalStarted();
            gate.push(() => {
              active -= 1;
              resolve();
            });
          }),
      );
    };

    const running = [makeTask(), makeTask(), makeTask(), makeTask()];

    // Only the first two may start; tasks 3 and 4 are queued behind the limit.
    await Promise.all([started[0], started[1]]);
    expect(active).toBe(2);
    expect(peak).toBe(2);

    // Releasing one admits exactly one queued task, never exceeding the limit.
    gate.shift()?.();
    await started[2];
    expect(peak).toBe(2);
    gate.shift()?.();
    await started[3];
    while (gate.length) gate.shift()?.();

    await Promise.all(running);
    expect(peak).toBe(2);
  });

  it("releases its slot even when the task rejects", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await expect(limiter.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    // A following task must still be able to acquire the freed slot.
    await expect(limiter.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("treats a non-positive limit as unlimited (disabled)", async () => {
    const limiter = new ConcurrencyLimiter(0);
    await expect(limiter.run(() => Promise.resolve(42))).resolves.toBe(42);
  });
});

describe("isRetryableProviderError", () => {
  it("retries rate limits and 5xx, but not client errors", () => {
    expect(isRetryableProviderError({ statusCode: 429 })).toBe(true);
    expect(isRetryableProviderError({ statusCode: 503 })).toBe(true);
    expect(isRetryableProviderError({ statusCode: 400 })).toBe(false);
    expect(isRetryableProviderError({ statusCode: 401 })).toBe(false);
  });

  it("treats a flagged-retryable SDK error as retryable regardless of status", () => {
    expect(isRetryableProviderError({ isRetryable: true })).toBe(true);
  });
});

describe("withRetry", () => {
  it("returns the first successful result without sleeping", async () => {
    const sleep = vi.fn(immediateSleep);
    const call = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(call, { sleep });
    expect(result).toBe("ok");
    expect(call).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a rate-limited call and succeeds on a later attempt", async () => {
    const sleep = vi.fn(immediateSleep);
    const call = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValue("recovered");
    const result = await withRetry(call, { sleep, baseDelayMs: 10, random: () => 0 });
    expect(result).toBe("recovered");
    expect(call).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("honours a Retry-After header over the computed backoff", async () => {
    const sleep = vi.fn(immediateSleep);
    const call = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 429, responseHeaders: { "retry-after": "5" } })
      .mockResolvedValue("ok");
    await withRetry(call, { sleep, baseDelayMs: 10, maxDelayMs: 100_000, random: () => 0 });
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("gives up after maxAttempts and rethrows the last error", async () => {
    const sleep = vi.fn(immediateSleep);
    const call = vi.fn().mockRejectedValue({ statusCode: 503 });
    await expect(
      withRetry(call, { sleep, maxAttempts: 3, baseDelayMs: 1, random: () => 0 }),
    ).rejects.toEqual({ statusCode: 503 });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable error", async () => {
    const sleep = vi.fn(immediateSleep);
    const call = vi.fn().mockRejectedValue({ statusCode: 400 });
    await expect(withRetry(call, { sleep })).rejects.toEqual({ statusCode: 400 });
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("LlmCallGovernor", () => {
  it("bounds concurrency and retries under the same call", async () => {
    const governor = new LlmCallGovernor({ maxConcurrent: 1, sleep: immediateSleep, baseDelayMs: 1, random: () => 0 });
    const call = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValue("done");
    await expect(governor.run(call)).resolves.toBe("done");
    expect(call).toHaveBeenCalledTimes(2);
  });
});
