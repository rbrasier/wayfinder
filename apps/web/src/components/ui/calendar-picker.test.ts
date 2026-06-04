import { describe, expect, it } from "vitest";
import { addMonths, buildMonthGrid } from "./calendar-picker";

describe("buildMonthGrid", () => {
  it("pads the start with leading blanks up to the first weekday", () => {
    // June 2026 starts on a Monday (weekday index 1).
    const grid = buildMonthGrid(2026, 6);
    expect(grid[0]).toBeNull();
    expect(grid[1]).toBe(1);
    expect(grid.filter((cell) => cell !== null)).toHaveLength(30);
    expect(grid.length % 7).toBe(0);
  });

  it("starts with no blanks when the first falls on a Sunday", () => {
    // February 2026 starts on a Sunday (weekday index 0).
    const grid = buildMonthGrid(2026, 2);
    expect(grid[0]).toBe(1);
    expect(grid.filter((cell) => cell !== null)).toHaveLength(28);
  });
});

describe("addMonths", () => {
  it("wraps forward across a year boundary", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("wraps backward across a year boundary", () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});
