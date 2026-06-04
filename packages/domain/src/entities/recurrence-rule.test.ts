import { describe, expect, it } from "vitest";
import {
  describeRecurrenceRule,
  parseRecurrenceRule,
  serializeRecurrenceRule,
  type RecurrenceRule,
} from "./recurrence-rule";

const daily: RecurrenceRule = {
  frequency: "daily",
  interval: 1,
  hour: 9,
  minute: 0,
  timezone: "Europe/London",
};

const weekly: RecurrenceRule = {
  frequency: "weekly",
  interval: 2,
  weekdays: [1, 3],
  hour: 14,
  minute: 30,
  timezone: "Europe/London",
};

const monthly: RecurrenceRule = {
  frequency: "monthly",
  interval: 1,
  monthDay: 15,
  hour: 8,
  minute: 5,
  timezone: "America/New_York",
};

describe("serializeRecurrenceRule / parseRecurrenceRule", () => {
  it("round-trips a daily rule", () => {
    const parsed = parseRecurrenceRule(serializeRecurrenceRule(daily));
    expect(parsed.data).toEqual(daily);
  });

  it("round-trips a weekly rule with weekdays", () => {
    const parsed = parseRecurrenceRule(serializeRecurrenceRule(weekly));
    expect(parsed.data).toEqual(weekly);
  });

  it("round-trips a monthly rule with a month-day", () => {
    const parsed = parseRecurrenceRule(serializeRecurrenceRule(monthly));
    expect(parsed.data).toEqual(monthly);
  });

  it("rejects a non-JSON spec", () => {
    expect(parseRecurrenceRule("0 9 * * *").error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an unknown frequency", () => {
    const spec = JSON.stringify({ ...daily, frequency: "yearly" });
    expect(parseRecurrenceRule(spec).error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an interval below one", () => {
    const spec = JSON.stringify({ ...daily, interval: 0 });
    expect(parseRecurrenceRule(spec).error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an out-of-range hour", () => {
    const spec = JSON.stringify({ ...daily, hour: 24 });
    expect(parseRecurrenceRule(spec).error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an out-of-range minute", () => {
    const spec = JSON.stringify({ ...daily, minute: 60 });
    expect(parseRecurrenceRule(spec).error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an invalid weekday", () => {
    const spec = JSON.stringify({ ...weekly, weekdays: [7] });
    expect(parseRecurrenceRule(spec).error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an out-of-range month-day", () => {
    const spec = JSON.stringify({ ...monthly, monthDay: 32 });
    expect(parseRecurrenceRule(spec).error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a missing timezone", () => {
    const spec = JSON.stringify({ ...daily, timezone: "" });
    expect(parseRecurrenceRule(spec).error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("describeRecurrenceRule", () => {
  it("describes a simple daily rule", () => {
    expect(describeRecurrenceRule(daily)).toBe("Every day at 9:00 AM");
  });

  it("describes a multi-day interval", () => {
    expect(describeRecurrenceRule({ ...daily, interval: 3 })).toBe("Every 3 days at 9:00 AM");
  });

  it("describes a weekly rule with weekdays", () => {
    expect(describeRecurrenceRule(weekly)).toBe("Every 2 weeks on Mon, Wed at 2:30 PM");
  });

  it("describes a monthly rule on a given day", () => {
    expect(describeRecurrenceRule(monthly)).toBe("Every month on day 15 at 8:05 AM");
  });
});
