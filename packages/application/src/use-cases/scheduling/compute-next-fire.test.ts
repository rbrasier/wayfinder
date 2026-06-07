import { serializeRecurrenceRule, type RecurrenceRule } from "@rbrasier/domain";
import { describe, expect, it } from "vitest";
import { computeNextFireAt, computeNextRecurrence, parseRelativeDuration } from "./compute-next-fire";

const anchor = new Date("2026-06-03T10:00:00.000Z");

const utcRule = (overrides: Partial<RecurrenceRule>): RecurrenceRule => ({
  frequency: "daily",
  interval: 1,
  hour: 9,
  minute: 0,
  timezone: "UTC",
  ...overrides,
});

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

  it("subtracts a relative duration when direction is `before`", () => {
    const result = computeNextFireAt({ kind: "relative", spec: "30d", anchor, direction: "before" });
    expect(result.data?.toISOString()).toBe("2026-05-04T10:00:00.000Z");
  });

  it("adds a relative duration when direction is explicitly `after`", () => {
    const result = computeNextFireAt({ kind: "relative", spec: "2h", anchor, direction: "after" });
    expect(result.data?.toISOString()).toBe("2026-06-03T12:00:00.000Z");
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

  it("computes the next daily recurrence forward from the anchor", () => {
    const result = computeNextFireAt({
      kind: "recurrence",
      spec: serializeRecurrenceRule(utcRule({})),
      anchor,
    });
    expect(result.data?.toISOString()).toBe("2026-06-04T09:00:00.000Z");
  });

  it("anchors a recurrence interval to `start`, not to the from-instant", () => {
    const result = computeNextFireAt({
      kind: "recurrence",
      spec: serializeRecurrenceRule(utcRule({ interval: 2 })),
      anchor: new Date("2026-06-06T09:30:00.000Z"),
      start: anchor,
    });
    // start = 06-03, interval 2 → 06-05, 06-07, ...; the next slot after 06-06 09:30.
    expect(result.data?.toISOString()).toBe("2026-06-07T09:00:00.000Z");
  });

  it("fails on an unparseable recurrence spec", () => {
    const result = computeNextFireAt({ kind: "recurrence", spec: "0 9 * * *", anchor });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("computeNextRecurrence", () => {
  const start = new Date("2026-06-03T10:00:00.000Z"); // Wednesday

  it("skips a slot that has already passed today", () => {
    const result = computeNextRecurrence(utcRule({}), start, start);
    expect(result.data?.toISOString()).toBe("2026-06-04T09:00:00.000Z");
  });

  it("honours a multi-day interval counted from the start", () => {
    const result = computeNextRecurrence(utcRule({ interval: 2 }), start, start);
    expect(result.data?.toISOString()).toBe("2026-06-05T09:00:00.000Z");
  });

  it("picks the next listed weekday for a weekly rule", () => {
    const result = computeNextRecurrence(
      utcRule({ frequency: "weekly", weekdays: [1, 3] }),
      start,
      start,
    );
    expect(result.data?.toISOString()).toBe("2026-06-08T09:00:00.000Z");
  });

  it("picks the configured day for a monthly rule", () => {
    const result = computeNextRecurrence(
      utcRule({ frequency: "monthly", monthDay: 15, hour: 8, minute: 5 }),
      start,
      start,
    );
    expect(result.data?.toISOString()).toBe("2026-06-15T08:05:00.000Z");
  });

  it("keeps the wall-clock time across a DST spring-forward", () => {
    const newYorkStart = new Date("2026-03-07T18:00:00.000Z");
    const result = computeNextRecurrence(
      { frequency: "daily", interval: 1, hour: 9, minute: 0, timezone: "America/New_York" },
      newYorkStart,
      newYorkStart,
    );
    // 9am on 2026-03-08 is EDT (UTC-4) → 13:00Z, not 14:00Z.
    expect(result.data?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
});
