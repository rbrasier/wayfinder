import { describe, it, expect } from "vitest";
import {
  ESTIMATE_PRESETS,
  HOURS_PER_WORKING_DAY,
  MINUTES_PER_HOUR,
  fromDaysAndHours,
  isSubmittable,
  presetMinutes,
  shouldPromptForEstimate,
  toDaysAndHours,
  type EstimateDraft,
} from "./manual-estimate-state";

describe("shouldPromptForEstimate", () => {
  it("asks the owner once their session has finished", () => {
    expect(
      shouldPromptForEstimate({
        status: "complete",
        isOwner: true,
        alreadyEstimated: false,
        dismissed: false,
      }),
    ).toBe(true);
  });

  it.each(["abandoned", "cancelled"] as const)(
    "asks on a %s session — the work up to the drop point still counts",
    (status) => {
      expect(
        shouldPromptForEstimate({ status, isOwner: true, alreadyEstimated: false, dismissed: false }),
      ).toBe(true);
    },
  );

  it("stays quiet while the session is still active", () => {
    expect(
      shouldPromptForEstimate({
        status: "active",
        isOwner: true,
        alreadyEstimated: false,
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("never asks someone who did not run the session", () => {
    expect(
      shouldPromptForEstimate({
        status: "complete",
        isOwner: false,
        alreadyEstimated: false,
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("does not ask twice for the same session", () => {
    expect(
      shouldPromptForEstimate({
        status: "complete",
        isOwner: true,
        alreadyEstimated: true,
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("respects a skip for the rest of the visit", () => {
    expect(
      shouldPromptForEstimate({
        status: "complete",
        isOwner: true,
        alreadyEstimated: false,
        dismissed: true,
      }),
    ).toBe(false);
  });
});

describe("presets", () => {
  it("offers a spread from minutes to multiple days", () => {
    expect(ESTIMATE_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it("gives every preset a positive whole number of minutes", () => {
    for (const preset of ESTIMATE_PRESETS) {
      expect(Number.isInteger(preset.minutes)).toBe(true);
      expect(preset.minutes).toBeGreaterThan(0);
    }
  });

  it("keeps presets in ascending order so the row reads as a scale", () => {
    const minutes = ESTIMATE_PRESETS.map((preset) => preset.minutes);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it("resolves a preset by id", () => {
    expect(presetMinutes("one-hour")).toBe(MINUTES_PER_HOUR);
  });

  it("returns null for an unknown preset id", () => {
    expect(presetMinutes("not-a-preset")).toBeNull();
  });

  it("counts a working day in working hours, not 24", () => {
    expect(presetMinutes("full-day")).toBe(HOURS_PER_WORKING_DAY * MINUTES_PER_HOUR);
  });
});

describe("fromDaysAndHours", () => {
  it("converts days and hours into minutes", () => {
    expect(fromDaysAndHours(1, 2)).toBe(HOURS_PER_WORKING_DAY * MINUTES_PER_HOUR + 120);
  });

  it("accepts hours alone", () => {
    expect(fromDaysAndHours(0, 3)).toBe(180);
  });

  it("accepts days alone", () => {
    expect(fromDaysAndHours(2, 0)).toBe(2 * HOURS_PER_WORKING_DAY * MINUTES_PER_HOUR);
  });

  it("treats both-zero as nothing entered rather than a zero estimate", () => {
    expect(fromDaysAndHours(0, 0)).toBeNull();
  });

  it("rejects negative input", () => {
    expect(fromDaysAndHours(-1, 0)).toBeNull();
    expect(fromDaysAndHours(0, -3)).toBeNull();
  });

  it("rejects fractional input, which the steppers cannot produce", () => {
    expect(fromDaysAndHours(0.5, 0)).toBeNull();
  });

  it("round-trips through toDaysAndHours", () => {
    const minutes = fromDaysAndHours(3, 4);
    expect(toDaysAndHours(minutes!)).toEqual({ days: 3, hours: 4 });
  });

  it("expresses a sub-day estimate as hours only", () => {
    expect(toDaysAndHours(120)).toEqual({ days: 0, hours: 2 });
  });
});

describe("isSubmittable", () => {
  const draft = (overrides: Partial<EstimateDraft>): EstimateDraft => ({
    mode: "preset",
    presetId: null,
    days: 0,
    hours: 0,
    exactMinutes: null,
    ...overrides,
  });

  it("is ready once a preset is chosen", () => {
    expect(isSubmittable(draft({ mode: "preset", presetId: "half-day" }))).toBe(true);
  });

  it("is not ready with no preset chosen", () => {
    expect(isSubmittable(draft({ mode: "preset", presetId: null }))).toBe(false);
  });

  it("is ready once days or hours are entered", () => {
    expect(isSubmittable(draft({ mode: "dayshours", days: 1 }))).toBe(true);
    expect(isSubmittable(draft({ mode: "dayshours", hours: 2 }))).toBe(true);
  });

  it("is not ready with an empty days-and-hours entry", () => {
    expect(isSubmittable(draft({ mode: "dayshours" }))).toBe(false);
  });

  it("is ready with a positive exact entry", () => {
    expect(isSubmittable(draft({ mode: "exact", exactMinutes: 45 }))).toBe(true);
  });

  it("is not ready with a zero or missing exact entry", () => {
    expect(isSubmittable(draft({ mode: "exact", exactMinutes: 0 }))).toBe(false);
    expect(isSubmittable(draft({ mode: "exact", exactMinutes: null }))).toBe(false);
  });
});
