import { describe, expect, it } from "vitest";
import { nextCronTime } from "./cron";

const from = new Date("2026-06-03T10:15:30.000Z");

describe("nextCronTime", () => {
  it("computes the next minute for every-minute cron, strictly forward", () => {
    const result = nextCronTime("* * * * *", from);
    expect(result.error).toBeUndefined();
    // Seconds are dropped and the time advances to the next whole minute.
    expect(result.data?.toISOString()).toBe("2026-06-03T10:16:00.000Z");
  });

  it("computes the next matching hour:minute", () => {
    const result = nextCronTime("30 14 * * *", from);
    expect(result.data?.toISOString()).toBe("2026-06-03T14:30:00.000Z");
  });

  it("rolls over to the next day when today's time has passed", () => {
    const result = nextCronTime("0 9 * * *", from);
    expect(result.data?.toISOString()).toBe("2026-06-04T09:00:00.000Z");
  });

  it("honours day-of-week (Monday at 09:00)", () => {
    // 2026-06-03 is a Wednesday; next Monday is 2026-06-08.
    const result = nextCronTime("0 9 * * 1", from);
    expect(result.data?.toISOString()).toBe("2026-06-08T09:00:00.000Z");
  });

  it("supports step values", () => {
    const result = nextCronTime("*/15 * * * *", from);
    expect(result.data?.toISOString()).toBe("2026-06-03T10:30:00.000Z");
  });

  it("supports lists and ranges", () => {
    const result = nextCronTime("0 9-17 * * 1-5", new Date("2026-06-03T20:00:00.000Z"));
    expect(result.data?.toISOString()).toBe("2026-06-04T09:00:00.000Z");
  });

  it("returns a validation error for a malformed expression", () => {
    const result = nextCronTime("not a cron", from);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns a validation error for an out-of-range field", () => {
    const result = nextCronTime("99 * * * *", from);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
