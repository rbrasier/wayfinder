import { describe, expect, it } from "vitest";
import { isProcessing, shouldDriveTick } from "./run-tick-state";

const state = (overrides: Partial<Parameters<typeof shouldDriveTick>[0]> = {}) => ({
  status: "running",
  tickInFlight: false,
  tickBlocked: false,
  ...overrides,
});

describe("shouldDriveTick", () => {
  it("drives a running run that has no tick in flight", () => {
    expect(shouldDriveTick(state())).toBe(true);
  });

  it("never overlaps a tick already in flight", () => {
    expect(shouldDriveTick(state({ tickInFlight: true }))).toBe(false);
  });

  it("stops after a failed tick so a persistent error is not a hot loop", () => {
    expect(shouldDriveTick(state({ tickBlocked: true }))).toBe(false);
  });

  it("leaves paused and terminal runs alone", () => {
    for (const status of [
      "paused_preview",
      "paused_cap",
      "complete",
      "partial",
      "cancelled",
      undefined,
    ]) {
      expect(shouldDriveTick(state({ status }))).toBe(false);
    }
  });
});

describe("isProcessing", () => {
  it("is true only while the run is running", () => {
    expect(isProcessing("running")).toBe(true);
    expect(isProcessing("paused_preview")).toBe(false);
    expect(isProcessing("complete")).toBe(false);
    expect(isProcessing(undefined)).toBe(false);
  });
});
