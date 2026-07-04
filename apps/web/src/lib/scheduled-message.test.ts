import { describe, expect, it } from "vitest";
import {
  formatDurationUntil,
  formatScheduledResume,
  parseScheduledMessage,
} from "./scheduled-message";

describe("formatDurationUntil", () => {
  const now = new Date("2026-07-04T12:00:00.000Z");
  const after = (ms: number): Date => new Date(now.getTime() + ms);

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;

  it("picks the largest appropriate unit and shows only one", () => {
    expect(formatDurationUntil(after(2 * MONTH), now)).toBe("2 months");
    expect(formatDurationUntil(after(2 * WEEK), now)).toBe("2 weeks");
    expect(formatDurationUntil(after(3 * DAY), now)).toBe("3 days");
    expect(formatDurationUntil(after(3 * HOUR), now)).toBe("3 hours");
    expect(formatDurationUntil(after(5 * MINUTE), now)).toBe("5 minutes");
    expect(formatDurationUntil(after(5 * SECOND), now)).toBe("5 seconds");
  });

  it("singularises a value of one", () => {
    expect(formatDurationUntil(after(MONTH), now)).toBe("1 month");
    expect(formatDurationUntil(after(DAY), now)).toBe("1 day");
    expect(formatDurationUntil(after(MINUTE), now)).toBe("1 minute");
  });

  it("prefers weeks over days once seven days pass, and months over weeks", () => {
    expect(formatDurationUntil(after(10 * DAY), now)).toBe("1 week");
    expect(formatDurationUntil(after(40 * DAY), now)).toBe("1 month");
  });

  it("returns a shortly fallback when the target is now or in the past", () => {
    expect(formatDurationUntil(now, now)).toBe("shortly");
    expect(formatDurationUntil(after(-HOUR), now)).toBe("shortly");
  });
});

describe("parseScheduledMessage", () => {
  it("extracts the step name and fire time from a scheduled system message", () => {
    const parsed = parseScheduledMessage(
      "Scheduled step: Pause. Next: 2026-07-04T11:33:53.214Z.",
    );
    expect(parsed?.stepName).toBe("Pause");
    expect(parsed?.nextFireAt.toISOString()).toBe("2026-07-04T11:33:53.214Z");
  });

  it("handles step names containing punctuation", () => {
    const parsed = parseScheduledMessage(
      "Scheduled step: Wait based on input. Next: 2025-01-10T12:00:15.000Z.",
    );
    expect(parsed?.stepName).toBe("Wait based on input");
    expect(parsed?.nextFireAt.toISOString()).toBe("2025-01-10T12:00:15.000Z");
  });

  it("returns null for non-scheduled or failure messages", () => {
    expect(parseScheduledMessage("Hello there")).toBeNull();
    expect(
      parseScheduledMessage('Scheduled step "Pause" could not start: bad spec'),
    ).toBeNull();
    expect(parseScheduledMessage("Scheduled step: Pause. Next: not-a-date.")).toBeNull();
  });
});

describe("formatScheduledResume", () => {
  it("renders the step name, remaining time and local resume time", () => {
    const now = new Date("2026-07-04T12:00:00.000Z");
    const nextFireAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const rendered = formatScheduledResume("Pause", nextFireAt, now);
    expect(rendered).toContain("Pause — Will resume in 3 days (");
    expect(rendered.endsWith(").")).toBe(true);
  });
});
