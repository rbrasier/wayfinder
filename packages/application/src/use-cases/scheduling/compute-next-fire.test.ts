import { describe, expect, it } from "vitest";
import { computeNextFireAt, parseRelativeDuration } from "./compute-next-fire";

const anchor = new Date("2026-06-03T10:00:00.000Z");

describe("parseRelativeDuration", () => {
  it("parses days, hours, minutes, weeks and seconds", () => {
    expect(parseRelativeDuration("30d").data).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseRelativeDuration("2h").data).toBe(2 * 60 * 60 * 1000);
    expect(parseRelativeDuration("15m").data).toBe(15 * 60 * 1000);
    expect(parseRelativeDuration("1w").data).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseRelativeDuration("45s").data).toBe(45 * 1000);
  });

  it("rejects an unparseable duration", () => {
    expect(parseRelativeDuration("soon").error?.code).toBe("VALIDATION_FAILED");
    expect(parseRelativeDuration("10y").error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("computeNextFireAt", () => {
  it("adds a relative duration to the anchor", () => {
    const result = computeNextFireAt({ kind: "relative", spec: "30d", anchor });
    expect(result.data?.toISOString()).toBe("2026-07-03T10:00:00.000Z");
  });

  it("uses the literal spec timestamp for `at` when provided", () => {
    const result = computeNextFireAt({
      kind: "at",
      spec: "2026-12-25T09:00:00.000Z",
      anchor,
    });
    expect(result.data?.toISOString()).toBe("2026-12-25T09:00:00.000Z");
  });

  it("falls back to the anchor itself for `at` when the spec is empty", () => {
    const result = computeNextFireAt({ kind: "at", spec: "", anchor });
    expect(result.data?.toISOString()).toBe(anchor.toISOString());
  });

  it("computes the next cron time forward from the anchor", () => {
    const result = computeNextFireAt({ kind: "cron", spec: "0 9 * * *", anchor });
    expect(result.data?.toISOString()).toBe("2026-06-04T09:00:00.000Z");
  });

  it("fails on an unparseable relative spec", () => {
    const result = computeNextFireAt({ kind: "relative", spec: "later", anchor });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("fails on an unparseable `at` timestamp", () => {
    const result = computeNextFireAt({ kind: "at", spec: "not-a-date", anchor });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
