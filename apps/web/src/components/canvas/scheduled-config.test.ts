import { describe, expect, it } from "vitest";
import type { RecurrenceRule } from "@rbrasier/domain";
import { recurrenceSummary } from "./scheduled-config";

describe("recurrenceSummary", () => {
  it("renders a human summary for a legacy recurrence rule", () => {
    const rule: RecurrenceRule = {
      frequency: "weekly",
      interval: 2,
      weekdays: [1],
      hour: 14,
      minute: 30,
      timezone: "UTC",
    };
    expect(recurrenceSummary(JSON.stringify(rule))).toBe("Every 2 weeks on Mon at 2:30 PM");
  });

  it("falls back to a generic label when the spec is not a recurrence rule", () => {
    expect(recurrenceSummary("garbage")).toBe("Custom schedule");
  });
});
