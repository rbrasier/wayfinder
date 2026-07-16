import { describe, expect, it } from "vitest";
import { parseFlexibleDate } from "./parse-flexible-date";

describe("parseFlexibleDate", () => {
  it("parses the app's day-first DD-MM-YYYY format", () => {
    const parsed = parseFlexibleDate("27-07-2026");
    expect(parsed?.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("parses day-first with slash separators", () => {
    const parsed = parseFlexibleDate("03/06/2026");
    expect(parsed?.toISOString()).toBe("2026-06-03T00:00:00.000Z");
  });

  it("treats the first component as the day even when it could be a month", () => {
    // 05-11-2026 is 5 November, not 11 May — Wayfinder collects dates day-first.
    const parsed = parseFlexibleDate("05-11-2026");
    expect(parsed?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("parses ISO date strings", () => {
    const parsed = parseFlexibleDate("2026-07-27");
    expect(parsed?.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("parses ISO timestamps", () => {
    const parsed = parseFlexibleDate("2026-07-27T09:30:00.000Z");
    expect(parsed?.toISOString()).toBe("2026-07-27T09:30:00.000Z");
  });

  it("trims surrounding whitespace", () => {
    const parsed = parseFlexibleDate("  27-07-2026  ");
    expect(parsed?.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("returns null for an impossible day-first date rather than rolling over", () => {
    expect(parseFlexibleDate("31-02-2026")).toBeNull();
  });

  it("returns null for an out-of-range month", () => {
    expect(parseFlexibleDate("01-13-2026")).toBeNull();
  });

  it("returns null for empty or non-date input", () => {
    expect(parseFlexibleDate("")).toBeNull();
    expect(parseFlexibleDate("   ")).toBeNull();
    expect(parseFlexibleDate("not a date")).toBeNull();
  });
});
