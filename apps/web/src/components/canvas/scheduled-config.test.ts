import { describe, expect, it } from "vitest";
import {
  buildRecurrenceRule,
  isoToLocalParts,
  localPartsToIso,
  recurrenceSummary,
} from "./scheduled-config";

describe("localPartsToIso / isoToLocalParts", () => {
  it("round-trips local wall-clock parts through an ISO string", () => {
    const parts = { year: 2026, month: 6, day: 15, hour: 9, minute: 30 };
    const roundTripped = isoToLocalParts(localPartsToIso(parts));
    expect(roundTripped).toEqual(parts);
  });

  it("returns null for an unparseable ISO string", () => {
    expect(isoToLocalParts("not-a-date")).toBeNull();
  });
});

describe("buildRecurrenceRule", () => {
  const base = {
    interval: 1,
    weekdays: [1, 3],
    monthDay: 15,
    hour: 9,
    minute: 0,
    timezone: "Europe/London",
  };

  it("omits weekdays and monthDay for a daily rule", () => {
    const rule = buildRecurrenceRule({ ...base, frequency: "daily" });
    expect(rule).toEqual({
      frequency: "daily",
      interval: 1,
      hour: 9,
      minute: 0,
      timezone: "Europe/London",
    });
  });

  it("includes weekdays for a weekly rule", () => {
    const rule = buildRecurrenceRule({ ...base, frequency: "weekly" });
    expect(rule.weekdays).toEqual([1, 3]);
    expect(rule.monthDay).toBeUndefined();
  });

  it("includes monthDay for a monthly rule", () => {
    const rule = buildRecurrenceRule({ ...base, frequency: "monthly" });
    expect(rule.monthDay).toBe(15);
    expect(rule.weekdays).toBeUndefined();
  });

  it("clamps an interval below one up to one", () => {
    const rule = buildRecurrenceRule({ ...base, frequency: "daily", interval: 0 });
    expect(rule.interval).toBe(1);
  });
});

describe("recurrenceSummary", () => {
  it("renders a human summary, falling back when the spec is invalid", () => {
    const rule = buildRecurrenceRule({
      frequency: "weekly",
      interval: 2,
      weekdays: [1],
      monthDay: 1,
      hour: 14,
      minute: 30,
      timezone: "UTC",
    });
    expect(recurrenceSummary(JSON.stringify(rule))).toBe("Every 2 weeks on Mon at 2:30 PM");
    expect(recurrenceSummary("garbage")).toBe("Custom schedule");
  });
});
