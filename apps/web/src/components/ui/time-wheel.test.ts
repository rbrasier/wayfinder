import { describe, expect, it } from "vitest";
import { to12Hour, to24Hour } from "./time-wheel";

describe("to24Hour", () => {
  it("maps 12 AM to midnight and 12 PM to noon", () => {
    expect(to24Hour(12, "AM")).toBe(0);
    expect(to24Hour(12, "PM")).toBe(12);
  });

  it("maps morning and afternoon hours", () => {
    expect(to24Hour(1, "AM")).toBe(1);
    expect(to24Hour(11, "PM")).toBe(23);
  });
});

describe("to12Hour", () => {
  it("maps midnight and noon back to a 12-hour clock", () => {
    expect(to12Hour(0)).toEqual({ hour: 12, period: "AM" });
    expect(to12Hour(12)).toEqual({ hour: 12, period: "PM" });
  });

  it("maps an afternoon hour", () => {
    expect(to12Hour(13)).toEqual({ hour: 1, period: "PM" });
  });

  it("round-trips every hour of the day", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const { hour: hour12, period } = to12Hour(hour);
      expect(to24Hour(hour12, period)).toBe(hour);
    }
  });
});
